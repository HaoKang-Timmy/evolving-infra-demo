// S1: the current part 2, simplified. Tiles show only "waiting for the model" or not, without flicker; part 1's
// progress bar counts finished agents; one cause: Dynamo restarts a node to change its role (out of service for
// minutes) while Evolving Infra changes a node's role in place.
(() => {
  'use strict';
  const D = window.CC_DATA;
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    fg: '#e8e9ee', muted: '#8b8f9a', faint: '#5f6470', dyn: '#d9dbe1', ours: '#e0313f',
    wait: '#f0a830', waitBg: '#4a3812', tile: '#191b24', panel: '#12131c', panelLine: '#c9ccd4',
    chipP: '#e8e9ee', chipPText: '#14151c', chipD: '#191b24', chipDLine: '#3a3d48', chipDText: '#c9ccd4', speed: '#9aa0ab',
  };
  const LEAD = 1, SPEED = 90, WIN = 3600;
  const DUR = LEAD + WIN / SPEED + 0.5; // 41.5 s; the player then holds the last frame
  const wAt = (t) => Stage.clamp((t - LEAD) * SPEED, 0, WIN);

  const SIDES = [
    { arm: 'dyn', x: 40, line: C.panelLine, tick: C.dyn, num: C.fg },
    { arm: 'ours', x: 980, line: C.ours, tick: C.ours, num: C.ours },
  ];
  const PANEL = { y: 230, w: 900, h: 600 };
  const CHIP = { y: 248, w: 86, h: 60, gap: 12, left: 15 }; // 9 x 86 + 8 x 12 = 870
  const NOTE_Y = 350; // baseline of the note under the chips
  const GRID = { y: 372, left: 20, cols: 14, tw: 54, th: 42, gx: 8, gy: 7 }; // 860 x 434
  const BAR = { y: 848, h: 26, pitch: 7.5, w: 4, n: 120 }; // one tick per finished agent
  const RING_S = 45; // window seconds a role-change ring stays (0.5 s of video)
  const NOTE_S = 270; // window seconds Evolving Infra's switch note stays (3 s of video)

  // Waiting (1) or not (0) per agent slot every 10 s. The number of waiting tiles equals the measured number of
  // waiting agents (averaged over +-60 s, so the shown share matches the data). The tiles that show it are the agents
  // that waited most in that +-60 s, with a bonus for tiles already waiting, so a tile rarely flips.
  function plan(arm) {
    const g = D[arm].grid, K = g.length, R = 6, KEEP = 0.15;
    const raw = g.map((row) => Array.from(row, (ch) => (ch === 'W' ? 1 : 0)));
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
        let f = 0;
        for (let j = lo; j <= hi; j++) f += raw[j][s];
        key.push([f / n + (prev[s] ? KEEP : 0), s]);
      }
      key.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const now = new Array(126).fill(0);
      for (let q = 0; q < target; q++) now[key[q][1]] = 1;
      for (let s = 0; s < 126; s++) sm[s][k] = now[s];
      prev = now;
    }
    return sm;
  }

  // Dynamo: planner-log events [node, state, from, to | null] in window seconds, later rows win (as in the video).
  const dynEv = D.nodes.dyn;
  const dynAt = (w) => {
    const s = D.nodes.dyn_start.split('');
    for (const [n, st, a, b] of dynEv) if (w >= a && (b === null || w < b)) s[n] = st;
    return s;
  };
  // Evolving Infra: [t, roles] with S = switching in place.
  const oursTl = D.nodes.ours;
  const oursIdx = (w) => { let k = 0; oursTl.forEach((r, i) => { if (w >= r[0]) k = i; }); return k; };

  const SM = {}, FIN = {};
  function prep() {
    for (const { arm } of SIDES) {
      SM[arm] = plan(arm);
      FIN[arm] = D[arm].tasks.filter((x) => x[3] === 1 && x[2] !== null && x[2] >= 0 && x[2] < WIN).map((x) => x[2]);
    }
  }

  // Everything one frame shows, as plain data (a pure function of t).
  function model(t) {
    const w = wAt(t), k = w / 10, k0 = Math.min(Math.floor(k), 359), f = k - k0;
    const out = { w, clock: Stage.fmtClock(w), sides: {} };
    for (const { arm } of SIDES) {
      out.sides[arm] = {
        alpha: SM[arm].map((row) => row[k0] + (row[k0 + 1] - row[k0]) * f),
        finished: FIN[arm].filter((e) => e <= w).length,
        chips: [], note: null,
      };
    }
    const ds = dynAt(w);
    out.sides.dyn.chips = ds.map((st, n) => {
      if (st !== 'S') return { st, letter: st === 'P' || st === 'D' ? st : '', ring: false };
      const ev = dynEv.filter((e) => e[0] === n && e[1] === 'S' && w >= e[2] && (e[3] === null || w < e[3])).pop();
      const before = dynAt(ev[2] - 0.01)[n];
      return { st, letter: before === 'P' || before === 'D' ? before : '', ring: false };
    });
    for (const [n, st, a, b] of dynEv) {
      if (st === 'R' && w >= a && b !== null && w < b) out.sides.dyn.note = { n, text: `restarting · ${Math.round((b - a) / 60)} min` };
    }
    const i = oursIdx(w), roles = oursTl[i][1];
    out.sides.ours.chips = roles.split('').map((st, n) => {
      const shown = st === 'S' ? (i > 0 ? oursTl[i - 1][1][n] : 'D') : st;
      let tc = -Infinity;
      for (let j = 1; j < oursTl.length; j++) if (oursTl[j][0] <= w && oursTl[j][1][n] !== oursTl[j - 1][1][n]) tc = oursTl[j][0];
      return { st: shown, letter: shown, ring: st === 'S' || w - tc < RING_S };
    });
    for (let j = 1; j < oursTl.length - 1; j++) {
      const n = oursTl[j][1].indexOf('S');
      if (n >= 0 && w >= oursTl[j][0] && w < oursTl[j][0] + NOTE_S) {
        out.sides.ours.note = { n, text: `switched in ${Math.round(oursTl[j + 1][0] - oursTl[j][0])} s` };
      }
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
  const RESTART = 'M9,0A9,9 0 1 1 6.36,-6.36M6.36,-6.36L1.53,-7.65M6.36,-6.36L5.07,-11.19';
  const V = {};

  function init() {
    prep();
    const svg = document.getElementById('scene');
    for (const s of SIDES) {
      const g = el('g', {}, svg);
      el('rect', { x: s.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 6, fill: C.panel, stroke: s.line, 'stroke-width': 2 }, g);
      const chips = [];
      for (let n = 0; n < 9; n++) {
        const cx = s.x + CHIP.left + n * (CHIP.w + CHIP.gap);
        const cg = el('g', { transform: `translate(${cx},${CHIP.y})` }, g);
        const ring = el('rect', { x: -6, y: -6, width: CHIP.w + 12, height: CHIP.h + 12, rx: 10, fill: 'none', stroke: C.ours, 'stroke-width': 3, opacity: 0 }, cg);
        const box = el('rect', { width: CHIP.w, height: CHIP.h, rx: 6 }, cg);
        const txt = el('text', { x: CHIP.w / 2, y: CHIP.h / 2 + 10, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 600 }, cg);
        const icon = el('path', { d: RESTART, transform: `translate(${CHIP.w / 2},${CHIP.h / 2}) scale(1.35)`, fill: 'none', stroke: C.muted, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0 }, cg);
        chips.push({ ring, box, txt, icon, mid: cx + CHIP.w / 2 });
      }
      const note = el('text', { y: NOTE_Y, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 500, fill: s.arm === 'ours' ? C.ours : C.fg, opacity: 0 }, g);
      const tiles = [];
      for (let q = 0; q < 126; q++) {
        const r = Math.floor(q / GRID.cols), c = q % GRID.cols;
        const tg = el('g', { transform: `translate(${s.x + GRID.left + c * (GRID.tw + GRID.gx)},${GRID.y + r * (GRID.th + GRID.gy)})` }, g);
        el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.tile }, tg);
        const amber = el('rect', { width: GRID.tw, height: GRID.th, rx: 4, fill: C.waitBg }, tg);
        const icon = el('path', { d: HOURGLASS, transform: `translate(${GRID.tw / 2},${GRID.th / 2})`, fill: C.wait }, tg);
        tiles.push({ amber, icon });
      }
      const ticks = [];
      for (let q = 0; q < BAR.n; q++) ticks.push(el('rect', { x: s.x + q * BAR.pitch, y: BAR.y, width: BAR.w, height: BAR.h, rx: 1, fill: s.tick, opacity: 0 }, g));
      el('text', { x: s.x, y: 932, 'font-size': 22, 'letter-spacing': 1, fill: C.muted }, g).textContent = 'AGENTS FINISHED';
      const num = el('text', { x: s.x + 250, y: 948, 'font-size': 58, 'font-weight': 600, fill: s.num }, g);
      V[s.arm] = { chips, note, tiles, ticks, num, x: s.x };
    }
    const clock = el('text', { x: 960, y: 1002, 'text-anchor': 'middle' }, svg);
    el('tspan', { 'font-size': 22, 'letter-spacing': 1, fill: C.muted }, clock).textContent = 'ELAPSED';
    V.clock = el('tspan', { dx: 14, 'font-size': 40, 'font-weight': 600, fill: C.fg }, clock);
    const lg = el('g', { transform: 'translate(828,1024)' }, svg);
    el('rect', { width: 36, height: 28, rx: 4, fill: C.waitBg }, lg);
    el('path', { d: HOURGLASS, transform: 'translate(18,14) scale(0.8)', fill: C.wait }, lg);
    el('text', { x: 50, y: 22, 'font-size': 22, fill: C.muted }, lg).textContent = 'waiting for the model';
    el('path', { d: 'M0,0L12,8L0,16ZM14,0L26,8L14,16Z', transform: 'translate(1786,1026)', fill: C.speed }, svg);
    el('text', { x: 1880, y: 1046, 'text-anchor': 'end', 'font-size': 30, fill: C.speed }, svg).textContent = '90×';
  }

  function paintChip(c, ch) {
    const P = ch.letter === 'P' && ch.st !== 'R', R = ch.st === 'R', S = ch.st === 'S';
    c.box.setAttribute('fill', R ? 'none' : (P ? C.chipP : C.chipD));
    c.box.setAttribute('stroke', S ? C.wait : (R ? C.faint : (P ? 'none' : C.chipDLine)));
    c.box.setAttribute('stroke-width', S ? 3 : 2);
    c.box.setAttribute('stroke-dasharray', R ? '7 6' : 'none');
    c.txt.textContent = R ? '' : ch.letter;
    c.txt.setAttribute('fill', P ? C.chipPText : C.chipDText);
    c.icon.setAttribute('opacity', R ? 1 : 0);
    c.ring.setAttribute('opacity', ch.ring ? 1 : 0);
  }

  function render(t) {
    const m = model(t);
    for (const s of SIDES) {
      const v = V[s.arm], ms = m.sides[s.arm];
      ms.alpha.forEach((a, q) => {
        const o = a.toFixed(3);
        v.tiles[q].amber.setAttribute('opacity', o);
        v.tiles[q].icon.setAttribute('opacity', o);
      });
      ms.chips.forEach((ch, n) => paintChip(v.chips[n], ch));
      if (ms.note) {
        v.note.setAttribute('x', Stage.clamp(v.chips[ms.note.n].mid, v.x + 130, v.x + PANEL.w - 130));
        v.note.textContent = ms.note.text;
        v.note.setAttribute('opacity', 1);
      } else {
        v.note.setAttribute('opacity', 0);
      }
      v.ticks.forEach((tk, q) => tk.setAttribute('opacity', q < ms.finished ? 1 : 0));
      v.num.textContent = String(ms.finished);
    }
    V.clock.textContent = m.clock;
  }

  window.S1 = { model, prep, DUR };
  if (typeof document !== 'undefined' && document.getElementById('stage')) Stage.run({ duration: DUR, name: 'S1 · Current part 2, simplified', init, render });
})();
