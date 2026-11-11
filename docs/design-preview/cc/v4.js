// V4 · Machines that change jobs (see ../BRIEF.md and ../BUILD.md).
// frame(t) is a pure model of one video frame (no DOM, testable with node); render(t) applies it to the DOM.
// Both depend only on t: no Math.random, no accumulated state (the DOM write cache only skips unchanged values).
(() => {
  'use strict';
  const S = window.Stage, D = window.CC_DATA;
  const { clamp, ease, seg, fmtClock, occAt, cumAt } = S;

  // ---- Time: a 1 s lead-in at 00:00, the 60-minute window at a constant 90x (40 s), then a hold at 60:00 ----
  const LEAD = 1, SPEED = 90, WIN = 3600, DUR = 43.5;
  const wOf = (t) => clamp((t - LEAD) * SPEED, 0, WIN);   // video s -> window s
  const tOf = (w) => LEAD + w / SPEED;                     // window s -> video s

  // ---- Display choices (not data) ----
  const FLIP_MIN = 0.35;   // video s: a role change with no recorded duration flips over this, centred on the event
  const RING_S = 2.0;      // video s the "changing job" ring stays up (the 33 s switch itself is 0.37 s at 90x)
  const LIT_S = 0.8;       // video s a machine glows when it comes back from a restart
  const FADE_S = 0.15;     // video s callout fade in and out
  const SMOOTH_W = 60;     // window s, half-width of the centred moving average on the waiting count (0 = raw samples)
  const MIN_LABEL = 13;    // the only restart length printed: the 13.2 and 12.8 min restarts round to "13 min"
  const STOP_LABEL = true; // amber "stopping" band on a draining Dynamo machine (beyond the brief's label list; false = outline only)

  // ---- Layout in stage px. Panels: Dynamo x 40-940, Evolving Infra x 980-1880, y 236-836. ----
  // Panel children are placed in the panel's inner box (inside the 2 px border): 896 x 596.
  const ARMS = ['dyn', 'ours'];
  const PX = { dyn: 40, ours: 980 }, PY = 236, PW = 900, PH = 600, IW = PW - 4, IH = PH - 4;
  const TW = 84, TGAP = 12, TX0 = 22, TY = 24, TH = 220, RING_OFF = 7;       // 9 machines span x 22-874
  const tileX = (i) => TX0 + i * (TW + TGAP);
  const tileCX = (i) => tileX(i) + TW / 2;
  const CALL_Y = 262, CALL_W = 300, CALL_MARGIN = 8;                          // callouts: y 262-338
  const LABEL_Y = 352;                                                        // "waiting for the model": y 352-380
  const ROPE_Y0 = 390, LANE = 44, LANES = 4, PER_LANE = 32, PITCH = 26, DOT_R = 10, DOT_X0 = 45;  // queue: y 390-566
  const ROPE_X0 = 22, ROPE_X1 = 874, TURN = 46;
  const CAP = LANES * PER_LANE;                                               // 128 places (max waiting is 122)
  const TICK = 7.6, TICK_Y = 852, LABEL2_Y = 878, COUNT_Y = 910, CLOCK_Y = 920;

  // place k of the queue (0 = head, next to the machines): lanes alternate direction, like a roped airport line
  const dotXY = (k) => {
    const lane = Math.floor(k / PER_LANE), j = k % PER_LANE;
    const x = lane % 2 === 0 ? DOT_X0 + j * PITCH : DOT_X0 + (PER_LANE - 1 - j) * PITCH;
    return [x, ROPE_Y0 + LANE / 2 + lane * LANE];
  };

  // ---- Dynamo machines: planner-log events [node, state, from, to] from dyn_start "PPPPPPDDD". ----
  // S = draining (shown as an amber outline and "stopping"), R = restarting (out of service), then the new job P or D.
  // Each node becomes a list of contiguous segments {mode: job | stop | off, job, a, b} in window s.
  const dynSegs = [];
  for (let n = 0; n < 9; n++) {
    const ev = D.nodes.dyn.filter((e) => e[0] === n).sort((x, y) => x[2] - y[2]);
    let job = D.nodes.dyn_start[n];
    const segs = [{ mode: 'job', job, a: -Infinity, b: ev.length ? ev[0][2] : Infinity, lit: false }];
    ev.forEach((e, k) => {
      const b = k + 1 < ev.length ? ev[k + 1][2] : Infinity;   // the next event starts where this one ends
      const prev = segs[segs.length - 1].mode;
      if (e[1] === 'S') segs.push({ mode: 'stop', job, a: e[2], b });
      else if (e[1] === 'R') segs.push({ mode: 'off', job: null, a: e[2], b });
      else { job = e[1]; segs.push({ mode: 'job', job, a: e[2], b, lit: prev === 'off' }); }
    });
    dynSegs.push(segs);
  }

  // ---- Evolving Infra machines: [t, 9-char roles] (S = switching in place) ----
  const TL = D.nodes.ours;
  const oursRole = (n, w) => { let c = TL[0][1][n]; for (const [at, r] of TL) { if (at <= w) c = r[n]; else break; } return c; };
  const switches = [];
  for (let n = 0; n < 9; n++) {
    let job = TL[0][1][n], sAt = null;
    for (let k = 1; k < TL.length; k++) {
      const c = TL[k][1][n], at = TL[k][0];
      if (c === 'S') { if (sAt === null) sAt = at; continue; }
      if (c !== job) {
        const a = sAt ?? at, b = at;   // recorded switch [a, b]; a === b when no switching state was logged
        const tA = b > a ? tOf(a) : tOf(a) - FLIP_MIN / 2;
        const tB = b > a ? Math.max(tOf(b), tA + FLIP_MIN) : tOf(a) + FLIP_MIN / 2;
        switches.push({ n, old: job, neu: c, a, b, tA, tB });
      }
      job = c; sAt = null;
    }
  }
  // one ring group (and one label) per moment of change
  const groups = [];
  for (const s of switches) {
    let g = groups.find((x) => x.a === s.a);
    if (!g) groups.push(g = { a: s.a, dur: s.b - s.a, tA: s.tA, nodes: [] });
    g.nodes.push(s.n);
  }

  // waiting agents (Stage.occAt [0]) with a centred moving average that narrows to the raw value at 0:00 and 60:00
  const waitingAt = (arm, w) => {
    const h = Math.min(SMOOTH_W, w, WIN - w);
    if (h <= 0) return occAt(arm, w)[0];
    let s = 0;
    for (let i = 0; i <= 12; i++) s += occAt(arm, w - h + (h * i) / 6)[0];
    return s / 13;
  };

  // ---- One frame as plain data ----
  function frame(t) {
    const w = wOf(t);
    const f = { t, w, clock: fmtClock(w) };
    for (const arm of ARMS) {
      const a = f[arm] = {
        tiles: [], rings: [], call: null,
        waiting: clamp(waitingAt(arm, w), 0, CAP),
        finished: Math.floor(cumAt(arm, 'cum_sess', w) + 1e-6),
      };
      if (arm === 'dyn') {
        for (let n = 0; n < 9; n++) {
          const sg = dynSegs[n].find((s) => s.a <= w && w < s.b);
          const d = { mode: sg.mode, job: sg.job, scale: 1, glow: 0, pulse: 0, spin: 0 };
          if (sg.lit) d.glow = 1 - seg(t, tOf(sg.a), tOf(sg.a) + LIT_S);
          if (sg.mode === 'stop') d.pulse = 0.3 + 0.2 * Math.sin(2 * Math.PI * 1.2 * t);
          if (sg.mode === 'off') {
            d.spin = (t * 150) % 360;
            const tA = tOf(sg.a), tB = tOf(sg.b), mins = Math.round((sg.b - sg.a) / 60);
            a.call = {
              n, cx: tileCX(n), single: true, fill: clamp((w - sg.a) / (sg.b - sg.a), 0, 1),
              num: mins === MIN_LABEL ? `${mins} min` : '',
              alpha: Math.min(seg(t, tA, tA + FADE_S), 1 - seg(t, tB - FADE_S, tB)),
            };
          }
          a.tiles.push(d);
        }
      } else {
        for (let n = 0; n < 9; n++) {
          let job = oursRole(n, w), scale = 1;
          const sw = switches.find((s) => s.n === n && t >= s.tA && t < s.tB);
          if (sw) {
            const k = ease(seg(t, sw.tA, sw.tB));
            job = k < 0.5 ? sw.old : sw.neu;
            scale = Math.max(0.02, Math.abs(Math.cos(Math.PI * k)));
          }
          a.tiles.push({ mode: 'job', job, scale, glow: 0, pulse: 0, spin: 0 });
          a.rings.push({ alpha: 0, scale: 1 });
        }
        const g = groups.find((x) => t >= x.tA && t < x.tA + RING_S);
        if (g) {
          const alpha = Math.min(seg(t, g.tA, g.tA + 0.25), 1 - seg(t, g.tA + RING_S - 0.4, g.tA + RING_S));
          const scale = 1 + 0.15 * (1 - ease(seg(t, g.tA, g.tA + 0.35)));
          for (const n of g.nodes) a.rings[n] = { alpha, scale };
          a.call = {
            cx: g.nodes.reduce((s, n) => s + tileCX(n), 0) / g.nodes.length, single: g.nodes.length === 1, fill: 0,
            num: g.dur > 0 ? `${Math.round(g.dur)} s` : '', alpha,
          };
        }
      }
    }
    return f;
  }

  const callLeft = (cx) => clamp(cx - CALL_W / 2, CALL_MARGIN, IW - CALL_MARGIN - CALL_W);
  window.V4 = {
    frame, wOf, tOf, dynSegs, switches, groups, waitingAt, dotXY, callLeft,
    K: { LEAD, SPEED, WIN, DUR, RING_S, FLIP_MIN, CAP, PX, PY, PW, PH, IW, IH, TW, TGAP, TX0, TY, TH, RING_OFF, CALL_Y, CALL_W,
      LABEL_Y, ROPE_Y0, LANE, LANES, PER_LANE, PITCH, DOT_R, ROPE_X0, ROPE_X1, TURN, TICK, TICK_Y, LABEL2_Y, COUNT_Y, CLOCK_Y },
  };

  // ---- DOM ----
  if (typeof document === 'undefined' || !document.getElementById('stage')) return;

  const RS_SVG = '<svg class="v4-rs" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6 A14 14 0 1 1 7.88 13" fill="none" ' +
    'stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M10.9 7.8 L3.5 11.6 L11.3 16.1 Z" fill="currentColor"/></svg>';
  const CHECK_SVG = (fill) => `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="${fill}"/>` +
    '<path d="M12 20.5 L18 26.5 L29 14.5" fill="none" stroke="#0b0c12" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  };
  const put = (e, x, y) => { e.style.left = `${x}px`; e.style.top = `${y}px`; };
  // write a style, attribute, text or class only when it changes
  const memo = (e) => e._v4 || (e._v4 = {});
  const css = (e, k, v) => { const m = memo(e); if (m[k] !== v) { m[k] = v; e.style[k] = v; } };
  const att = (e, k, v) => { const m = memo(e); if (m['@' + k] !== v) { m['@' + k] = v; e.setAttribute(k, v); } };
  const txt = (e, v) => { const m = memo(e); if (m.text !== v) { m.text = v; e.textContent = v; } };
  const cls = (e, v) => { const m = memo(e); if (m.cls !== v) { m.cls = v; e.className = v; } };

  const UI = {};
  function init(stage) {
    for (const arm of ARMS) {
      const ours = arm === 'ours', ui = UI[arm] = { tiles: [], rings: [] };
      const P = el('div', `panel v4-panel${ours ? ' ours' : ''}`, stage);
      P.style.left = `${PX[arm]}px`;

      // the line, drawn first so machines and labels paint above it
      let s = `<svg class="v4-line" width="${IW}" height="${IH}" viewBox="0 0 ${IW} ${IH}" aria-hidden="true">`;
      for (let b = 0; b <= LANES; b++) {
        const y = ROPE_Y0 + b * LANE, inner = b > 0 && b < LANES;
        const x0 = inner && b % 2 === 0 ? ROPE_X0 + TURN : ROPE_X0;   // the turn from lane b-1 into lane b stays open
        const x1 = inner && b % 2 === 1 ? ROPE_X1 - TURN : ROPE_X1;
        s += `<line class="v4-rope" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
          `<circle class="v4-post" cx="${x0}" cy="${y}" r="4"/><circle class="v4-post" cx="${x1}" cy="${y}" r="4"/>`;
      }
      for (let k = 0; k < CAP; k++) { const [x, y] = dotXY(k); s += `<circle class="v4-dot" cx="${x}" cy="${y}" r="${DOT_R}" opacity="0"/>`; }
      ui.dots = Array.from(el('div', 'v4-linewrap', P, `${s}</svg>`).querySelectorAll('.v4-dot'));
      el('div', 'v4-linelabel', P, '<i></i>waiting for the model').style.top = `${LABEL_Y}px`;

      // the 9 machines (and, for Evolving Infra, a ring per machine)
      for (let i = 0; i < 9; i++) {
        const wrap = el('div', 'v4-tw', P);
        put(wrap, tileX(i), TY);
        const tile = el('div', 'v4-tile', wrap,
          `<span class="v4-letter"></span><span class="v4-job"></span>${RS_SVG}${STOP_LABEL ? '<span class="v4-stopband">stopping</span>' : ''}`);
        ui.tiles.push({ wrap, tile, letter: tile.querySelector('.v4-letter'), job: tile.querySelector('.v4-job'), rs: tile.querySelector('.v4-rs') });
        if (ours) { const r = el('div', 'v4-ring', P); put(r, tileX(i) - RING_OFF, TY - RING_OFF); ui.rings.push(r); }
      }

      // the callout under a changing machine
      ui.stem = el('div', 'v4-stem', P);
      ui.stem.style.top = `${TY + TH}px`;
      ui.stem.style.height = `${CALL_Y - TY - TH}px`;
      if (ours) ui.stem.style.background = 'var(--ours)';
      ui.call = el('div', `v4-call${ours ? ' ours' : ''}`, P, ours
        ? '<div class="v4-l1">changing job · still serving</div><div class="v4-l2"><span class="v4-num"></span></div>'
        : '<div class="v4-l1">restarting · out of service</div><div class="v4-l2"><span class="v4-track"><span class="v4-fill"></span></span><span class="v4-num"></span></div>');
      ui.call.style.top = `${CALL_Y}px`;
      ui.fill = ui.call.querySelector('.v4-fill');
      ui.num = ui.call.querySelector('.v4-num');
      ui.l2 = ui.call.querySelector('.v4-l2');

      // progress under the panel: ticks, counter, clock
      const X = PX[arm];
      ui.ticks = el('div', `v4-ticks${ours ? ' ours' : ''}`, stage);
      put(ui.ticks, X, TICK_Y);
      put(el('div', 'counter-label v4-abs', stage, 'Agents finished'), X, LABEL2_Y);
      const row = el('div', 'v4-count v4-abs', stage, `${CHECK_SVG(ours ? '#e0313f' : '#e8e9ee')}<span class="counter${ours ? ' ours' : ''}"></span>`);
      put(row, X, COUNT_Y);
      ui.count = row.querySelector('.counter');
      ui.clock = el('div', `clock v4-clock${ours ? ' ours' : ''}`, stage);
      put(ui.clock, X, CLOCK_Y);
    }
  }

  function render(t) {
    const f = frame(t);
    for (const arm of ARMS) {
      const ui = UI[arm], a = f[arm];
      a.tiles.forEach((d, i) => {
        const u = ui.tiles[i];
        cls(u.tile, `v4-tile ${d.mode === 'off' ? 'off' : d.job === 'P' ? 'read' : 'write'}${d.mode === 'stop' ? ' stop' : ''}`);
        txt(u.letter, d.mode === 'off' ? '' : d.job);
        txt(u.job, d.mode === 'off' ? '' : d.job === 'P' ? 'read' : 'write');
        css(u.wrap, 'transform', d.scale >= 1 ? 'none' : `scaleX(${d.scale.toFixed(3)})`);
        css(u.tile, 'boxShadow', d.glow > 0 ? `0 0 28px 6px rgba(255, 255, 255, ${(0.7 * d.glow).toFixed(3)})`
          : d.mode === 'stop' ? `0 0 18px 2px rgba(240, 168, 48, ${d.pulse.toFixed(3)})` : 'none');
        if (d.mode === 'off') css(u.rs, 'transform', `rotate(${d.spin.toFixed(1)}deg)`);
      });
      ui.rings.forEach((r, i) => {
        css(r, 'opacity', a.rings[i].alpha.toFixed(3));
        css(r, 'transform', a.rings[i].scale === 1 ? 'none' : `scale(${a.rings[i].scale.toFixed(3)})`);
      });
      const c = a.call;
      if (c && c.alpha > 0) {
        css(ui.call, 'left', `${callLeft(c.cx)}px`);
        css(ui.call, 'opacity', c.alpha.toFixed(3));
        css(ui.stem, 'left', `${c.cx - 1}px`);
        css(ui.stem, 'opacity', c.single ? c.alpha.toFixed(3) : '0');
        if (ui.fill) css(ui.fill, 'width', `${(100 * c.fill).toFixed(2)}%`);
        txt(ui.num, c.num);
        css(ui.l2, 'display', ui.fill || c.num ? 'flex' : 'none');
      } else {
        css(ui.call, 'opacity', '0');
        css(ui.stem, 'opacity', '0');
      }
      const full = Math.floor(a.waiting), frac = a.waiting - full;
      ui.dots.forEach((d, k) => att(d, 'opacity', k < full ? '1' : k === full ? frac.toFixed(2) : '0'));
      txt(ui.count, String(a.finished));
      css(ui.ticks, 'width', `${(a.finished * TICK).toFixed(1)}px`);
      txt(ui.clock, f.clock);
    }
  }

  S.run({ duration: DUR, name: 'V4 · Machines that change jobs', init, render });
})();
