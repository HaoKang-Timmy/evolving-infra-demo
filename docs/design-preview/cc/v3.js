// V3 · Read once, or read again. Claude Code workload, the 60-minute window at 90x.
// Each side: a plain block for the model. Sheets of conversation text fall into it and land in two piles:
// white = new reading, amber = re-reading a conversation it had read before and forgotten (the avoidable part:
// reusable context that had been evicted). Answer dots stream out of the block.
// Units: 1 sheet = 1M recomputed prompt tokens; 1 dot = 10 completed model calls.
// render(t) is a pure function of t: every sheet and dot time is precomputed from CC_DATA[arm].per10.
(() => {
  'use strict';

  // ---- timeline (playback seconds) ----
  const LEAD = 1;                     // lead-in at 00:00
  const SPEED = 90;                   // window seconds per playback second (badge "90×")
  const WIN = 3600;                   // scored window, shown as 00:00-60:00
  const T_END = LEAD + WIN / SPEED;   // 41 s: the clock reaches 60:00
  const DURATION = T_END + 3;         // 44 s: 3 s of end state with the caption
  const tOf = (w) => LEAD + w / SPEED;

  // ---- data units ----
  const SHEET_K = 1000;               // per10 token columns are in thousands: 1 sheet = 1M tokens
  const DOT_CALLS = 10;               // 1 answer dot = 10 completed model calls

  // ---- panel geometry: local px inside the 2 px panel border (896 x 596) ----
  // stage x = panel left + 2 + local x; stage y = 232 + local y
  const IN_W = 896, IN_H = 596;
  const BLOCK = { x: 298, y: 150, w: 300, h: 180, r: 16 };
  const BCX = BLOCK.x + BLOCK.w / 2;            // 448
  const FLOOR = 516, PITCH = 4, LAYER_H = 3, PILE_W = 120;
  const PILE_X = { n: 156, a: 740 };            // pile centres: n = new reading (left), a = re-reading (right)
  const LABEL_TOP = 530;
  const PAGE_W = 46, PAGE_H = 58;
  // a sheet's motion, relative to its read time t_k (the moment it is fully inside the block)
  const FALL = 0.7, HIDE = 0.2, ARC = 0.65, LAND = HIDE + ARC;
  const FALL_Y0 = -40, FALL_Y1 = 185;           // page centre: hidden above the panel -> fully inside the block
  const ARC_DX = 95, ARC_Y0 = 205, ARC_LIFT = 50;
  const LANES = [-76, 38, -38, 76, 0];          // x offsets of the falling sheets (all inside the block's width)
  // answer dots
  const DOT_LIFE = 1.4, DOT_Y0 = 338, DOT_Y1 = 500, DOT_R = 4.5;
  const COL = { n: '#d6d8de', nInk: '#7d818c', a: '#f0a830', aInk: '#8a5a12', dot: '#3ecf8e' };
  const INK = [[-15, -18, 30], [-15, -10, 26], [-15, -2, 30], [-15, 6, 30], [-15, 14, 16]];  // page text lines

  // ---- small helpers (same formulas as stage.js, local so node tests can run without the DOM) ----
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  // number of entries of the sorted array a that are <= x
  const countLE = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };
  // deterministic pseudo-random number in [0, 1)
  const hash01 = (i) => {
    let x = (i * 2654435761) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0; x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };

  // ---- schedule: when each sheet is read, its colour, and when each answer dot leaves ----
  // per10 rows: [t, calls completed, prompt tokens recomputed (k), avoidable part (k), median wait]
  function buildArm(per10) {
    const n = per10.length, cR = [0], cA = [0], cC = [0];
    for (let i = 0; i < n; i++) {
      cR.push(cR[i] + per10[i][2]); cA.push(cA[i] + per10[i][3]); cC.push(cC[i] + per10[i][1]);
    }
    // first window second at which the cumulative series c reaches v (linear inside each 10 s bin)
    const inv = (c, v) => {
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (c[m + 1] >= v) hi = m; else lo = m + 1; }
      const d = c[lo + 1] - c[lo];
      return 10 * lo + (d > 0 ? (10 * (v - c[lo])) / d : 10);
    };
    const at = (c, w) => { const x = w / 10, i = Math.min(Math.floor(x), n - 1); return c[i] + (c[i + 1] - c[i]) * (x - i); };

    // Sheet k is read when the running total passes k - 0.5 million, so the piles hold round(total) sheets
    // (105 and 121). Its colour goes to the kind (avoidable re-reading or new reading) with more reading not yet
    // shown as sheets at that moment, so the piles follow the running totals and end at round(avoidable) amber.
    const sheets = [];
    const K = Math.floor(cR[n] / SHEET_K + 0.5);
    let na = 0, nn = 0;
    for (let k = 1; k <= K; k++) {
      const v = (k - 0.5) * SHEET_K, w = inv(cR, v);
      const A = at(cA, w) / SHEET_K, N = v / SHEET_K - A;
      const amber = A - na > N - nn;
      sheets.push({ k, w, t: tOf(w), amber, idx: amber ? na : nn, lane: LANES[(k - 1) % LANES.length] });
      if (amber) na++; else nn++;
    }
    // Dot j leaves the block when the running total of completed calls passes 10 j.
    const J = Math.floor(cC[n] / DOT_CALLS), dots = new Array(J), du = new Array(J);
    for (let j = 1; j <= J; j++) {
      dots[j - 1] = tOf(inv(cC, j * DOT_CALLS));
      du[j - 1] = hash01(j) + hash01(j + 7919) - 1;   // spread across the stream, denser in the middle
    }
    return {
      sheets, tArr: sheets.map((s) => s.t), nAmber: na, nNew: nn, dots, du,
      land: { n: sheets.filter((s) => !s.amber).map((s) => s.t + LAND), a: sheets.filter((s) => s.amber).map((s) => s.t + LAND) },
      totals: { recomputedK: cR[n], avoidableK: cA[n], calls: cC[n] },
    };
  }

  // largest number of entries of the sorted array inside any half-open window of length len
  function maxOverlap(times, len) {
    let best = 0, j = 0;
    for (let i = 0; i < times.length; i++) { while (times[j] <= times[i] - len) j++; best = Math.max(best, i - j + 1); }
    return best;
  }

  // Pose of a sheet at time t, or null while it is not drawn. Falls into the block, hides inside it for HIDE s,
  // then slides out of the side (white left, amber right) and is laid flat on top of its pile.
  function sheetPose(s, t) {
    const dt = t - s.t;
    if (dt < -FALL || dt >= LAND || (dt >= 0 && dt < HIDE)) return null;
    if (dt < 0) {
      const u = (dt + FALL) / FALL;
      return { x: BCX + s.lane, y: lerp(FALL_Y0, FALL_Y1, u), sx: 1, sy: 1, ink: 1 };
    }
    const u = (dt - HIDE) / ARC;
    const x0 = BCX + (s.amber ? ARC_DX : -ARC_DX), x1 = s.amber ? PILE_X.a : PILE_X.n;
    const y1 = FLOOR - (s.idx + 1) * PITCH + LAYER_H / 2;
    const f = ease(seg(u, 0.55, 1));
    return {
      x: lerp(x0, x1, u), y: lerp(ARC_Y0, y1, u) - ARC_LIFT * 4 * u * (1 - u),
      sx: lerp(1, PILE_W / PAGE_W, f), sy: lerp(1, LAYER_H / PAGE_H, f), ink: 1 - f,
    };
  }

  // Pose of answer dot j (leaves at te) at time t, or null.
  function dotPose(te, d, t) {
    const u = (t - te) / DOT_LIFE;
    if (u < 0 || u >= 1) return null;
    return { x: BCX + d * lerp(60, 105, u), y: lerp(DOT_Y0, DOT_Y1, u), o: Math.min(1, u / 0.08) * (1 - ease(seg(u, 0.6, 1))) };
  }

  const api = {
    LEAD, SPEED, WIN, T_END, DURATION, SHEET_K, DOT_CALLS, IN_W, IN_H, BLOCK, FLOOR, PITCH, LAYER_H, PILE_W, PILE_X,
    PAGE_W, PAGE_H, FALL, HIDE, ARC, LAND, DOT_LIFE, DOT_R, LABEL_TOP, buildArm, maxOverlap, sheetPose, dotPose,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document === 'undefined' || !window.Stage) return;

  // ---- DOM: built once in init, updated in render ----
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const label = (parent, cls, text, x, y, w, color) => {
    const e = document.createElement('div');
    e.className = cls;
    e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.width = w + 'px';
    if (color) e.style.color = color;
    e.innerHTML = text;
    parent.appendChild(e);
    return e;
  };

  const SIDES = [];
  let caption = null;

  function buildSide(arm) {
    const S = Object.assign({ arm }, buildArm(window.CC_DATA[arm].per10));
    const panel = document.getElementById('v3-panel-' + arm);
    const svg = sv('svg', { class: 'v3-svg', width: IN_W, height: IN_H, viewBox: `0 0 ${IN_W} ${IN_H}` }, panel);

    for (const key of ['n', 'a']) {   // floor under each pile
      sv('rect', { x: PILE_X[key] - PILE_W / 2 - 16, y: FLOOR + 1, width: PILE_W + 32, height: 2, rx: 1, fill: '#30333f' }, svg);
    }
    S.layers = { n: [], a: [] };
    S.shown = { n: -1, a: -1 };
    for (const key of ['n', 'a']) {   // one layer per sheet, shown when that sheet has landed
      const total = key === 'a' ? S.nAmber : S.nNew;
      for (let i = 0; i < total; i++) {
        S.layers[key].push(sv('rect', { x: PILE_X[key] - PILE_W / 2, y: FLOOR - (i + 1) * PITCH, width: PILE_W, height: LAYER_H, rx: 1, fill: COL[key] }, svg));
      }
    }
    const top = FLOOR - S.nAmber * PITCH;   // end state: outline the full re-read pile the caption talks about
    S.outline = sv('rect', { x: PILE_X.a - PILE_W / 2 - 12, y: top - 12, width: PILE_W + 24, height: FLOOR - top + 18, rx: 8, fill: 'none', stroke: COL.a, 'stroke-width': 2, opacity: 0 }, svg);

    S.dotEls = [];
    const nDots = maxOverlap(S.dots, DOT_LIFE) + 2;
    for (let i = 0; i < nDots; i++) S.dotEls.push(sv('circle', { cx: 0, cy: 0, r: DOT_R, fill: COL.dot, opacity: 0 }, svg));

    S.sheetEls = [];
    const nSheets = maxOverlap(S.tArr, FALL + LAND) + 2;
    for (let i = 0; i < nSheets; i++) {
      const g = sv('g', {}, svg);
      const page = sv('rect', { x: -PAGE_W / 2, y: -PAGE_H / 2, width: PAGE_W, height: PAGE_H, rx: 3 }, g);
      const ink = sv('g', {}, g);
      for (const [x, y, w] of INK) sv('rect', { x, y, width: w, height: 3, rx: 1.5 }, ink);
      g.style.display = 'none';
      S.sheetEls.push({ g, page, ink, amber: null, on: false });
    }

    // the model block, drawn over the sheets so they disappear into it and slide out of its sides
    sv('rect', { x: BLOCK.x, y: BLOCK.y, width: BLOCK.w, height: BLOCK.h, rx: BLOCK.r, fill: '#1a1c28', stroke: '#4a4e5d', 'stroke-width': 2 }, svg);

    const m = label(panel, 'v3-model', 'model', BLOCK.x, BLOCK.y, BLOCK.w);
    m.style.height = BLOCK.h + 'px';
    label(panel, 'v3-lbl', 'new reading', PILE_X.n - 150, LABEL_TOP, 300, COL.n);
    S.answersLbl = label(panel, 'v3-lbl', 'answers', BCX - 100, LABEL_TOP, 200, COL.dot);
    label(panel, 'v3-lbl', 're-reading conversations<br>it forgot', PILE_X.a - 150, LABEL_TOP, 300, COL.a);

    S.countEl = document.getElementById('v3-count-' + arm);
    S.clockEl = document.getElementById('v3-clock-' + arm);
    S.calls = -1;
    return S;
  }

  function renderSide(S, t, w, clock) {
    if (S.clockEl.textContent !== clock) S.clockEl.textContent = clock;
    const calls = Math.round(Stage.cumAt(S.arm, 'cum_req', w));
    if (calls !== S.calls) { S.calls = calls; S.countEl.textContent = calls.toLocaleString('en-US'); }

    for (const key of ['n', 'a']) {   // piles: layers of the sheets that have landed
      const n = countLE(S.land[key], t);
      if (n !== S.shown[key]) {
        const L = S.layers[key];
        for (let i = 0; i < L.length; i++) L[i].style.display = i < n ? '' : 'none';
        S.shown[key] = n;
      }
    }

    let p = 0;   // sheets in flight
    const lo = countLE(S.tArr, t - LAND), hi = countLE(S.tArr, t + FALL);
    for (let i = lo; i < hi && p < S.sheetEls.length; i++) {
      const s = S.sheets[i], q = sheetPose(s, t);
      if (!q) continue;
      const E = S.sheetEls[p++];
      if (!E.on) { E.g.style.display = ''; E.on = true; }
      if (E.amber !== s.amber) {
        E.amber = s.amber;
        E.page.setAttribute('fill', s.amber ? COL.a : COL.n);
        E.ink.setAttribute('fill', s.amber ? COL.aInk : COL.nInk);
      }
      E.g.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) scale(${q.sx.toFixed(4)} ${q.sy.toFixed(4)})`);
      E.ink.setAttribute('opacity', q.ink.toFixed(3));
    }
    for (; p < S.sheetEls.length; p++) { const E = S.sheetEls[p]; if (E.on) { E.g.style.display = 'none'; E.on = false; } }

    p = 0;   // answer dots
    const dlo = countLE(S.dots, t - DOT_LIFE), dhi = countLE(S.dots, t);
    for (let j = dlo; j < dhi && p < S.dotEls.length; j++) {
      const q = dotPose(S.dots[j], S.du[j], t);
      if (!q) continue;
      const c = S.dotEls[p++];
      c.setAttribute('cx', q.x.toFixed(1)); c.setAttribute('cy', q.y.toFixed(1)); c.setAttribute('opacity', q.o.toFixed(3));
    }
    for (; p < S.dotEls.length; p++) S.dotEls[p].setAttribute('opacity', '0');

    // end state: outline the full re-read pile; dim "answers" once the last dots have drained (window over)
    S.outline.setAttribute('opacity', (0.75 * ease(seg(t, T_END + 0.2, T_END + 0.8))).toFixed(3));
    S.answersLbl.style.opacity = (1 - 0.55 * ease(seg(t, T_END + 0.6, T_END + 1.4))).toFixed(3);
  }

  Stage.run({
    duration: DURATION,
    name: 'V3 · Read once, or read again',
    init() {
      SIDES.push(buildSide('dyn'), buildSide('ours'));
      caption = document.getElementById('v3-caption');
    },
    render(t) {
      const w = clamp((t - LEAD) * SPEED, 0, WIN), clock = Stage.fmtClock(w);
      for (const S of SIDES) renderSide(S, t, w, clock);
      const k = ease(seg(t, T_END, T_END + 0.5));   // the only caption: end state, after 60:00
      caption.style.opacity = k.toFixed(3);
      caption.style.transform = `translateY(${((1 - k) * 12).toFixed(1)}px)`;
    },
  });
})();
