/* V1 · One session, side by side.
   One real Claude Code session (CC_DATA.one_agent, h fd0aecb95d7f, 25 model calls) replayed on Dynamo (left) and
   Evolving Infra (right) under one session clock: 00:00 at t = 1 s, then 45 session seconds per video second.
   Everything time-dependent is precomputed from the data in buildModel(); render(t) is a pure function of t.
   Calls 0 and 1 both start at 00:00; call 0 (458 prompt tokens, 19 output) ends inside call 1, so it is MERGED into
   call 1's block on the ribbon (no second lane). It still counts as a step. */
(function () {
  'use strict';

  // ---------------- settings ----------------
  const SESSION = 'fd0aecb95d7f';
  const LEAD = 1.0;                 // video s before the session clock starts at 00:00
  const SPEED = 45;                 // session s per video s (badge "45×")
  const DURATION = 45;              // video s: Dynamo finishes at ~42.4 s, then ~2.6 s of end state
  const MIN_HOLD = 0.3;             // video s: the big icon keeps a state at least this long (no strobing at 45x)
  const FORGET_SHOW = 2.5;          // video s the "forgot the conversation, re-reading it" label stays
  const FORGET_IDEAL_MIN = 60000;   // a call is a "forget" when its ideal cached prompt is >= 60k tokens ...
  const FORGET_CACHED_FRAC = 0.02;  // ... and its actual cached prompt is near 0 (<= 2 % of ideal)
  const LONG_TOOL = 60;             // session s: tool runs at least this long get the end-state outline
  const CLOCK_STOPS_AT_FINISH = true; // a side's clock stops when its agent finishes; false = both clocks run to 31:03
  const LABEL_FORGET = 'forgot the conversation, re-reading it';

  const KINDS = ['wait', 'gen', 'tool'];
  const toVideo = (s) => LEAD + s / SPEED;

  // ---------------- model (pure; also loaded by node for checks) ----------------
  // state that covers the most time in [a, min(b, end)); 'done' is never chosen before the end
  function dominant(segs, end, a, b) {
    const acc = { wait: 0, gen: 0, tool: 0 };
    const bb = Math.min(b, end);
    for (const [s0, s1, k] of segs) { const x = Math.max(a, s0), y = Math.min(bb, s1); if (y > x) acc[k] += y - x; }
    let best = 'wait';
    for (const k of KINDS) if (acc[k] > acc[best]) best = k;
    return best;
  }
  function stateAt(segs, end, s) {
    if (s >= end) return 'done';
    for (const [s0, s1, k] of segs) if (s >= s0 && s < s1) return k;
    return 'tool';
  }
  // The big icon's timeline (session s): it starts with the real state at 00:00; afterwards it may switch only after
  // holding a state MIN_HOLD, at that moment or at a real segment start, to the state that dominates the next
  // MIN_HOLD. 'done' is exact (the finish is never delayed); a state that would show for less than a third of
  // MIN_HOLD just before 'done' is dropped (Dynamo's last call waits 0.5 s: a one-frame hourglass otherwise).
  function buildDisplay(segs, end, hold) {
    const starts = Array.from(new Set(segs.map((g) => g[0]))).sort((x, y) => x - y);
    const out = [[0, stateAt(segs, end, 0)]];
    for (let guard = 0; guard < 2000; guard++) {
      const [cs, cur] = out[out.length - 1];
      const holdEnd = cs + hold;
      let next = end, kind = 'done';
      if (holdEnd < end) {
        const cands = [holdEnd].concat(starts.filter((x) => x > holdEnd && x < end));
        for (const x of cands) {
          const k = dominant(segs, end, x, x + hold);
          if (k !== cur) { next = x; kind = k; break; }
        }
      }
      if (kind === 'done') {
        if (out.length > 1 && end - out[out.length - 1][0] < hold / 3) out.pop();
        out.push([end, 'done']);
        return out;
      }
      out.push([next, kind]);
    }
    throw new Error('icon timeline did not converge');
  }

  function buildSide(R) {
    const calls = R.map((r, i) => ({ i, s: r[0], f: r[1], e: r[2], prompt: r[3], cached: r[4], ideal: r[5], out: r[6] }));
    const end = Math.max(...calls.map((c) => c.e));
    // a call that lies inside a longer call is merged into that call's block (here: side call 0 inside call 1)
    const merged = calls.filter((c) => calls.some((d) => d !== c && d.s <= c.s && d.e >= c.e && d.e - d.s > c.e - c.s))
      .map((c) => c.i);
    const lane = calls.filter((c) => !merged.includes(c.i)).sort((x, y) => x.s - y.s);
    // ribbon segments [s0, s1, kind]: amber 'wait' [start, first token), green 'gen' [first token, end),
    // gray 'tool' between calls
    const segs = [];
    let cur = 0;
    for (const c of lane) {
      const s0 = Math.max(c.s, cur);
      if (s0 > cur) segs.push([cur, s0, 'tool']);
      const f = Math.min(Math.max(c.f, s0), c.e);
      segs.push([s0, f, 'wait'], [f, c.e, 'gen']);
      cur = Math.max(cur, c.e);
    }
    const ends = calls.map((c) => c.e).sort((x, y) => x - y);
    const forget = calls.filter((c) => c.ideal >= FORGET_IDEAL_MIN && c.cached <= FORGET_CACHED_FRAC * c.ideal);
    const longTools = segs.filter((g) => g[2] === 'tool' && g[1] - g[0] >= LONG_TOOL);
    const disp = buildDisplay(segs, end, MIN_HOLD * SPEED);
    return {
      calls, end, merged, segs, ends, forget, longTools, disp,
      tEnd: toVideo(end),                                   // video s when the last call ends
      stepT: ends.map(toVideo),                             // video s of each completed call
      forgetT: forget.map((c) => toVideo(c.s)),             // video s of each forget call's start
      dispT: disp.map(([s, k]) => [toVideo(s), k]),         // icon timeline in video s
    };
  }

  function buildModel(D) {
    const a = D.one_agent.find((x) => x.h === SESSION);
    if (!a) throw new Error('session ' + SESSION + ' is not in CC_DATA.one_agent');
    const dyn = buildSide(a.dyn_reqs), ours = buildSide(a.ours_reqs);
    return {
      a, dyn, ours,
      scaleEnd: Math.max(dyn.end, ours.end),                // full ribbon width = Dynamo's 31:03
      // caption: minutes waiting for the first token, from the session record (BRIEF: 22.3 min vs 1.9 min)
      waitMin: { dyn: (a.dyn_wait / 60).toFixed(1), ours: (a.ours_wait / 60).toFixed(1) },
    };
  }
  const stepsAt = (m, s) => { let n = 0; for (const e of m.ends) if (e <= s) n++; return n; };

  // ---------------- view ----------------
  const NS = 'http://www.w3.org/2000/svg';
  const C = { wait: '#f0a830', gen: '#3ecf8e', tool: '#6b7280', dyn: '#d9dbe1', ours: '#e0313f', fg: '#e8e9ee',
    track: '#1a1c26', tickOff: '#2a2c37', ink: '#0b0c12', panel: '#12131c', line: '#c9ccd4' };
  const SIDE_X = { dyn: 40, ours: 980 };               // BUILD.md: Dynamo x 40-940, Evolving Infra x 980-1880
  const PANEL = { top: 232, w: 900, h: 500 };           // panel 232-732
  const ICON = { dx: 450, cy: 400, size: 180, glowR: 118, ringR: 142 };   // icon 310-490, glow 282-518, ring 258-542
  const RIB = { dx0: 36, w: 800, top: 628, h: 60 };     // ribbon x0+36 .. x0+836, y 628-688
  const TICK = { top: 752, h: 18, pitch: 36, w: 26 };   // 25 ticks x0+5 .. x0+895, y 752-770
  const CALLOUT = { top: 548, h: 40 };                  // label 548-588, leader 588-614, badge 614-642
  const BADGE_R = 14;
  const END_CHECK = 40;                                 // px; check just right of a finished ribbon
  // 24-unit icon paths. Hourglass and sparkles drawn here; wrench, check circle, replay and fast-forward follow the
  // Material icons used in the current video.
  const PATH = {
    wait: 'M6 2H18V8L14 12L18 16V22H6V16L10 12L6 8Z M8 20H16V16.5L12 12.5L8 16.5Z',
    waitSand: 'M9.2 20H14.8L12 17.6Z',
    sparkBig: 'M9 4L11.5 9.5L17 12L11.5 14.5L9 20L6.5 14.5L1 12L6.5 9.5Z',
    sparkTop: 'M19 1L20.25 3.75L23 5L20.25 6.25L19 9L17.75 6.25L15 5L17.75 3.75Z',
    sparkBot: 'M19 15L20.25 17.75L23 19L20.25 20.25L19 23L17.75 20.25L15 19L17.75 17.75Z',
    tool: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 ' +
      '6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
    done: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    reread: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  };

  const S = () => window.Stage;
  const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const popScale = (u) => 0.55 + 0.45 * easeOutBack(u);           // 0.55 -> ~1.05 -> 1
  const iconTf = (cx, cy, k, rot) => `translate(${cx} ${cy})${rot ? ` rotate(${rot.toFixed(2)})` : ''} scale(${k.toFixed(4)}) translate(-12 -12)`;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (h1, h2, k) => { const a = hex(h1), b = hex(h2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  function div(cls, parent, style) {
    const d = document.createElement('div');
    d.className = cls;
    if (style) Object.assign(d.style, style);
    parent.appendChild(d);
    return d;
  }
  // write only on change, so 60 fps playback touches few nodes
  function setAttr(e, k, v) { const key = '_v1_' + k, s = String(v); if (e[key] !== s) { e[key] = s; e.setAttribute(k, s); } }
  function setStyle(e, k, v) { const key = '_v1s_' + k, s = String(v); if (e[key] !== s) { e[key] = s; e.style[k] = s; } }
  function setText(e, v) { if (e._v1_text !== v) { e._v1_text = v; e.textContent = v; } }

  let M = null, V = null;

  function makeSide(key, m, svg, defs, stage) {
    const x0 = SIDE_X[key], ours = key === 'ours';
    const color = ours ? C.ours : C.dyn;
    const cx = x0 + ICON.dx, cy = ICON.cy, rx0 = x0 + RIB.dx0;
    const X = (s) => rx0 + RIB.w * Math.max(0, Math.min(1, s / M.scaleEnd));
    const root = el('g', { 'data-side': key }, svg);
    const Sd = { key, m, ours, color, cx, cy, X, root, x0 };

    // big state icon: one group per state (glow disc, ring, glyph), cross-faded in render()
    Sd.icons = {};
    for (const kind of ['wait', 'gen', 'tool', 'done']) {
      const col = kind === 'done' ? color : C[kind];
      const grp = el('g', { opacity: 0 }, root);
      el('circle', { cx, cy, r: ICON.glowR, fill: col, 'fill-opacity': 0.12 }, grp);
      el('circle', { cx, cy, r: ICON.glowR, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-opacity': 0.35 }, grp);
      const ic = { grp };
      if (kind === 'wait') {          // a turning arc on the ring while the agent waits
        const circ = 2 * Math.PI * ICON.glowR;
        ic.spin = el('circle', { cx, cy, r: ICON.glowR, fill: 'none', stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round',
          'stroke-dasharray': `${(circ * 0.16).toFixed(1)} ${(circ * 0.84).toFixed(1)}` }, grp);
      }
      ic.glyph = el('g', { transform: iconTf(cx, cy, ICON.size / 24) }, grp);
      if (kind === 'wait') {
        el('path', { d: PATH.wait, fill: col, 'fill-rule': 'evenodd' }, ic.glyph);
        el('path', { d: PATH.waitSand, fill: col }, ic.glyph);
      } else if (kind === 'gen') {
        el('path', { d: PATH.sparkBig, fill: col }, ic.glyph);
        ic.s1 = el('path', { d: PATH.sparkTop, fill: col }, ic.glyph);
        ic.s2 = el('path', { d: PATH.sparkBot, fill: col }, ic.glyph);
      } else if (kind === 'tool') {
        el('path', { d: PATH.tool, fill: col }, ic.glyph);
      } else {
        el('path', { d: PATH.done, fill: col, 'fill-rule': 'evenodd' }, ic.glyph);
      }
      Sd.icons[kind] = ic;
    }
    if (ours) {                       // red ring drawn around the check when Evolving Infra finishes (the beat)
      Sd.beatCirc = 2 * Math.PI * ICON.ringR;
      Sd.beatRing = el('circle', { cx, cy, r: ICON.ringR, fill: 'none', stroke: C.ours, 'stroke-width': 5, 'stroke-linecap': 'round',
        'stroke-dasharray': Sd.beatCirc.toFixed(1), 'stroke-dashoffset': Sd.beatCirc.toFixed(1),
        transform: `rotate(-90 ${cx} ${cy})`, opacity: 0 }, root);
    }

    // ribbon: track (full width = 31:03), segments clipped to the rounded track, drawn up to the playhead
    const clipId = 'v1-clip-' + key;
    const cp = el('clipPath', { id: clipId }, defs);
    el('rect', { x: rx0, y: RIB.top, width: RIB.w, height: RIB.h, rx: 8 }, cp);
    el('rect', { x: rx0, y: RIB.top, width: RIB.w, height: RIB.h, rx: 8, fill: C.track }, root);
    const rg = el('g', { 'clip-path': `url(#${clipId})` }, root);
    Sd.segs = m.segs.filter((g) => g[1] > g[0]).map(([s0, s1, kind]) => ({
      s0, s1, x: X(s0), rect: el('rect', { x: X(s0).toFixed(2), y: RIB.top, width: 0, height: RIB.h, fill: C[kind] }, rg) }));
    // end state: outline the long tool runs (same tools on both). The 3 px stroke sits inside each gray block
    // horizontally, so neighbours stay visible (on Evolving Infra two runs are only 4 px apart).
    Sd.outlines = m.longTools.map(([a, b]) => el('rect', { x: (X(a) + 1.5).toFixed(2), y: RIB.top - 6,
      width: (X(b) - X(a) - 3).toFixed(2), height: RIB.h + 12, rx: 5, fill: 'none', stroke: C.fg, 'stroke-width': 3, opacity: 0 }, root));
    Sd.playhead = el('line', { x1: X(0), x2: X(0), y1: RIB.top - 10, y2: RIB.top + RIB.h + 10, stroke: C.fg, 'stroke-width': 2.5,
      'stroke-linecap': 'round' }, root);
    const ex = X(m.end) + 26, ey = RIB.top + RIB.h / 2;
    Sd.endCheck = { x: ex, y: ey, g: el('g', { opacity: 0, transform: iconTf(ex, ey, END_CHECK / 24) }, root) };
    el('path', { d: PATH.done, fill: color, 'fill-rule': 'evenodd' }, Sd.endCheck.g);

    // forget events: a fixed-size badge at the call start (never sized by the wait) + a 2.5 s label above it
    Sd.forget = m.forget.map((c, j) => {
      const bx = X(c.s);
      const leader = el('line', { x1: bx.toFixed(2), x2: bx.toFixed(2), y1: CALLOUT.top + CALLOUT.h, y2: RIB.top - BADGE_R,
        stroke: C.line, 'stroke-width': 2, opacity: 0 }, root);
      const g = el('g', { opacity: 0 }, root);
      el('circle', { cx: bx.toFixed(2), cy: RIB.top, r: BADGE_R, fill: C.fg, stroke: C.panel, 'stroke-width': 2 }, g);
      el('path', { d: PATH.reread, fill: C.ink, transform: iconTf(bx, RIB.top, 0.85) }, g);
      const label = div('v1-callout', stage, { left: bx.toFixed(1) + 'px' });
      label.textContent = LABEL_FORGET;
      return { bx, t0: m.forgetT[j], leader, g, label };
    });

    // part-1 progress: one tick per model call, "STEP n / 25", the session clock
    Sd.ticks = m.calls.map((_, k) => el('rect', { x: x0 + k * TICK.pitch + (TICK.pitch - TICK.w) / 2, y: TICK.top, width: TICK.w,
      height: TICK.h, rx: 3, fill: C.tickOff }, root));
    Sd.step = div('v1-step' + (ours ? ' ours' : ''), stage, { left: x0 + 'px' });
    Sd.step.appendChild(document.createTextNode('STEP '));
    Sd.stepN = document.createElement('b');
    Sd.step.appendChild(Sd.stepN);
    Sd.step.appendChild(document.createTextNode(' / ' + m.calls.length));
    Sd.clock = div('v1-clock' + (ours ? ' ours' : ''), stage, { left: (x0 + ICON.dx - 150) + 'px' });
    return Sd;
  }

  function init(stage) {
    M = buildModel(window.CC_DATA);
    const svg = document.getElementById('v1-svg'), defs = document.getElementById('v1-defs');
    V = { sides: [] };
    V.sides.push(makeSide('dyn', M.dyn, svg, defs, stage), makeSide('ours', M.ours, svg, defs, stage));
    V.dyn = V.sides[0];
    V.ours = V.sides[1];
    V.panelOurs = document.getElementById('v1-panel-ours');
    V.tag = document.getElementById('v1-tag');
    // caption: "Waiting for the model: 22.3 min vs 1.9 min"
    const cap = V.caption = document.getElementById('v1-caption');
    const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; if (text) s.textContent = text; cap.appendChild(s); };
    span('sw');
    cap.appendChild(document.createTextNode('Waiting for the model: '));
    span('d', M.waitMin.dyn + ' min');
    cap.appendChild(document.createTextNode(' '));
    span('vs', 'vs');
    cap.appendChild(document.createTextNode(' '));
    span('o', M.waitMin.ours + ' min');
  }

  function renderSide(Sd, t, s) {
    const St = S(), m = Sd.m, finished = t >= m.tEnd;
    const sNow = finished ? m.end : Math.min(s, m.end);
    setText(Sd.clock, St.fmtClock(CLOCK_STOPS_AT_FINISH ? sNow : s));
    const n = finished ? m.calls.length : stepsAt(m, sNow);
    setText(Sd.stepN, String(n));
    for (let k = 0; k < Sd.ticks.length; k++) {   // a filled tick grows briefly when its call completes
      const on = k < n, fl = on ? 1 - St.seg(t, m.stepT[k], m.stepT[k] + 0.35) : 0, h = TICK.h * (1 + 0.6 * fl);
      setAttr(Sd.ticks[k], 'fill', on ? Sd.color : C.tickOff);
      setAttr(Sd.ticks[k], 'height', h.toFixed(2));
      setAttr(Sd.ticks[k], 'y', (TICK.top - (h - TICK.h) / 2).toFixed(2));
    }
    for (const g of Sd.segs) setAttr(g.rect, 'width', Math.max(0, Sd.X(Math.min(sNow, g.s1)) - g.x).toFixed(2));
    const px = Sd.X(sNow).toFixed(2);
    setAttr(Sd.playhead, 'x1', px);
    setAttr(Sd.playhead, 'x2', px);
    setAttr(Sd.playhead, 'opacity', finished ? 0 : 1);
    setAttr(Sd.endCheck.g, 'opacity', finished ? 1 : 0);
    setAttr(Sd.endCheck.g, 'transform', iconTf(Sd.endCheck.x, Sd.endCheck.y, (END_CHECK / 24) * popScale(St.seg(t, m.tEnd, m.tEnd + 0.4))));

    // big icon: current display state fades in over the previous one
    const d = m.dispT, op = { wait: 0, gen: 0, tool: 0, done: 0 };
    let k = -1;
    for (let i = 0; i < d.length && d[i][0] <= t; i++) k = i;
    let kin = null, a = 0;
    if (k >= 0) {
      kin = d[k][1];
      a = St.ease(St.seg(t, d[k][0], d[k][0] + (kin === 'done' ? 0.2 : 0.12)));
      op[kin] = a;
      if (k > 0) { const prev = d[k - 1][1]; op[prev] = Math.max(op[prev], 1 - a); }
    }
    for (const kind of ['wait', 'gen', 'tool', 'done']) {
      const ic = Sd.icons[kind];
      setAttr(ic.grp, 'opacity', op[kind].toFixed(3));
      if (op[kind] <= 0) continue;
      let sc = ICON.size / 24, rot = 0;
      if (kind === 'done') sc *= popScale(St.seg(t, m.tEnd, m.tEnd + 0.45));
      else if (kind === kin) sc *= 0.94 + 0.06 * a;
      if (kind === 'tool') rot = 7 * Math.sin(2 * Math.PI * 1.1 * t);
      setAttr(ic.glyph, 'transform', iconTf(Sd.cx, Sd.cy, sc, rot));
      if (kind === 'wait') setAttr(ic.spin, 'transform', `rotate(${((t * 150) % 360).toFixed(2)} ${Sd.cx} ${Sd.cy})`);
      if (kind === 'gen') {
        const w = Math.sin(2 * Math.PI * 1.4 * t);
        setAttr(ic.s1, 'transform', `translate(19 5) scale(${(0.85 + 0.15 * w).toFixed(3)}) translate(-19 -5)`);
        setAttr(ic.s2, 'transform', `translate(19 19) scale(${(0.85 - 0.15 * w).toFixed(3)}) translate(-19 -19)`);
      }
    }

    // forget badges and labels (Dynamo only; Evolving Infra has none in this session)
    for (const f of Sd.forget) {
      const on = t >= f.t0;
      const ain = St.ease(St.seg(t, f.t0, f.t0 + 0.2));
      const aout = 1 - St.ease(St.seg(t, f.t0 + FORGET_SHOW - 0.3, f.t0 + FORGET_SHOW));
      const lab = on ? ain * aout : 0;
      setStyle(f.label, 'opacity', lab.toFixed(3));
      setStyle(f.label, 'transform', `translate(-50%, ${((1 - ain) * 8).toFixed(2)}px)`);
      setAttr(f.leader, 'opacity', lab.toFixed(3));
      setAttr(f.g, 'opacity', on ? 1 : 0);
      const bs = popScale(St.seg(t, f.t0, f.t0 + 0.35));
      setAttr(f.g, 'transform', `translate(${f.bx.toFixed(2)} ${RIB.top}) scale(${bs.toFixed(3)}) translate(${(-f.bx).toFixed(2)} ${-RIB.top})`);
    }
  }

  function render(t) {
    const St = S();
    const s = St.clamp((t - LEAD) * SPEED, 0, M.scaleEnd);    // one session clock for both sides
    for (const Sd of V.sides) renderSide(Sd, t, s);

    // the beat when Evolving Infra finishes (t = tF): red ring drawn around its check, panel glow, both step counters
    // enlarged until just before Dynamo's next step; the clock keeps its constant 45x speed throughout
    const tF = M.ours.tEnd, tD = M.dyn.tEnd, O = V.ours;
    setAttr(O.beatRing, 'opacity', t >= tF ? (1 - St.seg(t, tF + 1.8, tF + 2.4)).toFixed(3) : 0);
    setAttr(O.beatRing, 'stroke-dashoffset', (O.beatCirc * (1 - St.ease(St.seg(t, tF, tF + 0.4)))).toFixed(1));
    const glow = St.seg(t, tF, tF + 0.2) * (1 - St.seg(t, tF + 1.6, tF + 2.4));
    setStyle(V.panelOurs, 'boxShadow', glow > 0 ? `0 0 ${(30 * glow).toFixed(1)}px rgba(224,49,63,${(0.55 * glow).toFixed(3)})` : 'none');
    const e2 = St.ease(St.seg(t, tF, tF + 0.2)) * (1 - St.ease(St.seg(t, tF + 1.0, tF + 1.2)));
    for (const Sd of V.sides) setStyle(Sd.step, 'transform', `scale(${(1 + 0.2 * e2).toFixed(3)})`);
    setStyle(O.clock, 'transform', `scale(${(1 + 0.08 * e2).toFixed(3)})`);

    // end state after Dynamo finishes (t = tD): outline the long tool runs pair by pair, then the caption
    for (const Sd of V.sides) Sd.outlines.forEach((o, k) =>
      setAttr(o, 'opacity', St.ease(St.seg(t, tD + 0.15 + 0.22 * k, tD + 0.35 + 0.22 * k)).toFixed(3)));
    const ta = St.seg(t, tD + 0.15, tD + 0.45);
    setStyle(V.tag, 'color', mix('#aeb2bd', '#e8e9ee', ta));
    setStyle(V.tag, 'borderColor', mix('#3a3d48', '#c9ccd4', ta));
    const ca = St.ease(St.seg(t, tD + 0.55, tD + 0.95));
    setStyle(V.caption, 'opacity', ca.toFixed(3));
    setStyle(V.caption, 'transform', `translateY(${(10 * (1 - ca)).toFixed(2)}px)`);
  }

  const API = { buildModel, buildDisplay, stepsAt, init, render, settings: { SESSION, LEAD, SPEED, DURATION, MIN_HOLD, FORGET_SHOW,
    LONG_TOOL, CLOCK_STOPS_AT_FINISH }, layout: { SIDE_X, PANEL, ICON, RIB, TICK, CALLOUT, BADGE_R, END_CHECK } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;    // node checks
  else window.Stage.run({ duration: DURATION, name: 'V1 · One session, side by side', init, render });
})();
