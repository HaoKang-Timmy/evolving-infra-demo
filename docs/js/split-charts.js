/* Section 04: draw the three PD-split curves left to right, then show the measured best split. */
(() => {
  'use strict';
  const root = document.querySelector('[data-split-charts]');
  if (!root) return;
  const x0 = Number(root.dataset.x0), x1 = Number(root.dataset.x1);
  const rects = Array.from(root.querySelectorAll('.sc-clip-rect'));
  const cursors = Array.from(root.querySelectorAll('.sc-cursor'));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DRAW = 4.5; // seconds for 25 to 90 minutes
  let start = null, frame = 0;
  root.classList.add('is-js');
  function set(p) {
    const x = x0 + (x1 - x0) * p;
    rects.forEach((r) => r.setAttribute('width', String(p >= 1 ? x1 - x0 + 8 : Math.max(0, x - x0 + 4))));
    cursors.forEach((c) => { c.setAttribute('x1', String(x)); c.setAttribute('x2', String(x)); });
    root.classList.toggle('is-drawing', p > 0 && p < 1);
    root.classList.toggle('show-best', p >= 1);
  }
  function tick(now) {
    if (start === null) start = now;
    const p = Math.min(1, (now - start) / 1000 / DRAW);
    set(p);
    frame = p < 1 ? requestAnimationFrame(tick) : 0;
  }
  function play() { if (frame) cancelAnimationFrame(frame); start = null; set(0); frame = requestAnimationFrame(tick); }
  if (reduced || !('IntersectionObserver' in window)) set(1);
  else {
    set(0);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); play(); }
    }, { threshold: 0.35 });
    io.observe(root);
  }
  const replay = root.querySelector('[data-split-replay]');
  if (replay) replay.addEventListener('click', () => (reduced ? set(1) : play()));
  window.splitCharts = { seek(p) { if (frame) cancelAnimationFrame(frame); frame = 0; set(Math.max(0, Math.min(1, Number(p) || 0))); }, play };
})();
