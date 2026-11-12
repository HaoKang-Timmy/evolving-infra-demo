/* Section 05: Figure 4 of the technical report as one animation.
   The router's cluster-wide KV directory is a prefix tree. For each block and each node that holds it, the
   directory counts the active branches that reference the block there (R_P1, R_P2, R_D1). Every step below
   applies the rules of Section 4.3 and Algorithm E.2, and the last frame of steps a-d is the paper's panel:
   (a) A request that only appends tokens counts its new block; reused blocks keep their counts.
   (b) Compaction rewrites the context: the version goes from v1 to v2, the router first releases the counts
       on the blocks that the new context drops, then counts the new block.
   (c) A move between nodes of the same phase (P2P, D2D): the target counts the branch, and the source
       releases its counts once the target holds the current version.
   (d) A transfer across phases (P2D, D2P) keeps the counts on both nodes; each step sends only new KV.
   The extra step "Branch ends" applies line 13 of Algorithm E.2: the router releases all counts of a
   finished branch.
   The right column shows each node's host-memory eviction order as the open-source engine keys it by
   default (predicted_return_fixed): zero-count blocks first, in LRU order, as in Section 5.3; among
   blocks with positive counts, the one whose branch is predicted to return last goes first (the paper
   uses LRU there). The prediction m(idle age) is the engine's built-in table. "Waiting for a tool" is an
   illustrative state of branch 2. Timing is for presentation only. */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('kvd');
  const caption = document.getElementById('kvd-caption');
  const playButton = document.getElementById('kvd-play');
  const tabs = Array.from(document.querySelectorAll('[data-chapter]'));
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ---------- palette ---------- */
  const FILL = { sys: '#4a474e', b1: '#a5a1a6', b2: '#dcd8d3', red: '#c92336' };
  const EDGE = { sys: '#2c2a30', b1: '#7b777d', b2: '#aaa49e', red: '#8e1525' };
  const ON = { sys: '#ffffff', b1: '#1f1e22', b2: '#232328', red: '#ffffff' };
  const INK = '#232328';
  const MUTED = '#5d5962';
  const FAINT = '#8a858c';
  const LINE = '#d7d2cc';
  const CARD = '#f7f3ef';
  const SANS = "'Space Grotesk', Arial, sans-serif";
  const MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const MINUS = '−';

  const NODES = ['P1', 'P2', 'D1'];
  const PHASE = { P1: 'prefill', P2: 'prefill', D1: 'decode' };
  const TREE_ORDER = { sys: 0, b1: 1, n1: 2, b2: 3, k1: 4 };
  const DEPTH = { sys: 0, b1: 1, b2: 1, k1: 1, n1: 2 };
  const SEG = { sys: 46, b1: 74, n1: 30, b2: 62, k1: 24 };

  /* ---------- the story: states change only through the rules of Algorithm E.2 ---------- */
  const clone = (s) => JSON.parse(JSON.stringify(s));

  // Both branches start on P1 (Figure 4). T is the last access time of a block on a node.
  function start() {
    return {
      nodes: {
        sys: { c: 'sys', rows: { P1: { v: 2, T: 30 } } },
        b1: { c: 'b1', rows: { P1: { v: 1, T: 30 } } },
        b2: { c: 'b2', rows: { P1: { v: 1, T: 0 } } },
      },
      bar1: ['sys', 'b1'], bar2: ['sys', 'b2'], ghost: null, ver: 1,
      st1: 'active', st2: 'waiting for a tool', done2: false,
      arrow: null, lru: false, focus: [], send1: false,
      N1: ['P1'], N2: ['P1'], hot: [], now: 30,
    };
  }
  function count(s, id, node, delta, T) {
    const n = s.nodes[id];
    const row = n.rows[node] || (n.rows[node] = { v: 0, T: 0 });
    row.v += delta;
    row.tag = delta > 0 ? '+1' : `${MINUS}1`;
    if (T !== undefined) row.T = T;
  }
  function touch(s, ids, node, T) { ids.forEach((id) => { s.nodes[id].rows[node].T = T; }); }
  function quiet(s) {
    Object.values(s.nodes).forEach((n) => { n.tagBox = null; Object.values(n.rows).forEach((r) => { r.tag = null; }); });
    s.focus = []; s.lru = false; s.arrow = null; s.send1 = false; s.hot = [];
  }

  const CHAPTERS = [
    { reset: true, beats: [
      { d: 2.8, cap: 'Both branches start on prefill node P1. Each block of the cluster-wide prefix tree shows, for each node that holds it, how many active branches reference it there.' },
      { d: 2.6, tr: 1.2, flight: ['b1', 'P1'], cap: 'Branch 1 sends its next request. Its context only <b>appends</b> tokens to its previous request.',
        fx: (s) => { s.bar1.push('n1'); s.st1 = 'sends next request'; s.send1 = true; s.hot = ['P1']; } },
      { d: 5.6, cap: 'P1 counts only the new block that its prefill adds (<b>+1</b>). The reused blocks keep their counts, since branch 1 was already counted on them.',
        fx: (s) => { s.nodes.n1 = { c: 'red', rows: { P1: { v: 1, T: 40, tag: '+1' } } }; touch(s, ['sys', 'b1'], 'P1', 40); s.now = 40; s.focus = ['sys', 'b1']; s.st1 = 'active'; s.send1 = false; } },
    ] },
    { reset: false, beats: [
      { d: 2.4, cap: 'The new block is now part of branch 1&rsquo;s context, version v1.',
        fx: (s) => { s.nodes.n1.c = 'b1'; } },
      { d: 3.0, tr: 1.2, flight: ['b1', 'P1'], cap: 'The harness <b>compacts</b> branch 1. Its new request no longer extends the previous one, so the router increments its version from v1 to v2.',
        fx: (s) => { s.ghost = ['sys', 'b1', 'n1']; s.bar1 = ['sys', 'k1']; s.ver = 2; s.now = 50; s.st1 = 'compacts its context'; s.send1 = true; s.hot = ['P1']; } },
      { d: 2.8, cap: 'The router releases branch 1&rsquo;s counts on the history that the new context drops (<b>&minus;1</b>). The old blocks drop to R<sub>P1</sub> = 0.',
        fx: (s) => { count(s, 'b1', 'P1', -1); count(s, 'n1', 'P1', -1); s.send1 = false; } },
      { d: 6.4, lru: true, cap: 'P1 counts the new block that the prefill of the compacted context adds (<b>+1</b>). The replaced history now goes first on eviction, and branch 2, waiting for a tool, keeps its KV. LRU would evict branch 2&rsquo;s context first.',
        fx: (s) => { s.nodes.k1 = { c: 'red', rows: { P1: { v: 1, T: 50, tag: '+1' } } }; touch(s, ['sys'], 'P1', 50); s.lru = true; s.st1 = 'active'; } },
    ] },
    { reset: true, beats: [
      { d: 2.2, cap: 'Again, both branches start on P1.' },
      { d: 2.8, tr: 1.2, flight: ['b1', 'P2'], cap: 'The router sends branch 1&rsquo;s next request to prefill node P2, which has the shortest predicted TTFT.',
        fx: (s) => { s.bar1.push('n1'); s.st1 = 'request goes to P2'; s.send1 = true; s.hot = ['P2']; s.now = 40; } },
      { d: 2.6, tr: 1.4, transfer: ['P1', 'P2', ['sys', 'b1']], cap: 'While the request waits in P2&rsquo;s queue, P2 fetches branch 1&rsquo;s reusable KV from the host memory of P1.',
        fx: (s) => { s.arrow = { from: 'P1', to: 'P2', blocks: ['sys', 'b1'] }; s.send1 = false; } },
      { d: 2.8, cap: 'P2 counts all blocks of branch 1, including the new block that its prefill adds (<b>+1</b>).',
        fx: (s) => { count(s, 'sys', 'P2', 1, 40); count(s, 'b1', 'P2', 1, 40); s.nodes.n1 = { c: 'red', rows: { P2: { v: 1, T: 40, tag: '+1' } } }; s.N1 = ['P1', 'P2']; } },
      { d: 6.2, cap: 'Once P2 holds the current version, P1 releases its counts (<b>&minus;1</b>): the branch reuses only the copy on P2. Branch 1&rsquo;s own block on P1 drops to R<sub>P1</sub> = 0 and goes first on eviction; the system prompt stays counted by branch 2. D2D moves follow the same rule.',
        fx: (s) => { count(s, 'sys', 'P1', -1); count(s, 'b1', 'P1', -1); s.st1 = 'active'; s.N1 = ['P2']; s.hot = []; } },
    ] },
    { reset: true, beats: [
      { d: 2.0, cap: 'Both branches start on P1.' },
      { d: 2.4, tr: 1.4, transfer: ['P1', 'D1', ['sys', 'b1']], cap: 'Branch 1&rsquo;s previous request is decoded on decode node D1, which receives its KV from P1.',
        fx: (s) => { s.arrow = { from: 'P1', to: 'D1', blocks: ['sys', 'b1'] }; s.st1 = 'decoding on D1'; s.hot = ['D1']; s.now = 32; } },
      { d: 2.8, cap: 'D1 counts the KV of branch 1 (<b>+1</b>), and P1 keeps its counts: across phases, both copies serve later steps.',
        fx: (s) => { count(s, 'sys', 'D1', 1, 32); count(s, 'b1', 'D1', 1, 32); s.N1 = ['P1', 'D1']; } },
      { d: 2.4, tr: 1.2, flight: ['b1', 'P1'], cap: 'The next request of branch 1 alternates back to P1.',
        fx: (s) => { quiet(s); s.bar1.push('n1'); s.st1 = 'request goes to P1'; s.send1 = true; s.hot = ['P1']; } },
      { d: 2.4, cap: 'P1 counts the new block that its prefill adds (<b>+1</b>).',
        fx: (s) => { s.nodes.n1 = { c: 'red', rows: { P1: { v: 1, T: 40, tag: '+1' } } }; touch(s, ['sys', 'b1'], 'P1', 40); s.now = 40; s.send1 = false; } },
      { d: 2.4, tr: 1.4, transfer: ['P1', 'D1', ['n1']], cap: 'D1 already holds the rest of the context, so P1 sends <b>only the new KV</b>.',
        fx: (s) => { s.arrow = { from: 'P1', to: 'D1', blocks: ['n1'] }; s.st1 = 'decoding on D1'; s.hot = ['D1']; } },
      { d: 6.0, cap: 'D1 counts the new block too (<b>+1</b>). Both nodes keep their counts, since the next step of the branch needs the copies in both phases. D2P transfers follow the same rule.',
        fx: (s) => { const n = s.nodes.n1; n.rows.P1.tag = null; n.rows.D1 = { v: 1, T: 42, tag: '+1' }; touch(s, ['sys', 'b1'], 'D1', 42); s.now = 42; } },
    ] },
    { reset: false, beats: [
      { d: 2.8, cap: 'Branch 2 finishes, and the harness reports it to the router.',
        fx: (s) => { s.nodes.n1.c = 'b1'; s.st1 = 'active'; s.st2 = 'finished'; s.done2 = true; s.hot = []; s.now = 60; } },
      { d: 6.2, cap: 'The router releases all counts of branch 2 (<b>&minus;1</b>). Its context drops to R<sub>P1</sub> = 0 and goes first on eviction. The system prompt stays counted, since branch 1 still references it.',
        fx: (s) => { count(s, 'sys', 'P1', -1); count(s, 'b2', 'P1', -1); s.N2 = []; } },
    ] },
  ];

  // Precompute the state after every beat, and the time at which every beat starts.
  const TR = 0.8;
  let total = 0;
  CHAPTERS.forEach((ch) => {
    ch.t0 = total;
    ch.beats.forEach((b) => { b.t0 = total - ch.t0; b.tr = b.tr || TR; total += b.d; });
    ch.dur = total - ch.t0;
  });
  const LOOP = total;
  function build() {
    let prev = null;
    CHAPTERS.forEach((ch) => {
      let s = ch.reset || !prev ? start() : clone(prev);
      if (!ch.reset && prev) quiet(s);
      ch.beats.forEach((b) => {
        s = clone(s);
        if (b.fx) b.fx(s);
        b.after = s;
      });
      prev = s;
    });
    CHAPTERS.forEach((ch, i) => {
      const before = CHAPTERS[(i + CHAPTERS.length - 1) % CHAPTERS.length];
      ch.beats.forEach((b, k) => { b.before = k ? ch.beats[k - 1].after : before.beats[before.beats.length - 1].after; });
    });
  }
  build();

  /* ---------- geometry: one layout for wide frames, one for phones ---------- */
  const WIDE = {
    name: 'wide', W: 1180, H: 490,
    titles: [[0, 14, 'AGENT HARNESS'], [300, 14, 'ROUTER · CLUSTER-WIDE KV DIRECTORY'], [902, 14, 'NODES · HOST-MEMORY EVICTION ORDER']],
    seps: [[278, 30, 446], [880, 30, 446]],
    card1: { x: 0, y: 32, w: 256, h: 140 }, card2: { x: 0, y: 186, w: 256, h: 112 }, seg: 1, barCap: 'context · one segment per KV block',
    req: 'side',
    cx: 578, chipY: 88, chipDX: 172, chipW: 66, chipH: 30,
    treeY: [192, 300, 404], spread: 174, box: { w: 124, h: 56 }, LH: 20, countSize: 14.5, tagMode: 'side', ring: 'left',
    mem: { x: 902, chipX: 952, y: [126, 226, 318], right: 1180, cw: 32, ch: 26, gap: 6 },
    table: { x: 0, y: 330, w: 256 },
    memKey: { x: 902, y: 386, lines: ['R = 0: evicted first, oldest first', 'R > 0: latest predicted return first', '21s: expected remaining idle time'] },
    legend: { x: 0, y: 476, widths: [128, 152, 152, 92, 112, 182, 200] },
  };
  const MEDIUM = {
    name: 'medium', W: 780, H: 700,
    titles: [[0, 14, 'AGENT HARNESS'], [336, 14, 'ROUTER · CLUSTER-WIDE KV DIRECTORY'], [0, 474, 'NODES · HOST-MEMORY EVICTION ORDER']],
    seps: [[318, 30, 440]],
    card1: { x: 0, y: 32, w: 300, h: 140 }, card2: { x: 0, y: 184, w: 300, h: 112 }, seg: 1, barCap: 'context · one segment per KV block',
    req: 'side',
    cx: 556, chipY: 88, chipDX: 150, chipW: 62, chipH: 30,
    treeY: [190, 300, 404], spread: 150, box: { w: 120, h: 56 }, LH: 20, countSize: 14.5, tagMode: 'edge', ring: 'top',
    mem: { above: true, xs: [4, 280, 544], chipX: 4, axisY: 498, y: [556], right: 780, cw: 32, ch: 26, gap: 6 },
    table: { x: 0, y: 330, w: 300 },
    memKey: { x: 330, y: 462, lines: ['R = 0 first, oldest first · R > 0: latest predicted return first', '21s: expected remaining idle time, from the idle age'] },
    legend: { x: 0, y: 666, widths: [150, 180, 180, 110], rowH: 24 },
  };
  const NARROW = {
    name: 'narrow', W: 400, H: 1156,
    titles: [[0, 12, 'AGENT HARNESS'], [0, 326, 'ROUTER · CLUSTER-WIDE KV DIRECTORY'], [0, 738, 'NODES · HOST-MEMORY EVICTION ORDER']],
    seps: [],
    card1: { x: 0, y: 26, w: 196, h: 140 }, card2: { x: 204, y: 26, w: 196, h: 140 }, seg: 0.74, barCap: 'context',
    req: 'below',
    cx: 200, chipY: 394, chipDX: 126, chipW: 58, chipH: 28,
    treeY: [484, 576, 664], spread: 126, box: { w: 104, h: 50 }, LH: 18, countSize: 13, tagMode: 'edge', ring: 'top',
    mem: { x: 0, chipX: 58, y: [810, 902, 970], right: 400, cw: 30, ch: 25, gap: 6 },
    table: { x: 0, y: 200, w: 400 },
    memKey: { x: 0, y: 1012, lines: ['R = 0: evicted first, oldest first', 'R > 0: latest predicted return first', '21s: expected remaining idle time'] },
    legend: { x: 0, y: 1070, widths: [200, 200], rowH: 24 },
  };

  /* ---------- small helpers ---------- */
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, p) => a + (b - a) * p;
  function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
  function mix(a, b, p) {
    if (a === b || p <= 0) return a;
    if (p >= 1) return b;
    const x = hex(a), y = hex(b);
    return `#${x.map((v, i) => Math.round(lerp(v, y[i], p)).toString(16).padStart(2, '0')).join('')}`;
  }
  const f = (x) => Math.round(x * 100) / 100;

  // A retained-mode scene: elements are created once, by key, in fixed layers; untouched ones are hidden.
  let pool = new Map();
  let used = new Set();
  const layers = {};
  ['back', 'edges', 'nodes', 'tags', 'mem', 'flow', 'text'].forEach((name) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-layer', name);
    svg.appendChild(g);
    layers[name] = g;
  });
  function clearScene() {
    pool.forEach((e) => e.remove());
    pool = new Map();
  }
  function el(key, tag, layer, init) {
    let e = pool.get(key);
    if (!e) {
      e = document.createElementNS(NS, tag);
      pool.set(key, e);
      layers[layer].appendChild(e);
      if (init) init(e);
    }
    used.add(key);
    return e;
  }
  function attr(e, a) {
    for (const k in a) {
      const v = typeof a[k] === 'number' ? String(f(a[k])) : String(a[k]);
      if (e.getAttribute(k) !== v) e.setAttribute(k, v);
    }
    return e;
  }
  function text(e, t) { if (e.textContent !== t) e.textContent = t; return e; }
  function sweep() {
    pool.forEach((e, key) => {
      const hide = !used.has(key);
      if (hide && e.getAttribute('display') !== 'none') e.setAttribute('display', 'none');
      else if (!hide && e.hasAttribute('display')) e.removeAttribute('display');
    });
    used = new Set();
  }
  function label(key, layer, x, y, t, o) {
    const e = el(key, 'text', layer);
    attr(e, { x, y, 'font-family': o.mono ? MONO : SANS, 'font-size': o.size || 12, 'font-weight': o.weight || 400,
      fill: o.fill || INK, 'text-anchor': o.anchor || 'start', opacity: o.op === undefined ? 1 : o.op,
      'letter-spacing': o.ls || 0 });
    return text(e, t);
  }

  /* ---------- tree layout ---------- */
  function treePos(s, G) {
    const kids = ['b1', 'b2', 'k1'].filter((id) => s.nodes[id]);
    const pos = { sys: { x: G.cx, y: G.treeY[0] } };
    kids.forEach((id, i) => { pos[id] = { x: G.cx + (i - (kids.length - 1) / 2) * G.spread, y: G.treeY[1] }; });
    if (s.nodes.n1) pos.n1 = { x: pos.b1.x, y: G.treeY[2] };
    return pos;
  }
  const PARENT = { b1: 'sys', b2: 'sys', k1: 'sys', n1: 'b1' };
  const zero = (n) => n && Object.keys(n.rows).length > 0 && Object.values(n.rows).every((r) => r.v === 0);
  function chip(G, node) {
    const i = NODES.indexOf(node);
    return { x: G.cx + (i - 1) * G.chipDX, y: G.chipY, w: G.chipW, h: G.chipH };
  }

  /* ---------- paths that the animation follows (computed, so no layout engine is needed) ---------- */
  function cubic(p0, p1, p2, p3) {
    const at = (t) => {
      const u = 1 - t;
      return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
    };
    let len = 0, prev = p0;
    for (let i = 1; i <= 40; i++) { const q = at(i / 40); len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    return { at, len, d: `M${f(p0.x)} ${f(p0.y)}C${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(p3.x)} ${f(p3.y)}` };
  }
  function transferPath(G, from, to) {
    const a = chip(G, from), b = chip(G, to);
    if (Math.abs(NODES.indexOf(from) - NODES.indexOf(to)) === 1) {
      const dir = Math.sign(b.x - a.x);
      const p0 = { x: a.x + dir * (a.w / 2 + 4), y: a.y }, p3 = { x: b.x - dir * (b.w / 2 + 7), y: b.y };
      return cubic(p0, { x: lerp(p0.x, p3.x, 1 / 3), y: p0.y }, { x: lerp(p0.x, p3.x, 2 / 3), y: p0.y }, p3);
    }
    // Across a node: arc over it.
    const p0 = { x: a.x + 8, y: a.y - a.h / 2 - 3 }, p3 = { x: b.x - 8, y: b.y - b.h / 2 - 7 };
    return cubic(p0, { x: p0.x + 36, y: a.y - 56 }, { x: p3.x - 36, y: b.y - 56 }, p3);
  }
  function requestPath(G, target) {
    const c = chip(G, target);
    if (G.req === 'below') {
      const p0 = { x: G.card1.x + G.card1.w / 2, y: G.card1.y + G.card1.h + 4 };
      const p3 = { x: c.x, y: c.y - c.h / 2 - 3 };
      return cubic(p0, { x: p0.x, y: p0.y + 50 }, { x: p3.x, y: p3.y - 60 }, p3);
    }
    const p0 = { x: G.card1.x + G.card1.w + 4, y: G.card1.y + 49 };
    const p3 = { x: c.x - 12, y: c.y - c.h / 2 - 3 };
    return cubic(p0, { x: p0.x + 70, y: p0.y }, { x: p3.x - 40, y: c.y - 62 }, p3);
  }

  /* ---------- drawing ---------- */
  function defs() {
    el('defs', 'defs', 'back', (e) => {
      e.innerHTML = '<marker id="kvd-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#232328"/></marker>'
        + '<marker id="kvd-head-m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#5d5962"/></marker>';
    });
  }
  function drawStatic(G, hot) {
    G.titles.forEach(([x, y, t], i) => label(`title${i}`, 'back', x, y, t, { mono: true, size: 10, fill: MUTED, ls: 1.1 }));
    G.seps.forEach(([x, y0, y1], i) => attr(el(`sep${i}`, 'path', 'back'), { d: `M${x} ${y0}V${y1}`, stroke: LINE, 'stroke-width': 1 }));
    NODES.forEach((n) => {
      const c = chip(G, n);
      const h = hot[n] || 0;
      attr(el(`chip-${n}`, 'rect', 'back'), { x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h, rx: 6, fill: mix('#ffffff', '#fbe9eb', h), stroke: mix(INK, FILL.red, h), 'stroke-width': 1.4 + 0.4 * h });
      label(`chipt-${n}`, 'back', c.x, c.y + 5.5, n, { size: 15, weight: 600, anchor: 'middle', fill: mix(INK, FILL.red, h) });
      label(`chipp-${n}`, 'back', c.x, c.y + c.h / 2 + 14, PHASE[n], { mono: true, size: 10, fill: MUTED, anchor: 'middle' });
    });
    const items = [['sys', 'System prompt'], ['b1', 'Branch 1’s context'], ['b2', 'Branch 2’s context'], ['red', 'New KV'], ['arrow', 'KV transfer'], ['dash', 'Count 0 on every node'], ['R', '']];
    const L = G.legend;
    const per = L.rowH ? L.widths.length : items.length;
    items.forEach(([k, t], i) => {
      const col = i % per, row = Math.floor(i / per);
      const x = L.x + L.widths.slice(0, col).reduce((a, b) => a + b, 0);
      const y = L.y + row * (L.rowH || 0);
      if (k === 'R') {
        const e = el('lg-R', 'text', 'back', (t) => { t.innerHTML = '<tspan font-weight="600">R</tspan><tspan dy="3.5" font-size="9.5" font-weight="600">P1</tspan><tspan dy="-3.5">: branches using it on P1</tspan>'; });
        attr(e, { x, y, 'font-family': MONO, 'font-size': 12.5, fill: MUTED });
        return;
      }
      if (k === 'arrow') {
        attr(el('lg-arrow', 'path', 'back'), { d: `M${x} ${y - 4}H${x + 20}`, stroke: INK, 'stroke-width': 1.4, fill: 'none', 'marker-end': 'url(#kvd-head)' });
      } else {
        attr(el(`lg-${k}`, 'rect', 'back'), { x, y: y - 10, width: 22, height: 12, rx: 3, fill: k === 'dash' ? FILL.b1 : FILL[k], 'fill-opacity': k === 'dash' ? 0.58 : 1,
          stroke: k === 'dash' ? INK : EDGE[k], 'stroke-width': k === 'dash' ? 1.1 : 0.8, 'stroke-dasharray': k === 'dash' ? '3 2' : 'none' });
      }
      label(`lgt-${k}`, 'back', x + 30, y, t, { size: 12.5, fill: MUTED });
    });
  }

  // Branch cards: the agent harness tags each request with its branch and reports when a branch ends.
  const width = (list, k) => list.reduce((w, s) => w + SEG[s] * k + 2, -2);
  function segColor(k, s) { const n = s.nodes[k]; return n ? FILL[n.c] : FILL.red; }
  function drawCards(G, A, B, p) {
    const S = p < 0.5 ? A : B;
    const done = lerp(A.done2 ? 1 : 0, B.done2 ? 1 : 0, p);
    [['b1', G.card1], ['b2', G.card2]].forEach(([id, c]) => {
      const dim = id === 'b2' ? done : 0;
      attr(el(`card-${id}`, 'rect', 'back'), { x: c.x, y: c.y, width: c.w, height: c.h, rx: 8, fill: CARD, stroke: LINE, 'stroke-width': 1 });
      label(`cardt-${id}`, 'back', c.x + 16, c.y + 28, id === 'b1' ? 'Branch 1' : 'Branch 2', { size: 16, weight: 600, op: 1 - 0.4 * dim });
      const sending = id === 'b1' ? lerp(A.send1 ? 1 : 0, B.send1 ? 1 : 0, p) : 0;
      const col = id === 'b2' ? mix(INK, FAINT, done) : mix(INK, FILL.red, sending);
      attr(el(`dot-${id}`, 'circle', 'text'), { cx: c.x + 20, cy: c.y + 49, r: 4, fill: id === 'b2' ? mix('#ffffff', FAINT, done) : col, stroke: col, 'stroke-width': 1.3 });
      label(`st-${id}`, 'text', c.x + 31, c.y + 53, id === 'b1' ? S.st1 : S.st2, { mono: true, size: 11.5, fill: id === 'b1' ? mix(MUTED, FILL.red, sending) : MUTED });
    });
    // Version of branch 1: it increments when the harness rewrites the context.
    const c1 = G.card1;
    const vx = c1.x + c1.w - 16, vy = c1.y + 23;
    const flip = A.ver !== B.ver;
    attr(el('ver-box', 'rect', 'text'), { x: vx - 30, y: vy - 12, width: 30, height: 20, rx: 10, fill: '#ffffff', stroke: flip ? mix(INK, FILL.red, Math.sin(Math.PI * p)) : INK, 'stroke-width': 1.1 });
    if (flip) {
      label('ver-a', 'text', vx - 15, vy + 2.5 - 5 * p, `v${A.ver}`, { mono: true, size: 11.5, weight: 600, anchor: 'middle', op: 1 - p });
      label('ver-b', 'text', vx - 15, vy + 2.5 + 5 * (1 - p), `v${B.ver}`, { mono: true, size: 11.5, weight: 600, anchor: 'middle', op: p });
    } else {
      label('ver-a', 'text', vx - 15, vy + 2.5, `v${B.ver}`, { mono: true, size: 11.5, weight: 600, anchor: 'middle' });
    }
    // Context bars, as in the paper: one segment per block; tokens that are not prefilled yet are red.
    const k = G.seg;
    const ghost = lerp(A.ghost ? 1 : 0, B.ghost ? 1 : 0, ease(p));
    const g = B.ghost || A.ghost;
    const barY = c1.y + c1.h - 44, ghostY = barY - 22;
    const bx = c1.x + 16 + 24 * ghost;
    if (g) {
      label('gh-l', 'text', c1.x + 16, ghostY + 11, 'v1', { mono: true, size: 11, fill: MUTED, op: ghost });
      let x = bx;
      g.forEach((s) => {
        attr(el(`gh-${s}`, 'rect', 'text'), { x, y: ghostY, width: SEG[s] * k, height: 14, rx: 2, fill: segColor(s, B), opacity: ghost * 0.5 });
        x += SEG[s] * k + 2;
      });
      attr(el('gh-x', 'path', 'text'), { d: `M${f(bx - 3)} ${ghostY + 7}H${f(bx + width(g, k) + 3)}`, stroke: INK, 'stroke-width': 1.3, opacity: ghost * 0.8 });
      label('bar-l', 'text', c1.x + 16, barY + 11, 'v2', { mono: true, size: 11, weight: 600, fill: INK, op: ghost });
    }
    barMorph('b1', A.bar1, B.bar1, bx, barY, A, B, p, k);
    barMorph('b2', A.bar2, B.bar2, G.card2.x + 16, G.card2.y + G.card2.h - 44, A, B, p, k, 1 - 0.55 * done);
    label('b1-cap', 'text', c1.x + 16, c1.y + c1.h - 12, G.barCap, { mono: true, size: 10, fill: FAINT });
    label('b2-cap', 'text', G.card2.x + 16, G.card2.y + G.card2.h - 12, 'context', { mono: true, size: 10, fill: FAINT });
  }
  // A bar morphs: segments that appear grow from zero width, segments that leave shrink to zero.
  function barMorph(key, la, lb, x, y, A, B, p, k, op = 1) {
    const keys = [];
    la.concat(lb).forEach((s) => { if (!keys.includes(s)) keys.push(s); });
    const rank = (s) => (lb.includes(s) ? lb.indexOf(s) : la.indexOf(s) + 0.5);
    keys.sort((a, b) => rank(a) - rank(b));
    let cx = x;
    keys.forEach((s) => {
      const w = lerp(la.includes(s) ? SEG[s] * k : 0, lb.includes(s) ? SEG[s] * k : 0, ease(p));
      if (w < 0.5) return;
      attr(el(`${key}-${s}`, 'rect', 'text'), { x: cx, y, width: w, height: 14, rx: 2, fill: mix(segColor(s, A), segColor(s, B), p), opacity: op });
      cx += w + 2;
    });
  }

  // The router's branch table (Algorithm E.1): the version of each branch and the nodes where it holds counts.
  function drawTable(G, A, B, p) {
    const T = G.table;
    label('tb-title', 'back', T.x, T.y, 'ROUTER · BRANCH TABLE', { mono: true, size: 10, fill: MUTED, ls: 1.1 });
    const cols = [T.x + 16, T.x + 92, T.x + 156];
    const hy = T.y + 24;
    ['branch', 'version', 'counts on'].forEach((h, i) => label(`tb-h${i}`, 'back', cols[i], hy, h, { mono: true, size: 10, fill: FAINT }));
    attr(el('tb-rule', 'path', 'back'), { d: `M${T.x} ${hy + 8}H${T.x + T.w}`, stroke: LINE, 'stroke-width': 1 });
    [['1', 'ver', 'N1'], ['2', null, 'N2']].forEach(([b, vk, nk], r) => {
      const y = hy + 30 + r * 28;
      const gone = b === '2' ? lerp(A.done2 && !A.N2.length ? 1 : 0, B.done2 && !B.N2.length ? 1 : 0, p) : 0;
      label(`tb-b${b}`, 'text', cols[0], y, `branch ${b}`, { size: 14, weight: 500, op: 1 - 0.6 * gone });
      const va = vk ? A[vk] : 1, vb = vk ? B[vk] : 1;
      if (va !== vb) {
        label(`tb-v${b}`, 'text', cols[1], y - 7 * p, `v${va}`, { mono: true, size: 12.5, weight: 600, op: 1 - p });
        label(`tb-w${b}`, 'text', cols[1], y + 7 * (1 - p), `v${vb}`, { mono: true, size: 12.5, weight: 600, fill: FILL.red, op: p });
      } else {
        label(`tb-v${b}`, 'text', cols[1], y, `v${vb}`, { mono: true, size: 12.5, weight: 600, op: 1 - 0.6 * gone });
      }
      const na = A[nk], nb = B[nk];
      const all = NODES.filter((n) => na.includes(n) || nb.includes(n));
      const xa = (n) => cols[2] + na.indexOf(n) * 36, xb = (n) => cols[2] + nb.indexOf(n) * 36;
      all.forEach((n) => {
        const ia = na.includes(n), ib = nb.includes(n);
        const x = ia && ib ? lerp(xa(n), xb(n), ease(p)) : (ib ? xb(n) : xa(n));
        const o = lerp(ia ? 1 : 0, ib ? 1 : 0, ease(p));
        const fresh = !ia && ib ? 1 - p : 0;
        attr(el(`tb-n${b}-${n}`, 'rect', 'text'), { x, y: y - 13, width: 30, height: 18, rx: 4, fill: '#ffffff', stroke: mix(INK, FILL.red, fresh > 0 ? Math.sin(Math.PI * p) : 0), 'stroke-width': 1.1, opacity: o });
        label(`tb-t${b}-${n}`, 'text', x + 15, y + 0.5, n, { mono: true, size: 11, weight: 600, anchor: 'middle', op: o });
      });
      if (gone > 0.01) label(`tb-g${b}`, 'text', cols[2], y, 'finished · removed', { mono: true, size: 10.5, fill: FAINT, op: gone });
    });
  }

  // One block of the prefix tree, with one row per node that holds it.
  function drawNode(id, G, A, B, pA, pB, p, op) {
    const na = A.nodes[id], nb = B.nodes[id];
    const pres = lerp(na ? 1 : 0, nb ? 1 : 0, ease(p)) * op;
    if (pres <= 0.001) return;
    const a = pA[id] || pB[id], b = pB[id] || pA[id];
    const x = lerp(a.x, b.x, ease(p)), y = lerp(a.y, b.y, ease(p));
    const { w, h } = G.box;
    const ca = (na || nb).c, cb = (nb || na).c;
    const fill = mix(FILL[ca], FILL[cb], p), edge = mix(EDGE[ca], EDGE[cb], p), on = mix(ON[ca], ON[cb], p);
    const za = zero(na) ? 1 : 0, zb = zero(nb) ? 1 : 0;
    const dash = na && nb ? lerp(za, zb, p) : (nb ? zb : za);
    const grow = na ? 1 : 0.86 + 0.14 * ease(p);
    if (PARENT[id]) {
      const pa = pA[PARENT[id]] || pB[PARENT[id]], pb = pB[PARENT[id]] || pA[PARENT[id]];
      const px = lerp(pa.x, pb.x, ease(p)), py = lerp(pa.y, pb.y, ease(p));
      const y0 = py + h / 2, y1 = y - h / 2, ym = (y0 + y1) / 2;
      attr(el(`edge-${id}`, 'path', 'edges'), { d: `M${f(px)} ${f(y0)}V${f(ym)}H${f(x)}V${f(y1)}`, fill: 'none', stroke: '#9b969c', 'stroke-width': 1.3, opacity: pres });
    }
    // Reused blocks keep their counts.
    const foc = lerp(A.focus.includes(id) ? 1 : 0, B.focus.includes(id) ? 1 : 0, p) * pres;
    if (foc > 0.01) {
      attr(el(`ring-${id}`, 'rect', 'nodes'), { x: x - w / 2 - 6, y: y - h / 2 - 6, width: w + 12, height: h + 12, rx: 11, fill: 'none', stroke: INK, 'stroke-width': 1.3, 'stroke-dasharray': '2 3', opacity: foc * 0.75 });
      if (id === 'sys') {
        if (G.ring === 'left') label('ringt', 'nodes', x - w / 2 - 14, y + 4, 'reused · counts kept', { mono: true, size: 11, fill: MUTED, anchor: 'end', op: foc });
        else label('ringt', 'nodes', x, y - h / 2 - 12, 'reused · counts kept', { mono: true, size: 10.5, fill: MUTED, anchor: 'middle', op: foc });
      }
    }
    const g = { x: x - (w / 2) * grow, y: y - (h / 2) * grow, width: w * grow, height: h * grow, rx: 7 };
    // A brief halo marks a block whose counts change in this step.
    const changed = na && nb && NODES.some((n) => (na.rows[n] ? na.rows[n].v : null) !== (nb.rows[n] ? nb.rows[n].v : null));
    if (changed && p > 0 && p < 1) {
      attr(el(`halo-${id}`, 'rect', 'edges'), { x: g.x - 5, y: g.y - 5, width: g.width + 10, height: g.height + 10, rx: 11, fill: 'none', stroke: FILL.red, 'stroke-width': 2.5, opacity: 0.55 * Math.sin(Math.PI * p) * pres });
    }
    attr(el(`box-${id}`, 'rect', 'nodes'), { ...g, fill, stroke: edge, 'stroke-width': 1, opacity: pres * (1 - dash) });
    attr(el(`boxd-${id}`, 'rect', 'nodes'), { ...g, fill, 'fill-opacity': 0.58, stroke: INK, 'stroke-width': 1.4, 'stroke-dasharray': '4 3', opacity: pres * dash });
    const ra = na ? na.rows : {}, rb = nb ? nb.rows : {};
    const keys = NODES.filter((n) => ra[n] || rb[n]);
    const wgt = keys.map((n) => (ra[n] && rb[n] ? 1 : lerp(ra[n] ? 1 : 0, rb[n] ? 1 : 0, ease(p))));
    const sum = wgt.reduce((s, v) => s + v, 0);
    const fs = G.countSize;
    let acc = 0;
    keys.forEach((n, i) => {
      const ry = y + (acc + wgt[i] / 2 - sum / 2) * G.LH;
      acc += wgt[i];
      const rop = pres * clamp(wgt[i] * 1.4 - 0.4);
      const lab = el(`rl-${id}-${n}`, 'text', 'nodes', (e) => {
        e.innerHTML = `<tspan>R</tspan><tspan dy="4" font-size="${f(fs * 0.72)}">${n}</tspan><tspan dy="-4" dx="${f(fs * 0.3)}">=</tspan>`;
      });
      attr(lab, { x: x + fs * 0.4, y: ry + fs * 0.34, 'font-family': MONO, 'font-size': fs, 'font-weight': 600, fill: on, 'text-anchor': 'end', opacity: rop });
      const va = ra[n] ? ra[n].v : null, vb = rb[n] ? rb[n].v : null;
      const vx = x + fs * 1.02;
      if (va !== null && vb !== null && va !== vb) {
        const q = ease(clamp(p * 1.25));
        label(`rv-${id}-${n}`, 'nodes', vx, ry + fs * 0.34 - 7 * q, String(va), { mono: true, size: fs, weight: 600, fill: on, op: rop * clamp(1 - q * 2) });
        label(`rw-${id}-${n}`, 'nodes', vx, ry + fs * 0.34 + 7 * (1 - q), String(vb), { mono: true, size: fs, weight: 600, fill: on, op: rop * clamp(q * 2 - 1) });
      } else {
        label(`rv-${id}-${n}`, 'nodes', vx, ry + fs * 0.34, String(vb !== null ? vb : va), { mono: true, size: fs, weight: 600, fill: on, op: rop });
      }
      const ta = ra[n] && ra[n].tag && !(na && na.tagBox), tb = rb[n] && rb[n].tag && !(nb && nb.tagBox);
      const top = lerp(ta ? 1 : 0, tb ? 1 : 0, p) * pres;
      if (top > 0.01) tag(`tg-${id}-${n}`, G, x + w / 2, ry, tb ? rb[n].tag : ra[n].tag, top);
    });
    const bta = na && na.tagBox, btb = nb && nb.tagBox;
    const bop = lerp(bta ? 1 : 0, btb ? 1 : 0, p) * pres;
    if (bop > 0.01) tag(`tgb-${id}`, G, x + w / 2, y, btb || bta, bop);
  }
  // A +1 or -1 tag next to the row that changed; on phones it sits on the edge of the block.
  function tag(key, G, right, y, t, op) {
    const plus = t === '+1';
    const x = G.tagMode === 'edge' ? right - 13 : right + 8;
    attr(el(`${key}-r`, 'rect', 'tags'), { x, y: y - 9, width: 30, height: 18, rx: 9, fill: plus ? INK : '#ffffff', stroke: INK, 'stroke-width': 1.2, opacity: op });
    label(`${key}-t`, 'tags', x + 15, y + 4.3, t, { mono: true, size: 11.5, weight: 600, fill: plus ? '#ffffff' : INK, anchor: 'middle', op });
  }

  // Expected remaining idle time m(tau) of the open-source engine's default order (predicted_return_fixed,
  // evolving_infra/.../mem_cache/unified_cache/retention_order.py): the built-in table, linear between its
  // anchors in 1-s bins; an idle age of 150 s or more counts as finished (m = inf).
  const MTAU = [[0, 21], [10, 38], [20, 60], [30, 70], [60, 67], [90, 49], [110, 33], [115, 29]];
  function expectedWait(tau) {
    if (tau >= 150) return Infinity;
    const b = Math.min(Math.floor(tau), 119);
    if (b >= 115) return 29;
    let i = 0;
    while (MTAU[i + 1][0] <= b) i++;
    const [t0, m0] = MTAU[i], [t1, m1] = MTAU[i + 1];
    return Math.round((m0 + ((m1 - m0) * (b - t0)) / (t1 - t0)) * 10) / 10;
  }
  // Host memory of each node in eviction order, as the engine's retention eviction keys it: zero counts
  // first, in LRU order; then blocks that an active branch references, the one whose branch is predicted to
  // return last first (-m of the idle age), then LRU. Ties go child before parent. The engine's other key
  // levels (blocks of a queued or running request last, host-only leaves before GPU-backed copies) do not
  // change the order in the frames shown.
  function order(s, node) {
    const m = (id) => expectedWait(s.now - s.nodes[id].rows[node].T);
    return Object.keys(s.nodes).filter((id) => s.nodes[id].rows[node]).sort((a, b) => {
      const ra = s.nodes[a].rows[node], rb = s.nodes[b].rows[node];
      return (ra.v > 0) - (rb.v > 0) || (ra.v > 0 ? m(b) - m(a) : 0) || ra.T - rb.T || DEPTH[b] - DEPTH[a] || TREE_ORDER[a] - TREE_ORDER[b];
    });
  }
  function drawMemory(G, A, B, p, op) {
    const M = G.mem, CW = M.cw, CH = M.ch, GAP = M.gap, DIV = 14;
    // One slot per node: rows (labels left of the chips) or, in the medium layout, columns (labels above).
    const slot = (r) => (M.above
      ? { x: M.xs[r], chipX: M.xs[r], y: M.y[0] }
      : { x: M.x, chipX: M.chipX, y: M.y[r] });
    const ay = M.axisY || M.y[0] - 44;
    attr(el('mem-axis', 'path', 'back'), { d: `M${M.chipX} ${ay}H${M.right - 4}`, stroke: MUTED, 'stroke-width': 1, fill: 'none', 'marker-end': 'url(#kvd-head-m)' });
    label('mem-first', 'back', M.chipX, ay - 7, 'evicted first', { mono: true, size: 10.5, fill: FILL.red });
    label('mem-last', 'back', M.right - 6, ay - 7, 'evicted last', { mono: true, size: 10.5, fill: MUTED, anchor: 'end' });
    G.memKey.lines.forEach((t, i) => label(`mem-k${i}`, 'back', G.memKey.x, G.memKey.y + i * 15, t, { mono: true, size: 10, fill: i === 0 ? FILL.red : MUTED }));
    NODES.forEach((node, r) => {
      const S0 = slot(r), y = S0.y, cX = S0.chipX;
      if (M.above) {
        label(`mem-n-${node}`, 'back', S0.x, y - 24, node, { size: 15, weight: 600 });
        label(`mem-p-${node}`, 'back', S0.x + 26, y - 24, PHASE[node], { mono: true, size: 10, fill: MUTED });
      } else {
        label(`mem-n-${node}`, 'back', S0.x, y + 2, node, { size: 15, weight: 600 });
        label(`mem-p-${node}`, 'back', S0.x, y + 17, PHASE[node], { mono: true, size: 10, fill: MUTED });
      }
      const oa = order(A, node), ob = order(B, node);
      const za = oa.filter((id) => A.nodes[id].rows[node].v === 0).length;
      const zb = ob.filter((id) => B.nodes[id].rows[node].v === 0).length;
      const xAt = (i, z) => cX + i * (CW + GAP) + (z > 0 && i >= z ? DIV : 0);
      const empty = lerp(oa.length ? 0 : 1, ob.length ? 0 : 1, p) * op + (1 - op) * (ob.length ? 0 : 1) * 0;
      if (empty > 0.01) label(`mem-e-${node}`, 'mem', cX, y + 4, 'no KV of these branches', { mono: true, size: 10.5, fill: FAINT, op: empty });
      const divX = (z) => xAt(z, z) - GAP / 2 - DIV / 2;
      const dz = lerp(za ? 1 : 0, zb ? 1 : 0, p) * op;
      if (dz > 0.01) {
        const dx = lerp(divX(za || zb), divX(zb || za), ease(p));
        attr(el(`mem-div-${node}`, 'path', 'mem'), { d: `M${f(dx)} ${y - CH / 2 - 4}V${y + CH / 2 + 4}`, stroke: FILL.red, 'stroke-width': 1.4, opacity: dz });
        label(`mem-z-${node}`, 'mem', cX, y + CH / 2 + 15, 'R = 0', { mono: true, size: 10, fill: FILL.red, op: dz });
      }
      oa.concat(ob.filter((id) => !oa.includes(id))).forEach((id) => {
        const ia = oa.indexOf(id), ib = ob.indexOf(id);
        const xa = ia >= 0 ? xAt(ia, za) : xAt(ib, zb), xb = ib >= 0 ? xAt(ib, zb) : xAt(ia, za);
        const pres = lerp(ia >= 0 ? 1 : 0, ib >= 0 ? 1 : 0, ease(p)) * op;
        if (pres < 0.01) return;
        const x = lerp(xa, xb, ease(p));
        const na = A.nodes[id], nb = B.nodes[id];
        const ca = (na || nb).c, cb = (nb || na).c;
        const va = ia >= 0 ? na.rows[node].v : null, vb = ib >= 0 ? nb.rows[node].v : null;
        const z = va !== null && vb !== null ? lerp(va === 0 ? 1 : 0, vb === 0 ? 1 : 0, p) : ((vb !== null ? vb : va) === 0 ? 1 : 0);
        // A chip lifts while it changes place.
        const lift = ia >= 0 && ib >= 0 && xa !== xb ? Math.sign(xb - xa) * 9 * Math.sin(Math.PI * ease(p)) : 0;
        attr(el(`mc-${node}-${id}`, 'rect', 'mem'), { x, y: y - CH / 2 + lift, width: CW, height: CH, rx: 4, fill: mix(FILL[ca], FILL[cb], p), 'fill-opacity': 1 - 0.42 * z,
          stroke: z > 0.5 ? INK : mix(EDGE[ca], EDGE[cb], p), 'stroke-width': z > 0.5 ? 1.3 : 0.9, 'stroke-dasharray': z > 0.5 ? '3.5 2.5' : 'none', opacity: pres });
        const v = p < 0.5 ? (va !== null ? va : vb) : (vb !== null ? vb : va);
        const Sx = p < 0.5 ? (ia >= 0 ? A : B) : (ib >= 0 ? B : A);
        if (v > 0) {
          const mw = expectedWait(Sx.now - Sx.nodes[id].rows[node].T);
          label(`mcm-${node}-${id}`, 'mem', x + CW / 2, y + CH / 2 + 14, Number.isFinite(mw) ? `${Math.round(mw)}s` : 'done', { mono: true, size: 9.5, fill: MUTED, anchor: 'middle', op: pres });
        }
        label(`mct-${node}-${id}`, 'mem', x + CW / 2, y + 4.5 + lift, String(v), { mono: true, size: 12.5, weight: 600, fill: z > 0.5 ? INK : mix(ON[ca], ON[cb], p), anchor: 'middle', op: pres });
      });
      // For contrast, the order of plain LRU on P1, which ignores the counts (Section 3.3).
      if (node === 'P1') {
        const lo = lerp(A.lru ? 1 : 0, B.lru ? 1 : 0, p) * op;
        if (lo > 0.01) {
          const S = B.lru ? B : A;
          const lru = Object.keys(S.nodes).filter((id) => S.nodes[id].rows.P1)
            .sort((a, b) => S.nodes[a].rows.P1.T - S.nodes[b].rows.P1.T || DEPTH[b] - DEPTH[a] || TREE_ORDER[a] - TREE_ORDER[b]);
          const ly = y + 41;
          label('lru-l', 'mem', M.above ? cX + lru.length * (CW + GAP) + 2 : S0.x, ly + 4, 'LRU', { mono: true, size: 10.5, fill: MUTED, op: lo });
          lru.forEach((id, i) => {
            attr(el(`lru-${id}`, 'rect', 'mem'), { x: cX + i * (CW + GAP), y: ly - 5, width: CW, height: 10, rx: 2.5, fill: FILL[S.nodes[id].c], stroke: EDGE[S.nodes[id].c], 'stroke-width': 0.8, opacity: lo * 0.85 });
          });
          attr(el('lru-x', 'rect', 'mem'), { x: cX - 3, y: ly - 8, width: CW + 6, height: 16, rx: 4, fill: 'none', stroke: FILL.red, 'stroke-width': 1.4, opacity: lo });
          label('lru-t', 'mem', cX - 3, ly + 22, 'LRU would evict branch 2’s KV first', { mono: true, size: 10, fill: FILL.red, op: lo });
        }
      }
    });
  }

  const same = (a, b) => !!a && !!b && a.from === b.from && a.to === b.to && a.blocks.join() === b.blocks.join();
  function drawFlows(G, A, B, beat, lt, op) {
    // The arrow of the latest transfer stays, with the KV that it sent resting on it, as in the paper.
    const arrows = [];
    if (A.arrow) arrows.push(['a', A.arrow, same(A.arrow, B.arrow) ? 1 : 1 - clamp(lt / 0.5)]);
    if (B.arrow && !same(A.arrow, B.arrow)) arrows.push(['b', B.arrow, -1]);
    arrows.forEach(([k, ar, o]) => {
      const path = transferPath(G, ar.from, ar.to);
      const moving = o < 0;
      const s = moving ? ease(clamp(lt / beat.tr)) : 1;
      const aop = (moving ? 1 : o) * op;
      const e = attr(el(`arr-${k}`, 'path', 'flow'), { d: path.d, fill: 'none', stroke: INK, 'stroke-width': 1.5,
        'stroke-dasharray': `${f(path.len)} ${f(path.len)}`, 'stroke-dashoffset': f(path.len * (1 - s)), opacity: aop });
      if (s > 0.98) e.setAttribute('marker-end', 'url(#kvd-head)'); else e.removeAttribute('marker-end');
      // The KV rides the head of the arrow, then settles on its middle.
      const settle = moving ? clamp((lt - beat.tr) / 0.4) : 1;
      packet(`pk-${k}`, path.at(lerp(s, 0.5, settle)), ar.blocks, (moving ? clamp(lt / 0.2) : 1) * aop);
    });
    // A request travels from the branch to the node that the router picks.
    if (beat.flight && lt < beat.tr + 0.05) {
      const path = requestPath(G, beat.flight[1]);
      const s = ease(clamp(lt / beat.tr));
      const vis = Math.min(1, Math.sin(Math.PI * s) * 3) * op;
      attr(el('req-path', 'path', 'flow'), { d: path.d, fill: 'none', stroke: FILL.red, 'stroke-width': 1.3, 'stroke-dasharray': '3 4', opacity: 0.6 * vis });
      const q = path.at(s);
      attr(el('req-dot', 'circle', 'flow'), { cx: q.x, cy: q.y, r: 5.5, fill: FILL.red, stroke: '#ffffff', 'stroke-width': 2, opacity: vis });
      label('req-t', 'flow', q.x, q.y - 11, 'request', { mono: true, size: 10.5, fill: FILL.red, anchor: 'middle', op: vis });
    }
  }
  function packet(key, pt, blocks, op) {
    const w = 15, h = 13, n = blocks.length, x0 = pt.x - (n * w) / 2;
    attr(el(`${key}-bg`, 'rect', 'flow'), { x: x0 - 3, y: pt.y - h / 2 - 3, width: n * w + 5, height: h + 6, rx: 3, fill: '#fffdfa', opacity: op });
    ['sys', 'b1', 'n1'].forEach((b) => {
      const i = blocks.indexOf(b);
      if (i < 0) return;
      attr(el(`${key}-${b}`, 'rect', 'flow'), { x: x0 + i * w, y: pt.y - h / 2, width: w - 1, height: h, rx: 1.5, fill: b === 'n1' ? FILL.red : FILL[b], opacity: op });
    });
  }

  /* ---------- frame ---------- */
  let G = WIDE;
  let time = 0;
  let lastCaption = '';
  function pickLayout() {
    const box = svg.parentNode.getBoundingClientRect();
    const w = box.width || window.__forceWidth || 1180;
    const next = w >= 1000 ? WIDE : w >= 600 ? MEDIUM : NARROW;
    if (next !== G) { clearScene(); G = next; }
    if (svg.parentNode.dataset) svg.parentNode.dataset.layout = G.name;
  }
  function locate(t) {
    t = ((t % LOOP) + LOOP) % LOOP;
    let ci = CHAPTERS.length - 1;
    while (ci > 0 && CHAPTERS[ci].t0 > t) ci--;
    const ch = CHAPTERS[ci];
    const lt0 = t - ch.t0;
    let k = ch.beats.length - 1;
    while (k > 0 && ch.beats[k].t0 > lt0) k--;
    return { ci, ch, k, beat: ch.beats[k], lt: lt0 - ch.beats[k].t0, chapterTime: lt0 };
  }
  function render(t) {
    const L = locate(t);
    const { ch, k, beat, lt } = L;
    let A = beat.before, B = beat.after, p = clamp(lt / beat.tr), op = 1;
    // A reset fades the old scene out and the starting scene in, so it never reads as a mechanism.
    if (k === 0 && ch.reset) {
      if (p < 0.5) { B = A; op = 1 - ease(p * 2); } else { A = B; op = ease(p * 2 - 1); }
      p = 1;
    }
    // Requests and transfers play first; their effect on the scene follows once they arrive.
    if (beat.flight || beat.transfer) p = clamp((lt - beat.tr * 0.75) / (beat.tr * 0.35));
    defs();
    attr(svg, { viewBox: `0 0 ${G.W} ${G.H}` });
    const hot = {};
    NODES.forEach((n) => { hot[n] = lerp(A.hot.includes(n) ? 1 : 0, B.hot.includes(n) ? 1 : 0, p) * op; });
    drawStatic(G, hot);
    drawCards(G, A, B, p);
    drawTable(G, A, B, p);
    const pA = treePos(A, G), pB = treePos(B, G);
    Object.keys(TREE_ORDER).forEach((id) => drawNode(id, G, A, B, pA, pB, p, 1));
    drawMemory(G, A, B, p, 1);
    drawFlows(G, A, B, beat, lt, 1);
    sweep();
    // During a reset, everything that changes fades as one; the frame (titles, nodes, legend) stays.
    ['edges', 'nodes', 'tags', 'mem', 'flow', 'text'].forEach((name) => attr(layers[name], { opacity: op }));
    if (caption && beat.cap !== lastCaption) { caption.innerHTML = beat.cap; lastCaption = beat.cap; }
    tabs.forEach((b, i) => {
      const on = i === L.ci;
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      const bar = b.querySelector('i');
      if (bar) bar.style.width = on ? `${f((L.chapterTime / ch.dur) * 100)}%` : '0';
    });
  }

  /* ---------- playback ---------- */
  let playing = !reduced.matches;
  let visible = true;
  let last = null;
  const chapterEnd = (i) => CHAPTERS[i].t0 + CHAPTERS[i].dur - 0.001;
  if (reduced.matches) time = chapterEnd(0);
  function setPlaying(v) {
    playing = v;
    last = null;
    if (playButton) { playButton.textContent = v ? 'Pause' : 'Play'; playButton.setAttribute('aria-pressed', String(v)); }
  }
  tabs.forEach((b, i) => b.addEventListener('click', () => {
    time = playing ? CHAPTERS[i].t0 : chapterEnd(i);
    last = null;
    render(time);
  }));
  if (playButton) playButton.addEventListener('click', () => setPlaying(!playing));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; last = null; }, { threshold: 0.1 }).observe(svg);
  }
  function tick(now) {
    if (playing && visible && !document.hidden) {
      if (last !== null) time = (time + Math.min(0.1, (now - last) / 1000)) % LOOP;
      last = now;
      render(time);
    } else last = null;
    requestAnimationFrame(tick);
  }
  function height() {
    if (window.parent !== window) window.parent.postMessage({ type: 'demo-height', height: Math.ceil(document.body.getBoundingClientRect().height) }, window.location.origin);
  }
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { pickLayout(); render(time); height(); }).observe(document.body);
  }

  window.kvDirectory = {
    loop: LOOP,
    chapters: CHAPTERS.map((c) => ({ start: c.t0, duration: c.dur, beats: c.beats.map((b) => b.t0) })),
    seek(t) { setPlaying(false); time = t; pickLayout(); render(t); },
    state: () => ({ time, playing, layout: G.name }),
  };
  pickLayout();
  setPlaying(playing);
  render(time);
  height();
  if (window.requestAnimationFrame) requestAnimationFrame(tick);
})();
