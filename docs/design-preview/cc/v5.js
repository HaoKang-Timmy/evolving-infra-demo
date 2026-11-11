// V5 · Every agent's hour. Each side paints 126 thin rows (one row = one agent slot), left to right behind a
// playhead, colored by what that agent was doing every 10 s. A thin ribbon above each panel shows the share of
// prompt text re-read although it was reusable (ideal hit minus actual hit), on the same time axis and scale.
// Red checks mark finished sessions. render(t) is a pure function of t: the rows are painted once into an
// offscreen canvas in init and revealed by clipping at the playhead.
(function () {
  'use strict';

  // Clock: 1 s lead-in, then the 60-minute window at 90x (40 s), then hold until 43.5 s.
  const LEAD = 1, SPEED = 90, WIN = 3600, DUR = 43.5;
  const ARMS = ['dyn', 'ours'];
  const NROW = 126, NCOL = 360; // agent slots; 10 s samples in the window
  const RES = 2; // canvas backing pixels per stage pixel
  const GEO = {
    panelL: { dyn: 40, ours: 980 }, panelW: 900, panelT: 308, panelH: 528,
    rowsDX: 18, rowsW: 864, rowsT: 320, rowH: 4, // rows area: 864 x 504 stage px; 14.4 px per minute
    ribBase: 300, ribPxPerPt: 1, // ribbon: baseline y, 1 stage px per percentage point (same on both sides)
    headT: 250, headB: 830, // playhead spans the ribbon band and the rows
    labelGap: 36, // label line box (30 px) ends 6 px above the ribbon peak
  };
  const COLORS = { W: '#f0a830', G: '#3ecf8e', T: '#6b7280', I: '#1c1e29' };
  const SVGNS = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const wAt = (t) => clamp((t - LEAD) * SPEED, 0, WIN); // window second shown at video time t
  const tAt = (w) => LEAD + w / SPEED; // video time at which the playhead reaches window second w
  const rowsX = (arm) => GEO.panelL[arm] + GEO.rowsDX;

  // Finished sessions inside the window, sorted by end time: tasks rows [slot, start, end, finished].
  function finishedSessions(D, arm) {
    return D[arm].tasks.filter((r) => r[3] === 1 && r[2] >= 0 && r[2] < WIN)
      .map((r) => ({ slot: r[0], end: r[2] })).sort((a, b) => a.end - b.end);
  }
  // Per window minute 0-59: ideal hit minus actual hit (per_min columns 5 and 4; minute of run 30-89).
  function rereadShare(D, arm) {
    const out = new Array(60).fill(0);
    for (const r of D[arm].per_min) {
      const m = r[0] - 30;
      if (m >= 0 && m < 60) out[m] = Math.max(0, r[5] - r[4]);
    }
    return out;
  }
  const ribY = (share) => GEO.ribBase - 100 * share * GEO.ribPxPerPt;
  // Ribbon outline (stage px): linear between minute centres, flat to the two edges.
  function ribbonPoints(share, x0) {
    const k = GEO.rowsW / 60, pts = [[x0, ribY(share[0])]];
    share.forEach((s, m) => pts.push([x0 + (m + 0.5) * k, ribY(s)]));
    pts.push([x0 + GEO.rowsW, ribY(share[59])]);
    return pts;
  }
  // Dynamo's spike near minute 30: the largest share in window minutes 25-40, at its bin centre.
  function labelAnchor(share) {
    let best = 25;
    for (let m = 25; m <= 40; m++) if (share[m] > share[best]) best = m;
    const minute = best + 0.5;
    return { minute, share: share[best], x: rowsX('dyn') + (GEO.rowsW * minute) / 60, t: tAt(minute * 60) };
  }
  // Number of sorted end times <= w.
  function countAt(ends, w) {
    let lo = 0, hi = ends.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= w) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // Paint the full hour once: row r = agent slot r, column i = window seconds [10 i, 10 i + 10) from grid[i].
  function paintRows(grid, canvas) {
    const c = canvas.getContext('2d'), rh = GEO.rowH * RES, W = canvas.width;
    const xb = (i) => Math.round((i * W) / NCOL);
    for (let r = 0; r < NROW; r++) {
      let start = 0, cur = grid[0][r];
      for (let i = 1; i <= NCOL; i++) {
        const ch = i < NCOL ? grid[i][r] : '';
        if (ch === cur) continue;
        c.fillStyle = COLORS[cur] || COLORS.I;
        c.fillRect(xb(start), r * rh, xb(i) - xb(start), rh);
        start = i;
        cur = ch;
      }
    }
  }

  const svgEl = (name, attrs, parent) => {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  };

  const S = {}; // DOM handles built once in init; render only writes attributes
  let label = null;

  function init() {
    const D = window.CC_DATA;
    const defs = document.getElementById('v5-defs');
    const gRib = document.getElementById('ribbons'), gHead = document.getElementById('heads'), gChk = document.getElementById('checks');
    for (const arm of ARMS) {
      const x0 = rowsX(arm), s = (S[arm] = { x0 });
      // rows: the full hour, painted once offscreen
      s.canvas = document.getElementById('rows-' + arm);
      s.ctx = s.canvas.getContext('2d');
      s.off = document.createElement('canvas');
      s.off.width = s.canvas.width;
      s.off.height = s.canvas.height;
      paintRows(D[arm].grid, s.off);
      // ribbon: faint baseline always visible; the area is revealed by a clip rect that follows the playhead
      const share = rereadShare(D, arm);
      if (arm === 'dyn') label = labelAnchor(share);
      const clip = svgEl('clipPath', { id: 'rib-clip-' + arm }, defs);
      s.clipRect = svgEl('rect', { x: x0, y: GEO.ribBase - 60, width: 0, height: 62 }, clip);
      svgEl('line', { x1: x0, x2: x0 + GEO.rowsW, y1: GEO.ribBase + 0.5, y2: GEO.ribBase + 0.5, class: 'rib-base' }, gRib);
      const line = ribbonPoints(share, x0).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(2)).join(' ');
      const g = svgEl('g', { 'clip-path': 'url(#rib-clip-' + arm + ')' }, gRib);
      svgEl('polygon', { points: x0 + ',' + GEO.ribBase + ' ' + line + ' ' + (x0 + GEO.rowsW) + ',' + GEO.ribBase, class: 'rib-area' }, g);
      svgEl('polyline', { points: line, class: 'rib-edge' }, g);
      // playhead
      s.head = svgEl('g', {}, gHead);
      svgEl('rect', { x: -4, y: GEO.headT, width: 8, height: GEO.headB - GEO.headT, class: 'head-glow' }, s.head);
      svgEl('line', { x1: 0, x2: 0, y1: GEO.headT, y2: GEO.headB, class: 'head-line' }, s.head);
      // a red check at the end of each finished session: x = end time, y = the agent's row
      s.checks = finishedSessions(D, arm).map((f) => {
        const x = x0 + (GEO.rowsW * f.end) / WIN, y = GEO.rowsT + (f.slot + 0.5) * GEO.rowH;
        const root = svgEl('g', { transform: 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')', visibility: 'hidden' }, gChk);
        const ring = svgEl('circle', { r: 7.5, class: 'chk-ring', opacity: 0 }, root);
        const body = svgEl('use', { href: '#chk-glyph' }, root);
        body.setAttributeNS(XLINK, 'xlink:href', '#chk-glyph');
        return { end: f.end, te: tAt(f.end), x, y, root, ring, body, vis: false, sKey: '', rKey: '' };
      });
      s.ends = s.checks.map((k) => k.end);
      s.num = document.getElementById('n-' + arm);
      s.clock = document.getElementById('clk-' + arm);
    }
    S.label = document.getElementById('rib-label');
    S.label.style.left = label.x.toFixed(1) + 'px';
    S.label.style.top = (ribY(label.share) - GEO.labelGap).toFixed(1) + 'px';
  }

  function render(t) {
    const St = window.Stage, w = wAt(t), px = (GEO.rowsW * w) / WIN;
    const headOp = 1 - St.seg(t, tAt(WIN), tAt(WIN) + 0.5); // the playhead fades out in the final hold
    for (const arm of ARMS) {
      const s = S[arm];
      // rows: reveal the offscreen hour up to the playhead
      const c = s.ctx, cw = s.canvas.width, ch = s.canvas.height;
      c.clearRect(0, 0, cw, ch);
      if (px > 0) {
        c.save();
        c.beginPath();
        c.rect(0, 0, px * RES, ch);
        c.clip();
        c.drawImage(s.off, 0, 0);
        c.restore();
      }
      s.clipRect.setAttribute('width', px.toFixed(2));
      s.head.setAttribute('transform', 'translate(' + (s.x0 + px).toFixed(2) + ' 0)');
      s.head.setAttribute('opacity', headOp.toFixed(3));
      // checks: shown once the playhead passes the session end; short pop and ring when they appear
      for (const k of s.checks) {
        const on = k.end <= w;
        if (on !== k.vis) { k.root.setAttribute('visibility', on ? 'visible' : 'hidden'); k.vis = on; }
        if (!on) continue;
        const dt = t - k.te;
        const sKey = (1 + 0.8 * (1 - easeOut(clamp(dt / 0.3, 0, 1)))).toFixed(3);
        if (sKey !== k.sKey) { k.body.setAttribute('transform', 'scale(' + sKey + ')'); k.sKey = sKey; }
        const kr = clamp(dt / 0.7, 0, 1);
        const r = (7.5 + 13 * easeOut(kr)).toFixed(2), op = (0.7 * (1 - kr)).toFixed(3), rKey = r + '|' + op;
        if (rKey !== k.rKey) { k.ring.setAttribute('r', r); k.ring.setAttribute('opacity', op); k.rKey = rKey; }
      }
      // counter = checks shown; the same clock on both sides
      const n = String(countAt(s.ends, w));
      if (s.num.textContent !== n) s.num.textContent = n;
      const clk = St.fmtClock(w);
      if (s.clock.textContent !== clk) s.clock.textContent = clk;
    }
    // "re-reading conversations it forgot" fades in as the playhead reaches Dynamo's ribbon peak
    const k = St.ease(St.seg(t, label.t - 0.4, label.t + 0.2));
    S.label.style.opacity = k.toFixed(3);
    S.label.style.transform = 'translateX(-50%) translateY(' + ((1 - k) * 6).toFixed(2) + 'px)';
  }

  const api = { LEAD, SPEED, WIN, DUR, GEO, NROW, NCOL, RES, wAt, tAt, rowsX, finishedSessions, rereadShare, ribbonPoints, labelAnchor, countAt, paintRows, init, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.Stage && typeof document !== 'undefined') {
    window.Stage.run({ duration: DUR, name: 'V5 · Every agent’s hour', init, render });
  }
})();
