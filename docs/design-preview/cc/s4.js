// S4: S3 with the cache hit rate back in the header, right of each side name (as in S2). Default: the average cache
// hit so far; ?hit=5min: over the last 5 minutes. Waiting agents form a level by default; ?tiles=agents marks agents.
// Every tile is one of the 126 agents: waiting for its first token, decoding, or in a tool call (the data has almost no
// idle agents: 5 single samples, drawn as tool calls), so both grids are always full and neither side looks smaller.
(() => {
  'use strict';
  const D = window.CC_DATA;
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    fg: '#e8e9ee', muted: '#8b8f9a', faint: '#5f6470', dyn: '#d9dbe1', ours: '#e0313f', track: '#262833',
    wait: '#f0a830', waitBg: '#4a3812', gen: '#3ecf8e', genBg: '#10372a', tool: '#5b8def', toolBg: '#172846', tile: '#191b24', panel: '#12131c', panelLine: '#c9ccd4',
    chipP: '#e8e9ee', chipPText: '#14151c', chipD: '#191b24', chipDLine: '#3a3d48', chipDText: '#c9ccd4', speed: '#9aa0ab',
  };
  const LEAD = 1, SPEED = 90, WIN = 3600;
  // Evolving Infra's first role change (00:20) moves three nodes at once. For the demo it is drawn one node at a time
  // over about 2.8 s of video while the clock and the agents run on at 90x (slightly longer than the real change).
  const OURS0 = D.nodes.ours[0][1], OURS1 = D.nodes.ours[1][1];
  const FIRST = D.nodes.ours[1][0]; // window second of that change
  const NFIRST = [...OURS1].filter((c, n) => c !== OURS0[n]).length;
  const F0 = LEAD + FIRST / SPEED, PAUSE = 0.3, STEP = 0.7;
  const SPAN = PAUSE + NFIRST * STEP + 0.4; // video seconds of the one-at-a-time moves
  const DUR = LEAD + WIN / SPEED + 0.5; // the player then holds the last frame
  const wAt = (t) => Stage.clamp((t - LEAD) * SPEED, 0, WIN);

  const SIDES = [
    { arm: 'dyn', x: 40, line: C.panelLine, tick: C.dyn, num: C.fg },
    { arm: 'ours', x: 980, line: C.ours, tick: C.ours, num: C.ours },
  ];
  const PANEL = { y: 230, w: 900, h: 600 };
  const ROW = { label: 256, y: 266, w: 80, h: 56, gap: 10, inset: 15 }; // chips 266-322, group labels above
  const LANE = 66; // a lane under the row (332-388): moving nodes pass through it, restarting nodes wait in it
  const NOTE_Y = 367;
  const GRID = { y: 402, left: 20, cols: 14, tw: 54, th: 40, gx: 8, gy: 6 }; // 860 x 408, ends at 810
  const BAR = { y: 848, h: 26, pitch: 7.5, w: 4, n: 120 }; // one tick per finished agent
  const HIT = { y: 192, h: 14, w: 220 }; // cache hit meter in the header, right of the side name
  const HITKEY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hit') === '5min' ? 'hit5' : 'hitcum';
  const HITLABEL = HITKEY === 'hit5' ? 'cache hit, last 5 min' : 'avg cache hit';
  // ?tiles=level: amber tiles fill from the bottom row up as a level (a count), instead of marking agents
  const LEVEL = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('tiles') === 'agents');
  const FILL = Array.from({ length: 126 }, (_, q) => (8 - Math.floor(q / 14)) * 14 + (q % 14)); // fill rank of tile q
  const MOVE = 54; // window seconds a node takes to slide to its new place (0.6 s of video)
  const NOTE_S = 270; // window seconds Evolving Infra's switch note stays (3 s of video)

  // In state ch (W waiting for the first token, G decoding) or not, per agent slot every 10 s. The number of tiles in
  // the state equals the measured number of agents in it (averaged over +-60 s); the tiles that show it are the
  // agents that spent most of that +-60 s in it, with a bonus for tiles already in it, so a tile rarely flips.
  // Tiles already taken by another state (taken[s][k] = 1) are skipped.
  function plan(arm, ch, taken) {
    const g = D[arm].grid, K = g.length, R = 6, KEEP = 0.15;
    const raw = g.map((row) => Array.from(row, (c) => (c === ch ? 1 : 0)));
    const cnt = raw.map((r) => r.reduce((a, b) => a + b, 0));
    const sm = Array.from({ length: 126 }, () => new Array(K).fill(0));
    let prev = new Array(126).fill(0);
    for (let k = 0; k < K; k++) {
      const lo = Math.max(0, k - R), hi = Math.min(K - 1, k + R), n = hi - lo + 1;
      let c = 0;
      for (let j = lo; j <= hi; j++) c += cnt[j];
      const target = Math.round(c / n);
      const key = [];
      for (let s = 0; s < 126; s++) {
        if (taken && taken[s][k]) continue;
        let f = 0;
        for (let j = lo; j <= hi; j++) f += raw[j][s];
        key.push([f / n + (prev[s] ? KEEP : 0), s]);
      }
      key.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const now = new Array(126).fill(0);
      for (let q = 0; q < Math.min(target, key.length); q++) now[key[q][1]] = 1;
      for (let s = 0; s < 126; s++) sm[s][k] = now[s];
      prev = now;
    }
    return sm;
  }

  // Node states. Dynamo: planner-log events [node, state, from, to | null] in window seconds, later rows win (as in
  // the video); S = draining (still in its old group), R = restarting (out of service, between the groups).
  // Evolving Infra: [t, roles], S = switching in place (already counted in its new group).
  const dynEv = D.nodes.dyn;
  const dynAt = (w) => {
    const s = D.nodes.dyn_start.split('');
    for (const [n, st, a, b] of dynEv) if (w >= a && (b === null || w < b)) s[n] = st;
    return s;
  };
  const oursTl = D.nodes.ours;
  const oursIdx = (w) => { let k = 0; oursTl.forEach((r, i) => { if (w >= r[0]) k = i; }); return k; };
  function groupOf(arm, n, w) {
    if (arm === 'dyn') {
      const st = dynAt(w)[n];
      if (st === 'R') return 'T';
      if (st !== 'S') return st;
      const ev = dynEv.filter((e) => e[0] === n && e[1] === 'S' && w >= e[2] && (e[3] === null || w < e[3])).pop();
      return groupOf(arm, n, ev[2] - 0.01);
    }
    const i = oursIdx(w), st = oursTl[i][1][n];
    return st === 'S' ? oursTl[Math.min(i + 1, oursTl.length - 1)][1][n] : st;
  }
  // Group changes in time order: [time, node, group]; times are every event boundary.
  function groupEvents(arm) {
    const times = arm === 'dyn'
      ? [...new Set(dynEv.flatMap((e) => [e[2], e[3]]).filter((x) => x !== null))].sort((a, b) => a - b)
      : oursTl.slice(1).map((r) => r[0]);
    const out = [];
    for (const tau of times) {
      for (let n = 0; n < 9; n++) {
        const before = groupOf(arm, n, tau - 0.01), after = groupOf(arm, n, tau);
        if (before !== after) out.push([tau, n, after]);
      }
    }
    return out;
  }
  // Group lists after applying events with time < limit (or <= limit). New members join next to the boundary.
  function lists(arm, limit, inclusive) {
    const start = arm === 'dyn' ? D.nodes.dyn_start : oursTl[0][1];
    const L = { P: [], D: [], T: [] };
    for (let n = 0; n < 9; n++) L[start[n]].push(n);
    L.D.reverse(); // index 0 = rightmost
    const ev = EV[arm].filter((e) => (inclusive ? e[0] <= limit : e[0] < limit));
    for (let i = 0; i < ev.length;) {
      const batch = [];
      for (const tau = ev[i][0]; i < ev.length && ev[i][0] === tau; i++) batch.push(ev[i]);
      // screen order before the batch: P left to right, then T, then D left to right
      const key = (n) => (L.P.includes(n) ? L.P.indexOf(n) : L.T.includes(n) ? 100 : 1000 - L.D.indexOf(n));
      const order = batch.map((e) => [key(e[1]), e[1], e[2]]);
      for (const [, n] of order) for (const k of 'PDT') L[k] = L[k].filter((x) => x !== n);
      order.sort((a, b) => a[0] - b[0]);
      for (const [, n, g] of order) if (g !== 'D') L[g].push(n);
      for (const [, n, g] of [...order].reverse()) if (g === 'D') L.D.push(n);
    }
    return L;
  }
  // Positions: prefill from the left, decode from the right, restarting nodes in the lane under the gap.
  function slots(px, L) {
    const left = px + ROW.inset, right = px + PANEL.w - ROW.inset, pitch = ROW.w + ROW.gap, x = new Array(9), y = new Array(9).fill(ROW.y);
    L.P.forEach((n, i) => { x[n] = left + i * pitch; });
    L.D.forEach((n, j) => { x[n] = right - ROW.w - j * pitch; });
    const pEnd = left + L.P.length * pitch - ROW.gap, dStart = right - L.D.length * pitch + ROW.gap;
    L.T.forEach((n, j) => { x[n] = (pEnd + dStart) / 2 - ROW.w / 2 + (j - (L.T.length - 1) / 2) * pitch; y[n] = ROW.y + LANE; });
    return { x, y };
  }

  const SM = {}, SMG = {}, FIN = {}, EV = {};
  function prep() {
    for (const { arm } of SIDES) {
      SM[arm] = plan(arm, 'W', null);
      SMG[arm] = plan(arm, 'G', SM[arm]);
      FIN[arm] = D[arm].tasks.filter((x) => x[3] === 1 && x[2] !== null && x[2] >= 0 && x[2] < WIN).map((x) => x[2]);
      EV[arm] = groupEvents(arm);
    }
  }

  // Level: waiting tiles fill from the bottom, decoding tiles stack on top of them; the tiles above are in a tool call.
  function levelAlpha(arm, k0, f) {
    const count = (rows) => { let c0 = 0, c1 = 0; for (const row of rows) { c0 += row[k0]; c1 += row[k0 + 1]; } return c0 + (c1 - c0) * f; };
    const nw = count(SM[arm]), ng = count(SMG[arm]);
    const w = FILL.map((r) => Stage.clamp(nw - r, 0, 1));
    return { w, g: FILL.map((r, q) => Stage.clamp(nw + ng - r, 0, 1) - w[q]) };
  }

  // The first change split into one step per node, from the rightmost mover to the leftmost, so each joins the
  // decode group next to the boundary and the end layout equals the batch layout used afterwards.
  const FIRSTSEQ = {};
  function firstSteps(px) {
    if (FIRSTSEQ[px]) return FIRSTSEQ[px];
    const L = lists('ours', FIRST, false);
    const key = (n) => (L.P.includes(n) ? L.P.indexOf(n) : L.T.includes(n) ? 100 : 1000 - L.D.indexOf(n));
    const batch = EV.ours.filter((e) => e[0] === FIRST);
    const movers = batch.map((e) => e[1]).sort((a, b) => key(b) - key(a));
    const cur = { P: [...L.P], D: [...L.D], T: [...L.T] }, layouts = [slots(px, cur)];
    for (const n of movers) {
      const g = batch.find((e) => e[1] === n)[2];
      for (const k of 'PDT') cur[k] = cur[k].filter((x) => x !== n);
      cur[g].push(n);
      layouts.push(slots(px, cur));
    }
    FIRSTSEQ[px] = { movers, layouts };
    return FIRSTSEQ[px];
  }

  // Everything one frame shows, as plain data (a pure function of t).
  function model(t) {
    const w = wAt(t), k = w / 10, k0 = Math.min(Math.floor(k), 359), f = k - k0;
    const out = { w, clock: Stage.fmtClock(w), sides: {} };
    for (const { arm, x: px } of SIDES) {
      const h = D[arm][HITKEY], h0 = h[k0] ?? h[k0 + 1], h1 = h[k0 + 1] ?? h0;
      // nodes: slide from the layout before the last group change to the layout after it
      const past = EV[arm].filter((e) => e[0] <= w);
      const tc = past.length ? past[past.length - 1][0] : -Infinity;
      let from = slots(px, lists(arm, tc, false)), to = slots(px, lists(arm, tc, true));
      let p = Number.isFinite(tc) ? Stage.ease(Stage.seg(w, tc, tc + MOVE)) : 1;
      let moving = new Set(past.filter((e) => e[0] === tc).map((e) => e[1]));
      const firstLook = {}; // looks of the first change's movers while they move one at a time
      let ringOn = (n) => arm === 'ours' && moving.has(n) && w - tc < MOVE + 45;
      if (arm === 'ours' && tc === FIRST) {
        if (t < F0 + SPAN) {
          const seq = firstSteps(px), last = seq.movers.length - 1;
          const i = Stage.clamp(Math.floor((t - F0 - PAUSE) / STEP), 0, last);
          const q = Stage.ease(Stage.seg(t, F0 + PAUSE + i * STEP, F0 + PAUSE + (i + 1) * STEP));
          from = seq.layouts[i]; to = seq.layouts[i + 1]; p = q; moving = new Set([seq.movers[i]]);
          seq.movers.forEach((n, j) => { firstLook[n] = j < i || (j === i && q >= 0.5) ? OURS1[n] : OURS0[n]; });
          ringOn = (n) => n === seq.movers[i] && t >= F0 + PAUSE;
        } else {
          p = 1; // the first change has finished its one-at-a-time moves
          ringOn = () => false;
        }
      }
      const states = arm === 'dyn' ? dynAt(w) : oursTl[oursIdx(w)][1].split('');
      const nodes = [];
      for (let n = 0; n < 9; n++) {
        const st = states[n];
        // P, D or T (restarting); a moving node keeps its old look for the first half of the slide
        const look = firstLook[n] || (moving.has(n) && p < 0.5 ? groupOf(arm, n, tc - 0.01) : groupOf(arm, n, w));
        // a node that changes group dips into the lane while it slides, so it never overlaps the others
        const dip = moving.has(n) && from.y[n] === to.y[n] ? LANE * Math.sin(Math.PI * p) : 0;
        nodes.push({
          n, x: from.x[n] + (to.x[n] - from.x[n]) * p, y: from.y[n] + (to.y[n] - from.y[n]) * p + dip, look,
          draining: arm === 'dyn' && st === 'S',
          ring: ringOn(n),
        });
      }
      let note = null;
      if (arm === 'dyn') {
        for (const [n, st, a, b] of dynEv) {
          // the restart time counts up, 1 min, 2 min, ..., to the length of this restart
          if (st === 'R' && w >= a + MOVE / 2 && b !== null && w < b) {
            const m = Math.min(Math.floor((w - a) / 60) + 1, Math.round((b - a) / 60));
            note = { n, side: 'right', text: `restarting · ${m} min` };
          }
        }
      } else {
        if (t >= F0 + PAUSE && t < F0 + SPAN + 1.2) {
          const fin = firstSteps(px).layouts[NFIRST], xs = firstSteps(px).movers.map((n) => fin.x[n] + ROW.w / 2);
          note = { x: (Math.min(...xs) + Math.max(...xs)) / 2, side: 'at', text: 'switched in place' };
        }
        for (let j = 1; j < oursTl.length - 1; j++) {
          const n = oursTl[j][1].indexOf('S');
          if (n >= 0 && w >= oursTl[j][0] + MOVE && w < oursTl[j][0] + MOVE + NOTE_S) note = { n, side: 'under', text: `switched in ${Math.round(oursTl[j + 1][0] - oursTl[j][0])} s` };
        }
      }
      out.sides[arm] = {
        ...(LEVEL ? (({ w: alpha, g: galpha }) => ({ alpha, galpha }))(levelAlpha(arm, k0, f)) : {
          alpha: SM[arm].map((row) => row[k0] + (row[k0 + 1] - row[k0]) * f),
          galpha: SMG[arm].map((row) => row[k0] + (row[k0 + 1] - row[k0]) * f),
        }),
        finished: FIN[arm].filter((e) => e <= w).length,
        hit: h0 + (h1 - h0) * f,
        nodes, note,
      };
      const sd = out.sides[arm];
      sd.talpha = sd.alpha.map((a, q) => Stage.clamp(1 - a - sd.galpha[q], 0, 1)); // every other agent is in a tool call
    }
    return out;
  }

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const HOURGLASS = 'M-7,-10H7L1.6,-1.2V1.2L7,10H-7L-1.6,1.2V-1.2Z';
  const SPARK = 'M0,-10C1.2,-3.2 3.2,-1.2 10,0C3.2,1.2 1.2,3.2 0,10C-1.2,3.2 -3.2,1.2 -10,0C-3.2,-1.2 -1.2,-3.2 0,-10Z';
  const TOOL = 'M-9,-7L-2,0L-9,7M1,7H10'; // a terminal prompt, drawn with a stroke
  const RESTART = 'M9,0A9,9 0 1 1 6.36,-6.36M6.36,-6.36L1.53,-7.65M6.36,-6.36L5.07,-11.19';
  const V = {};

  function init() {
    prep();
    const svg = document.getElementById('scene');
    for (const s of SIDES) {
      const g = el('g', {}, svg);
      el('rect', { x: s.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 6, fill: C.panel, stroke: s.line, 'stroke-width': 2 }, g);
      el('text', { x: s.x + ROW.inset, y: ROW.label, 'font-size': 18, 'letter-spacing': 1, fill: C.muted }, g).textContent = 'PREFILL';
      el('text', { x: s.x + PANEL.w - ROW.inset, y: ROW.label, 'text-anchor': 'end', 'font-size': 18, 'letter-spacing': 1, fill: C.muted }, g).textContent = 'DECODE';
      const chips = [];
      for (let n = 0; n < 9; n++) {
        const cg = el('g', {}, g);
        const ring = el('rect', { x: -6, y: -6, width: ROW.w + 12, height: ROW.h + 12, rx: 10, fill: 'none', stroke: C.ours, 'stroke-width': 3, opacity: 0 }, cg);
        const box = el('rect', { width: ROW.w, height: ROW.h, rx: 6 }, cg);
        const txt = el('text', { x: ROW.w / 2, y: ROW.h / 2 + 10, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 600 }, cg);
        const icon = el('path', { d: RESTART, transform: `translate(${ROW.w / 2},${ROW.h / 2}) scale(1.35)`, fill: 'none', stroke: C.muted, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0 }, cg);
        chips.push({ g: cg, ring, box, txt, icon });
      }
      const note = el('text', { y: NOTE_Y, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 500, fill: s.arm === 'ours' ? C.ours : C.fg, opacity: 0 }, g);
      const tiles = [];
      for (let q = 0; q < 126; q++) {
        const r = Math.floor(q / GRID.cols), c = q % GRID.cols;
        const tg = el('g', { transform: `translate(${s.x + GRID.left + c * (GRID.tw + GRID.gx)},${GRID.y + r * (GRID.th + GRID.gy)})` }, g);
        el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.tile }, tg);
        const blue = el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.toolBg, opacity: 0 }, tg);
        const term = el('path', { d: TOOL, transform: `translate(${GRID.tw / 2},${GRID.th / 2})`, fill: 'none', stroke: C.tool, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, tg);
        const green = el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.genBg, opacity: 0 }, tg);
        const spark = el('path', { d: SPARK, transform: `translate(${GRID.tw / 2},${GRID.th / 2})`, fill: C.gen, opacity: 0 }, tg);
        const amber = el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.waitBg }, tg);
        const icon = el('path', { d: HOURGLASS, transform: `translate(${GRID.tw / 2},${GRID.th / 2})`, fill: C.wait }, tg);
        tiles.push({ amber, icon, green, spark, blue, term });
      }
      const ticks = [];
      for (let q = 0; q < BAR.n; q++) ticks.push(el('rect', { x: s.x + q * BAR.pitch, y: BAR.y, width: BAR.w, height: BAR.h, rx: 1, fill: s.tick, opacity: 0 }, g));
      el('text', { x: s.x, y: 932, 'font-size': 22, 'letter-spacing': 1, fill: C.muted }, g).textContent = 'AGENTS FINISHED';
      const num = el('text', { x: s.x + 250, y: 948, 'font-size': 58, 'font-weight': 600, fill: s.num }, g);
      // header meter: cache hit, right of the side name
      el('text', { x: s.x + PANEL.w - 112 - HIT.w - 14, y: 206, 'text-anchor': 'end', 'font-size': 22, fill: C.muted }, g).textContent = HITLABEL;
      el('rect', { x: s.x + PANEL.w - 112 - HIT.w, y: HIT.y, width: HIT.w, height: HIT.h, rx: 3, fill: C.track }, g);
      const hitBar = el('rect', { x: s.x + PANEL.w - 112 - HIT.w, y: HIT.y, width: 0, height: HIT.h, rx: 3, fill: s.tick }, g);
      const hitNum = el('text', { x: s.x + PANEL.w, y: 212, 'text-anchor': 'end', 'font-size': 36, 'font-weight': 600, fill: s.num }, g);
      V[s.arm] = { chips, note, tiles, ticks, num, hitBar, hitNum, x: s.x };
    }
    const clock = el('text', { x: 960, y: 1002, 'text-anchor': 'middle' }, svg);
    el('tspan', { 'font-size': 22, 'letter-spacing': 1, fill: C.muted }, clock).textContent = 'ELAPSED';
    V.clock = el('tspan', { dx: 14, 'font-size': 40, 'font-weight': 600, fill: C.fg }, clock);
    const lg = el('g', { transform: 'translate(590,1024)' }, svg);
    el('rect', { width: 36, height: 28, rx: 4, fill: C.waitBg }, lg);
    el('path', { d: HOURGLASS, transform: 'translate(18,14) scale(0.8)', fill: C.wait }, lg);
    el('text', { x: 50, y: 22, 'font-size': 22, fill: C.muted }, lg).textContent = 'waiting for first token (TTFT)';
    el('rect', { x: 390, width: 36, height: 28, rx: 4, fill: C.genBg }, lg);
    el('path', { d: SPARK, transform: 'translate(408,14) scale(0.8)', fill: C.gen }, lg);
    el('text', { x: 440, y: 22, 'font-size': 22, fill: C.muted }, lg).textContent = 'decoding';
    el('rect', { x: 552, width: 36, height: 28, rx: 4, fill: C.toolBg }, lg);
    el('path', { d: TOOL, transform: 'translate(570,14) scale(0.8)', fill: 'none', stroke: C.tool, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lg);
    el('text', { x: 602, y: 22, 'font-size': 22, fill: C.muted }, lg).textContent = 'in a tool call';
    el('path', { d: 'M0,0L12,8L0,16ZM14,0L26,8L14,16Z', transform: 'translate(1786,1026)', fill: C.speed }, svg);
    el('text', { x: 1880, y: 1046, 'text-anchor': 'end', 'font-size': 30, fill: C.speed }, svg).textContent = '90×';
  }

  function paintChip(c, nd) {
    const P = nd.look === 'P', R = nd.look === 'T';
    c.g.setAttribute('transform', `translate(${nd.x.toFixed(1)},${nd.y.toFixed(1)})`);
    c.box.setAttribute('fill', R ? 'none' : (P ? C.chipP : C.chipD));
    c.box.setAttribute('stroke', nd.draining ? C.wait : (R ? C.faint : (P ? 'none' : C.chipDLine)));
    c.box.setAttribute('stroke-width', nd.draining ? 3 : 2);
    c.box.setAttribute('stroke-dasharray', R ? '7 6' : 'none');
    c.txt.textContent = R ? '' : nd.look;
    c.txt.setAttribute('fill', P ? C.chipPText : C.chipDText);
    c.icon.setAttribute('opacity', R ? 1 : 0);
    c.ring.setAttribute('opacity', nd.ring ? 1 : 0);
  }

  function render(t) {
    const m = model(t);
    for (const s of SIDES) {
      const v = V[s.arm], ms = m.sides[s.arm];
      ms.alpha.forEach((a, q) => {
        const o = a.toFixed(3), og = ms.galpha[q].toFixed(3), ot = ms.talpha[q].toFixed(3);
        v.tiles[q].amber.setAttribute('opacity', o);
        v.tiles[q].icon.setAttribute('opacity', o);
        v.tiles[q].green.setAttribute('opacity', og);
        v.tiles[q].spark.setAttribute('opacity', og);
        v.tiles[q].blue.setAttribute('opacity', ot);
        v.tiles[q].term.setAttribute('opacity', ot);
      });
      ms.nodes.forEach((nd) => paintChip(v.chips[nd.n], nd));
      if (ms.note) {
        const nd = ms.nodes[ms.note.n];
        if (ms.note.side === 'at') {
          v.note.setAttribute('text-anchor', 'middle');
          v.note.setAttribute('x', ms.note.x);
        } else if (ms.note.side === 'right') {
          v.note.setAttribute('text-anchor', 'start');
          v.note.setAttribute('x', nd.x + ROW.w + 16);
        } else {
          v.note.setAttribute('text-anchor', 'middle');
          v.note.setAttribute('x', Stage.clamp(nd.x + ROW.w / 2, v.x + 110, v.x + PANEL.w - 110));
        }
        v.note.textContent = ms.note.text;
        v.note.setAttribute('opacity', 1);
      } else {
        v.note.setAttribute('opacity', 0);
      }
      v.ticks.forEach((tk, q) => tk.setAttribute('opacity', q < ms.finished ? 1 : 0));
      v.num.textContent = String(ms.finished);
      v.hitBar.setAttribute('width', (HIT.w * ms.hit).toFixed(1));
      v.hitNum.textContent = `${Math.round(ms.hit * 100)}%`;
    }
    V.clock.textContent = m.clock;
  }

  window.S4 = { model, prep, DUR, HITKEY, LEVEL };
  if (typeof document !== 'undefined' && document.getElementById('stage')) Stage.run({ duration: DUR, name: `S4 · Cache hit in the header (${HITKEY === 'hit5' ? 'last 5 min' : 'average'})`, init, render });
})();
