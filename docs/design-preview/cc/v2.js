// V2 "The hourglass" (read ../BRIEF.md and ../BUILD.md). Each side is one hourglass holding the 126 agents as grains:
// top bulb = waiting for the model, neck = model writing, bottom bulb = running a tool (idle, at most 1 agent, is put
// with "running a tool"). Grain counts per zone come from Stage.occAt at every whole minute of the window; grains move
// between zones when those counts change. The plug in the neck is ideal hit minus actual hit for that minute.
// render(t) is a pure function of t: everything time-dependent is precomputed in build() from the data alone.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (k) => k * k * (3 - 2 * k);

  // ---- timeline: 1 s lead-in, the 60-minute window at 90x (40 s), hold until 43.5 s ----
  const LEAD = 1, SPEED = 90, WIN = 3600, DURATION = 43.5;
  const wAt = (t) => clamp((t - LEAD) * SPEED, 0, WIN);
  const STEP = 60, NSTEP = WIN / STEP, STEP_V = STEP / SPEED; // grain step: 1 window minute = 0.667 s of video

  // ---- geometry, stage px ----
  const P = 16, GR = 7, ROW = P * Math.sqrt(3) / 2, STROKE = 2.5, GAP = 1; // grain pitch, radius, row spacing
  const CAP_TOP = 250, CAP_H = 12, YB1 = CAP_TOP + CAP_H, HB = 177, HN = 190;
  const YJ1 = YB1 + HB, YJ2 = YJ1 + HN, YB2 = YJ2 + HB; // throat (top of neck), neck exit, bottom of lower bulb
  const RB = 156, HNW = 34; // bulb profile radius, neck half-width (glass centre line)
  const PLUG_SCALE = 240; // plug height in px per unit of (ideal hit - actual hit); the same scale on both sides
  const X0 = { dyn: 40, ours: 980 }, CX_OFF = 547; // hourglass centre = panel left + CX_OFF (labels + glass + pipe centred)
  const ARMS = ['dyn', 'ours'];
  const N = 126;
  const ZC = [[240, 168, 48], [62, 207, 142], [107, 114, 128]]; // waiting amber, writing green, tool gray
  const GLASS = '#7a7d87', PIPE_WALL = '#4a4e5a', PANEL = '#12131c';
  const TRAIL = 1 / 60; // a flying grain is drawn as a streak from where it was one frame earlier

  // bulb profile: s = 0 at the cap, 1 at the neck; rounded towards the cap, narrowing smoothly into the neck
  const prof = (s) => { const sh = s < 0.3 ? 1 - 0.32 * (1 - s / 0.3) ** 2 : 1; return Math.max(0, 1 - s ** 2.6) ** 2.2 * sh; };
  // glass half-width (stroke centre line) at stage y
  const hw = (y) => {
    if (y < YJ1) return HNW + (RB - HNW) * prof(clamp((y - YB1) / HB, 0, 1));
    if (y <= YJ2) return HNW;
    return HNW + (RB - HNW) * prof(clamp((YB2 - y) / HB, 0, 1));
  };
  let HWMAX = 0;
  for (let y = YB1; y <= YB2; y += 0.5) HWMAX = Math.max(HWMAX, hw(y));
  const CAPW = Math.ceil(HWMAX + 14); // cap half-width

  // Grain slots per zone, x relative to the hourglass centre, in packing order (a pile fills slots 0..n-1).
  // Top bulb: rows from the throat upward, each row from the walls inward (a partly filled row leaves a crater).
  // Neck: rows from the bottom up, centre first. Bottom bulb: rows from the floor up, centre first (a mound).
  function buildSlots() {
    const avail = (y) => { let m = Infinity; for (let d = -GR; d <= GR + 1e-9; d += 0.5) m = Math.min(m, hw(y + d)); return m - STROKE / 2 - GR - GAP; };
    const row = (y, odd) => {
      const a = avail(y), xs = [];
      if (a < 0) return xs;
      if (odd) { const k = Math.floor(a / P + 0.5 + 1e-9); for (let i = -k; i < k; i++) xs.push((i + 0.5) * P); }
      else { const k = Math.floor(a / P + 1e-9); for (let i = -k; i <= k; i++) xs.push(i * P); }
      return xs;
    };
    const top = [], neck = [], bot = [];
    for (let k = 0; ; k++) {
      const y = YJ1 - GR - GAP - k * ROW;
      if (y - GR < YB1 + STROKE / 2 + GAP) break;
      for (const x of row(y, k % 2 === 1).sort((a, b) => Math.abs(b) - Math.abs(a) || b - a)) top.push([x, y]);
    }
    for (let k = 0; ; k++) {
      const y = YJ2 - GR - GAP - k * ROW;
      if (y - GR < YJ1 + GAP) break;
      for (const x of row(y, k % 2 === 0).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)) neck.push([x, y]);
    }
    for (let k = 0; ; k++) {
      const y = YB2 - STROKE / 2 - GR - GAP - k * ROW;
      if (y - GR < YJ2 + GAP) break;
      for (const x of row(y, k % 2 === 1).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) bot.push([x, y]);
    }
    return [top, neck, bot];
  }
  const SLOTS = buildSlots();

  // Return pipe on the right: from an opening in the lower bulb (above the highest tool pile) to one under the top cap.
  const Y_TO = YB1 + 22;
  const Y_BO = clamp(SLOTS[2][Math.min(SLOTS[2].length - 1, 99)][1] - ROW, YJ2 + 40, YB2 - 40);
  const XP = CAPW + 22, PR = 26; // pipe vertical run (relative x), corner radius
  function pipeRel() {
    const bx = hw(Y_BO) - 1, tx = hw(Y_TO) - 1, pts = [[bx, Y_BO], [XP - PR, Y_BO]];
    for (let a = 1; a <= 8; a++) { const th = Math.PI / 2 * (1 - a / 8); pts.push([XP - PR + PR * Math.cos(th), Y_BO - PR + PR * Math.sin(th)]); }
    pts.push([XP, Y_TO + PR]);
    for (let a = 1; a <= 8; a++) { const th = -Math.PI / 2 * (a / 8); pts.push([XP - PR + PR * Math.cos(th), Y_TO + PR + PR * Math.sin(th)]); }
    pts.push([tx, Y_TO]);
    return pts;
  }
  const PIPE = pipeRel();

  // Label anchors (x relative to centre): zone labels sit left of the hourglass, each with a dot and a short leader.
  const LABELS = [
    { key: 'W', text: 'waiting for the model', y: Math.round(YB1 + 0.45 * HB) },
    { key: 'G', text: 'model writing', y: Math.round(YJ1 + 0.7 * HN) },
    { key: 'T', text: 'running a tool', y: Math.round(YJ2 + 0.6 * HB) },
  ];
  for (const L of LABELS) { L.wall = -hw(L.y) - STROKE / 2 - 3; L.dot = L.wall - 34; L.right = L.dot - 14; }
  const PLUG_LABEL = { y1: YJ1 + 10, wall: -HNW - STROKE / 2 - 3, right: LABELS[1].right };
  PLUG_LABEL.dot = LABELS[1].dot;

  // ---- data ----
  const D = () => W.CC_DATA;
  const S = () => W.Stage;
  const gapOfMinute = (arm, m) => { const r = D()[arm].per_min[30 + clamp(m, 0, 59)]; return Math.max(0, r[5] - r[4]); };
  // ideal hit minus actual hit at window second w: that minute's value, eased over +-10 s around each minute boundary
  function gapAt(arm, w) {
    const b = Math.round(w / 60);
    if (b > 0 && b < 60 && Math.abs(w - 60 * b) < 10) return lerp(gapOfMinute(arm, b - 1), gapOfMinute(arm, b), smooth((w - 60 * b + 10) / 20));
    return gapOfMinute(arm, Math.floor(w / 60));
  }
  const finishedAt = (arm, w) => Math.floor(S().cumAt(arm, 'cum_sess', w) + 1e-6);

  // ---- precomputed grain timeline per side ----
  function polyline(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function pointAt(pl, q) {
    const d = q * pl.len, c = pl.cum;
    let i = 1;
    while (i < c.length - 1 && c[i] < d) i++;
    const seg = c[i] - c[i - 1], k = seg > 0 ? (d - c[i - 1]) / seg : 1;
    return [lerp(pl.pts[i - 1][0], pl.pts[i][0], k), lerp(pl.pts[i - 1][1], pl.pts[i][1], k)];
  }
  // start offset and duration (video s) of the i-th of n journeys of one kind inside a step; all end inside the step.
  // Long journeys (through the return pipe, or across two zones) get more time than a hop across one boundary.
  function timing(long, i, n) {
    const spread = (long ? clamp(0.012 * n, 0.04, 0.25) : clamp(0.03 * n, 0.06, 0.5)) * STEP_V;
    const off = n > 1 ? (i / (n - 1)) * spread : 0;
    const dur = long ? 0.97 * STEP_V - spread : Math.min(0.6 * STEP_V, 0.97 * STEP_V - spread);
    return [off, dur];
  }
  // travel profile: accelerate over the first 20 %, constant speed, decelerate over the last 20 % (peak 1.25x mean)
  const travel = (q) => { const a = 0.2, v = 1 / (1 - a); return q < a ? v * q * q / (2 * a) : q > 1 - a ? 1 - v * (1 - q) * (1 - q) / (2 * a) : v * (q - a / 2); };

  function buildArm(arm) {
    const cx = X0[arm] + CX_OFF;
    const slot = (z, s) => { const p = SLOTS[z][s]; return [cx + p[0], p[1]]; };
    const counts = [];
    for (let j = 0; j <= NSTEP; j++) {
      const o = S().occAt(arm, j * STEP).map((v) => Math.round(v));
      counts.push([o[0], o[1], o[2] + o[3]]);
    }
    const Z = [[], [], []];
    let id = 0;
    for (let z = 0; z < 3; z++) for (let s = 0; s < counts[0][z]; s++) Z[z].push(id++);
    const snap = () => { const c = new Array(N); Z.forEach((list, z) => list.forEach((g, s) => { c[g] = [z, s]; })); return c; };
    const cfg = [snap()], moveAt = [];
    const exitRef = [[cx, YJ1 + 1], [cx, YJ2 + 2], [cx + hw(Y_BO) - 12, Y_BO]];
    // waypoints a grain passes when it leaves zone z: the throat, the neck exit, or the return pipe
    const exitPts = [[exitRef[0]], [exitRef[1]], [exitRef[2], ...PIPE.map((p) => [cx + p[0], p[1]]), [cx + hw(Y_TO) - 12, Y_TO]]];
    let nMoves = 0, nThrough = 0;
    for (let j = 0; j < NSTEP; j++) {
      const a = counts[j], b = counts[j + 1];
      const dW = b[0] - a[0], dG = b[1] - a[1];
      const x = Math.max(0, -dW, dG);
      const out = [x, x - dG, x + dW]; // minimal flows: waiting->writing, writing->tool, tool->waiting
      // each zone sends its surface grains (at most what it held); the rest of its outflow passes straight through
      const arriving = [[], [], []], need = [0, 0, 0];
      for (let z = 0; z < 3; z++) {
        const k = Math.min(out[z], Z[z].length);
        need[z] = out[z] - k;
        const gone = Z[z].splice(Z[z].length - k, k).map((g, i) => ({ g, s0: Z[z].length + i, route: [z, (z + 1) % 3] }));
        const e = exitRef[z], dist = (q) => { const p = slot(z, q.s0); return Math.hypot(p[0] - e[0], p[1] - e[1]); };
        gone.sort((p, q) => dist(p) - dist(q) || p.s0 - q.s0);
        arriving[(z + 1) % 3].push(...gone);
      }
      for (let round = 0; round < 3; round++) {
        for (let z = 0; z < 3; z++) {
          while (need[z] > 0 && arriving[z].length) {
            const jn = arriving[z].shift();
            jn.route.push((z + 1) % 3);
            arriving[(z + 1) % 3].push(jn);
            need[z]--;
            nThrough++;
          }
        }
      }
      if (need.some((v) => v > 0)) throw new Error(`unresolved pass-through at step ${j}`);
      const mv = new Array(N).fill(null), all = [];
      for (let z = 0; z < 3; z++) for (const jn of arriving[z]) { jn.s1 = Z[z].length; Z[z].push(jn.g); all.push(jn); }
      for (let z = 0; z < 3; z++) if (Z[z].length !== b[z] || Z[z].length > SLOTS[z].length) throw new Error(`zone ${z} count mismatch at step ${j}`);
      const isLong = (jn) => jn.route.length > 2 || jn.route[0] === 2;
      for (const long of [true, false]) {
        const grp = all.filter((jn) => isLong(jn) === long);
        grp.forEach((jn, i) => {
          const r = jn.route, pts = [slot(r[0], jn.s0)], cross = [];
          for (let k = 0; k + 1 < r.length; k++) {
            const i0 = pts.length;
            pts.push(...exitPts[r[k]]);
            cross.push([r[k], i0, pts.length - 1]); // zone left, first and last waypoint index of its exit
          }
          pts.push(slot(r[r.length - 1], jn.s1));
          const path = polyline(pts);
          // colour blends where the grain changes zone: around the throat or neck exit, along the pipe
          const cols = cross.map(([z, i0, i1]) => z === 2 ? [path.cum[i0], path.cum[i1], z] : [path.cum[i0] - 14, path.cum[i0] + 14, z]);
          const [off, dur] = timing(long, i, grp.length);
          mv[jn.g] = { route: r, off, dur, path, cols };
          nMoves++;
        });
      }
      moveAt.push(mv);
      cfg.push(snap());
    }
    // times (window s) at which the finished counter steps up, from the same linear interpolation as Stage.cumAt
    const cs = D()[arm].cum_sess, inc = [];
    for (let i = 0; i + 1 < cs.length; i++) { const n = cs[i + 1][1] - cs[i][1]; for (let k = 1; k <= n; k++) inc.push(cs[i][0] + (cs[i + 1][0] - cs[i][0]) * k / n); }
    return { arm, cx, slot, counts, cfg, moveAt, inc, nMoves, nThrough };
  }

  let ARM = null;
  const build = () => { if (!ARM) ARM = { dyn: buildArm('dyn'), ours: buildArm('ours') }; return ARM; };

  const mixRGB = (a, b, k) => [Math.round(lerp(a[0], b[0], k)), Math.round(lerp(a[1], b[1], k)), Math.round(lerp(a[2], b[2], k))];

  // grain step index and video seconds into it, at video time t
  const stepAt = (t) => {
    const tv = t - LEAD;
    if (tv >= NSTEP * STEP_V) return [NSTEP, 0];
    if (tv > 0) { const j = Math.min(NSTEP - 1, Math.floor(tv / STEP_V)); return [j, tv - j * STEP_V]; }
    return [0, 0];
  };
  // position [x, y], colour and flying flag of grain g in step j, u video seconds in (pure)
  function grainAt(A, g, j, u) {
    const m = j < NSTEP ? A.moveAt[j][g] : null;
    if (!m) { const c = A.cfg[j][g], p = A.slot(c[0], c[1]); return [p[0], p[1], ZC[c[0]], 0]; }
    const q = clamp((u - m.off) / m.dur, 0, 1), e = travel(q);
    const p = pointAt(m.path, e), d = e * m.path.len;
    let col = ZC[m.route[0]];
    for (const [d0, d1, z] of m.cols) {
      if (d >= d1) { col = ZC[(z + 1) % 3]; continue; }
      if (d > d0) col = mixRGB(ZC[z], ZC[(z + 1) % 3], smooth((d - d0) / (d1 - d0)));
      break;
    }
    return [p[0], p[1], col, q > 0 && q < 1 ? 1 : 0];
  }

  // Everything one side shows at video time t (pure).
  function armFrame(A, t) {
    const [j, u] = stepAt(t), [jp, up] = stepAt(t - TRAIL);
    const grains = new Array(N);
    let inFlight = 0;
    for (let g = 0; g < N; g++) {
      const cur = grainAt(A, g, j, u);
      if (cur[3]) { const prev = grainAt(A, g, jp, up); cur.push(prev[0], prev[1]); inFlight++; } else cur.push(cur[0], cur[1]);
      grains[g] = cur; // [x, y, rgb, flying, x one frame earlier, y one frame earlier]
    }
    const w = wAt(t);
    const plugH = gapAt(A.arm, w) * PLUG_SCALE;
    // last counter step at or before w (binary search)
    let lo = 0, hi = A.inc.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (A.inc[mid] <= w + 1e-9) lo = mid + 1; else hi = mid; }
    const since = lo > 0 ? t - (LEAD + A.inc[lo - 1] / SPEED) : Infinity;
    return { grains, inFlight, plugH, finished: finishedAt(A.arm, w), since, step: j };
  }

  function frame(t) {
    const A = build(), w = wAt(t);
    return {
      t, w, clock: S().fmtClock(w),
      plugLabel: smooth(clamp((w - 1770) / 60, 0, 1)), // Dynamo's plug label fades in at window minutes 29.5-30.5
      dyn: armFrame(A.dyn, t), ours: armFrame(A.ours, t),
    };
  }

  // ---- DOM ----
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const div = (cls, style, html, parent) => {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    if (style) e.setAttribute('style', style);
    if (html != null) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  };
  const HEX = { W: '#f0a830', G: '#3ecf8e', T: '#6b7280' };
  const fix = (v) => (Math.round(v * 10) / 10).toString();
  let UI = null;

  function init(stage) {
    const A = build();
    const svg = el('svg', { class: 'v2-svg', width: 1920, height: 1080, viewBox: '0 0 1920 1080' });
    stage.appendChild(svg);
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'v2hatch', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 9, height: 9, fill: '#f0a830', 'fill-opacity': 0.16 }, pat);
    el('rect', { width: 3.5, height: 9, fill: '#f0a830' }, pat);
    UI = {};
    for (const arm of ARMS) {
      const cx = A[arm].cx, g = el('g', { id: `v2-${arm}` }, svg);
      let right = '', left = '';
      for (let y = YB1; y <= YB2 + 1e-9; y += 2) {
        const h = hw(y);
        right += `${right ? 'L' : 'M'}${fix(cx + h)} ${fix(y)}`;
        left = `L${fix(cx - h)} ${fix(y)}` + left;
      }
      el('path', { d: `${right}${left}Z`, fill: '#ffffff', 'fill-opacity': 0.028 }, g);
      el('path', { d: right, fill: 'none', stroke: GLASS, 'stroke-width': STROKE }, g);
      el('path', { d: 'M' + left.slice(1), fill: 'none', stroke: GLASS, 'stroke-width': STROKE }, g);
      // drawn 6 px into the glass at both ends so the tube's inner stroke opens the wall
      const pdPts = [[PIPE[0][0] - 6, PIPE[0][1]], ...PIPE, [PIPE[PIPE.length - 1][0] - 6, PIPE[PIPE.length - 1][1]]];
      const pd = pdPts.map((p, i) => `${i ? 'L' : 'M'}${fix(cx + p[0])} ${fix(p[1])}`).join('');
      el('path', { d: pd, fill: 'none', stroke: PIPE_WALL, 'stroke-width': 19, 'stroke-linejoin': 'round' }, g);
      el('path', { d: pd, fill: 'none', stroke: PANEL, 'stroke-width': 16, 'stroke-linejoin': 'round' }, g);
      for (const y of [CAP_TOP, YB2]) el('rect', { x: cx - CAPW, y, width: 2 * CAPW, height: CAP_H, rx: 4, fill: '#262833', stroke: '#4a4e5a', 'stroke-width': 1.5 }, g);
      const plugX = cx - HNW + STROKE / 2 + 1, plugW = 2 * (HNW - STROKE / 2 - 1);
      const plugBase = el('rect', { x: plugX, y: YJ1, width: plugW, height: 0, fill: '#f0a830', 'fill-opacity': 0.9 }, g);
      const plugHatch = el('rect', { x: plugX, y: YJ1, width: plugW, height: 0, fill: 'url(#v2hatch)' }, g);
      for (const L of LABELS) {
        el('line', { x1: cx + L.dot + 10, y1: L.y, x2: cx + L.wall, y2: L.y, stroke: '#4a4e5a', 'stroke-width': 1.5 }, g);
        el('circle', { cx: cx + L.dot, cy: L.y, r: GR, fill: HEX[L.key] }, g);
        div('v2-label', `right:${1920 - (cx + L.right)}px;top:${L.y - 14}px`, L.text, stage);
      }
      let plugUI = null;
      if (arm === 'dyn') {
        const pg = el('g', { opacity: 0 }, g);
        el('rect', { x: cx + PLUG_LABEL.dot - 7, y: PLUG_LABEL.y1 - 7, width: 14, height: 14, fill: 'url(#v2hatch)', stroke: '#f0a830', 'stroke-width': 1.5 }, pg);
        el('line', { x1: cx + PLUG_LABEL.dot + 10, y1: PLUG_LABEL.y1, x2: cx + PLUG_LABEL.wall, y2: PLUG_LABEL.y1, stroke: '#f0a830', 'stroke-width': 1.5 }, pg);
        const txt = div('v2-plug-label', `right:${1920 - (cx + PLUG_LABEL.right)}px;top:${PLUG_LABEL.y1 - 13}px;opacity:0`, 're-reading conversations<br>it forgot', stage);
        plugUI = { pg, txt };
      }
      // each grain has a resting circle and a flying streak (round-capped line); flyers sit in a layer above the piles
      const restG = el('g', {}, g), flyG = el('g', { 'stroke-linecap': 'round', 'stroke-width': 2 * GR }, g), grains = [];
      for (let i = 0; i < N; i++) {
        grains.push([el('circle', { r: GR, cx: 0, cy: 0, fill: '#000' }, restG), el('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: '#000', display: 'none' }, flyG)]);
      }
      // counter row under the panel
      const x0 = X0[arm], ours = arm === 'ours';
      div('counter-label v2-counter-label', `left:${x0 + 24}px`, 'Agents finished', stage);
      const chk = document.createElementNS(SVGNS, 'svg');
      chk.setAttribute('class', 'v2-check');
      chk.setAttribute('width', '64');
      chk.setAttribute('height', '64');
      chk.setAttribute('viewBox', '-32 -32 64 64');
      chk.setAttribute('style', `left:${x0 + 238}px`);
      const ring = el('circle', { r: 20, fill: 'none', stroke: ours ? '#e0313f' : '#e8e9ee', 'stroke-width': 2, opacity: 0 }, chk);
      const disc = el('g', {}, chk);
      el('circle', { r: 18, fill: ours ? '#e0313f' : '#e8e9ee' }, disc);
      el('path', { d: 'M-8.5 0.5 L-2.5 6.5 L9 -5.5', fill: 'none', stroke: '#0f1019', 'stroke-width': 3.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, disc);
      stage.appendChild(chk);
      const num = div(`counter v2-counter${ours ? ' ours' : ''}`, `left:${x0 + 300}px`, '0', stage);
      const clock = div('clock v2-clock', `right:${1920 - (x0 + 876)}px;color:${ours ? 'var(--ours)' : 'var(--fg)'}`, '00:00', stage);
      UI[arm] = { grains, last: grains.map(() => [-1, '', '', '', '', '']), plugBase, plugHatch, plugUI, ring, disc, num, clock, lastNum: -1 };
    }
  }

  function render(t) {
    if (!UI) return;
    const F = frame(t);
    for (const arm of ARMS) {
      const U = UI[arm], R = F[arm];
      for (let i = 0; i < N; i++) {
        const gr = R.grains[i], pair = U.grains[i], L = U.last[i];
        const fly = gr[3], x = fix(gr[0]), y = fix(gr[1]), col = `rgb(${gr[2][0]},${gr[2][1]},${gr[2][2]})`;
        if (L[0] !== fly) { pair[0].setAttribute('display', fly ? 'none' : 'inline'); pair[1].setAttribute('display', fly ? 'inline' : 'none'); L[0] = fly; L[1] = L[2] = L[3] = L[4] = L[5] = ''; }
        if (fly) {
          const c = pair[1], x1 = fix(gr[4] + (Math.abs(gr[4] - gr[0]) + Math.abs(gr[5] - gr[1]) < 0.05 ? 0.05 : 0)), y1 = fix(gr[5]);
          if (L[1] !== x) { c.setAttribute('x2', x); L[1] = x; }
          if (L[2] !== y) { c.setAttribute('y2', y); L[2] = y; }
          if (L[4] !== x1) { c.setAttribute('x1', x1); L[4] = x1; }
          if (L[5] !== y1) { c.setAttribute('y1', y1); L[5] = y1; }
          if (L[3] !== col) { c.setAttribute('stroke', col); L[3] = col; }
        } else {
          const c = pair[0];
          if (L[1] !== x) { c.setAttribute('cx', x); L[1] = x; }
          if (L[2] !== y) { c.setAttribute('cy', y); L[2] = y; }
          if (L[3] !== col) { c.setAttribute('fill', col); L[3] = col; }
        }
      }
      const h = Math.max(0, R.plugH);
      U.plugBase.setAttribute('height', fix(h));
      U.plugHatch.setAttribute('height', fix(h));
      U.plugBase.setAttribute('fill-opacity', lerp(0.9, 0.18, smooth(clamp((h - 3) / 5, 0, 1))).toFixed(2));
      if (U.plugUI) { U.plugUI.pg.setAttribute('opacity', F.plugLabel.toFixed(3)); U.plugUI.txt.style.opacity = F.plugLabel.toFixed(3); }
      if (U.lastNum !== R.finished) { U.num.textContent = String(R.finished); U.lastNum = R.finished; }
      const p = R.since / 0.3, s = p < 1 ? 1 + 0.32 * (1 - p) * (1 - p) : 1;
      U.disc.setAttribute('transform', `scale(${s.toFixed(3)})`);
      const pr = R.since / 0.45;
      U.ring.setAttribute('opacity', pr < 1 ? (0.6 * (1 - pr)).toFixed(3) : '0');
      U.ring.setAttribute('r', pr < 1 ? fix(20 + 10 * pr) : '20');
      U.clock.textContent = F.clock;
    }
  }

  W.V2 = {
    frame, build, wAt, gapAt, hw, SLOTS, PIPE, LABELS, PLUG_LABEL, ARMS, X0, CX_OFF, N,
    C: { LEAD, SPEED, WIN, DURATION, STEP, NSTEP, STEP_V, P, GR, ROW, STROKE, CAP_TOP, CAP_H, YB1, HB, HN, YJ1, YJ2, YB2, RB, HNW, PLUG_SCALE, CAPW, Y_TO, Y_BO, XP, HWMAX, TRAIL },
  };
  if (typeof document !== 'undefined' && W.Stage && document.getElementById('stage')) {
    W.Stage.run({ duration: DURATION, hold: 1.5, name: 'V2 · The hourglass', init, render });
  }
})();
