/* Section 03: the same workload shifts on both sides. An illustration, not a performance trace or to scale. */
(() => {
  'use strict';

  const N = 9;
  const LOOP = 27;
  const STAGGER = 0.35;  // The planner switches the nodes one after another.
  const FLIP = 0.6;      // Evolving Infra: in-place switch; the node keeps serving.
  const RESTART = 3.6;   // Existing engine: the node is out of service while it relaunches.
  const SLOTS = 3;       // The existing engine relaunches at most three nodes at a time; the rest keep serving their old phase.
  const REFILL = 1.4;    // A relaunched node's local cache fills again with new requests.
  const TO_DECODE = 1.2, TO_PREFILL = 13.4;
  const COLORS = ['kv-r1', 'kv-r0', 'kv-r2'];
  // Two request KV groups per node.
  const KV = Array.from({ length: N }, (_, i) => [[`R${2 * i + 1}`, COLORS[(2 * i) % 3]], [`R${2 * i + 2}`, COLORS[(2 * i + 1) % 3]]]);
  // Each node switches to decode in the first wave and back to prefill in the second.
  const SHIFTS = [];
  for (let i = 0; i < N; i++) SHIFTS.push([TO_DECODE + i * STAGGER, i, 'D']);
  for (let i = 0; i < N; i++) SHIFTS.push([TO_PREFILL + i * STAGGER, i, 'P']);
  // Existing engine: one relaunch per change; a node still relaunching starts its next relaunch when it returns.
  const RESTARTS = (() => {
    const free = new Array(N).fill(0), slots = new Array(SLOTS).fill(0), out = [];
    for (const [t, n, to] of SHIFTS) {
      slots.sort((a, b) => a - b);
      const start = Math.max(t, free[n], slots[0]);
      out.push({ n, to, start, end: start + RESTART });
      free[n] = slots[0] = start + RESTART;
    }
    return out;
  })();
  const CAPTIONS = [
    [0, 'Prefill-heavy workload: all nine nodes run prefill and hold the KV of the requests they served.'],
    [TO_DECODE, 'Workload shift: decode demand rises, so the nodes switch from prefill to decode one after another.'],
    [TO_DECODE + 3.6, 'Evolving Infra switched every node in place and kept its KV. The existing engine relaunches a few nodes at a time; the rest still wait.'],
    [TO_DECODE + 7.4, 'Each relaunched node comes back with an empty local cache.'],
    [TO_PREFILL, 'The workload shifts back: prefill demand rises, so the nodes switch from decode to prefill.'],
    [TO_PREFILL + 3.6, 'Evolving Infra follows the shift in place again. The existing engine relaunches every node a second time.'],
    [TO_PREFILL + 9.4, 'Every relaunch takes a node out of service and drops its local KV.']
  ];

  function init() {
    const section = document.getElementById('role-switch-demo');
    if (!section) return;
    if (window.RoleSwitchDemo && typeof window.RoleSwitchDemo.destroy === 'function') window.RoleSwitchDemo.destroy();
    section.dataset.step = 'timeline';
    section.classList.add('is-timeline');
    const playButton = document.getElementById('switch-play');
    const replayButton = document.getElementById('switch-replay');
    const title = document.getElementById('switch-step-title');
    const stage = section.querySelector('.switch-stage') || section;
    const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = () => !!(motion && motion.matches);

    const sides = ['baseline', 'evolving'].map((system) => {
      const panel = section.querySelector(`.switch-panel[data-system="${system}"]`);
      const host = system === 'evolving';
      const nodeGrid = panel.querySelector('.switch-node-grid');
      const memGrid = panel.querySelector('.memory-node-grid');
      nodeGrid.innerHTML = KV.map((_, i) => `<div class="switch-node" data-node="${i + 1}"><span class="node-id">N${i + 1}</span><span class="node-phase">P</span><span class="restart-bar"><i></i></span></div>`).join('');
      memGrid.innerHTML = KV.map((groups, i) => `<div class="node-storage" data-storage-node="${i + 1}"><span class="storage-node-label"><b>N${i + 1}</b><small>${host ? 'HOST' : 'LOCAL'}</small></span><div class="stored-requests">${groups.map(([label, color]) => `<span class="kv-request ${color} stored-request"><b>${label}</b><span class="kv-sequence"><i></i><i></i><i></i></span></span>`).join('')}</div></div>`).join('');
      return {
        panel, host,
        nodes: Array.from(nodeGrid.children), stores: Array.from(memGrid.children),
        split: panel.querySelector('[data-split]'), status: panel.querySelector('[data-cache-state]'),
        last: []
      };
    });

    // State of one node at time t.
    function nodeState(side, i, t) {
      let phase = 'P';
      if (side.host) {
        let switching = false, kept = false;
        for (const [s, n, to] of SHIFTS) {
          if (n !== i || t < s) continue;
          phase = to; switching = t < s + FLIP; kept = t < s + FLIP + 1.2;
        }
        return { phase, switching, restarting: false, progress: 0, cache: kept ? 'kept' : 'full' };
      }
      let restarting = false, progress = 0, cache = 'full', waiting = false;
      for (const [s, n] of SHIFTS) if (n === i && t >= s && !RESTARTS.some((r) => r.n === i && r.start <= t && r.start >= s)) waiting = true;
      for (const r of RESTARTS) {
        if (r.n !== i || t < r.start) continue;
        if (t < r.end) { restarting = true; progress = (t - r.start) / RESTART; cache = 'wiped'; }
        else { phase = r.to; restarting = false; cache = t < r.end + REFILL ? 'refill' : 'full'; }
      }
      return { phase, switching: false, restarting, progress, cache, waiting: waiting && !restarting };
    }

    function render(t) {
      for (const side of sides) {
        let p = 0, d = 0, out = 0, busy = 0, wait = 0;
        side.nodes.forEach((node, i) => {
          const s = nodeState(side, i, t);
          const key = [s.phase, s.switching, s.restarting, s.cache, s.waiting].join('|');
          if (side.last[i] !== key) {
            side.last[i] = key;
            node.classList.toggle('is-decode', s.phase === 'D' && !s.restarting);
            node.classList.toggle('is-restarting', s.restarting);
            node.classList.toggle('is-switching', s.switching);
            node.classList.toggle('is-waiting', !!s.waiting);
            node.querySelector('.node-phase').textContent = s.restarting ? '…' : s.phase;
            const store = side.stores[i];
            store.classList.toggle('is-wiped', s.cache === 'wiped');
            store.classList.toggle('is-refill', s.cache === 'refill');
            store.classList.toggle('is-kept', s.cache === 'kept');
          }
          if (s.restarting) { node.style.setProperty('--p', `${Math.round(s.progress * 100)}%`); out += 1; }
          else if (s.phase === 'P') p += 1; else d += 1;
          if (s.switching) busy += 1;
          if (s.waiting) wait += 1;
        });
        const split = `${p}P · ${d}D${out ? ` · ${out} restarting` : ''}`;
        if (side.split.textContent !== split) side.split.textContent = split;
        const status = side.host
          ? (busy ? 'Switching in place · all nodes serving · KV kept' : 'All nodes serving · KV readable by all nodes')
          : (out ? `${out} restarting · out of service · local KV lost${wait ? ` · ${wait} waiting` : ''}` : 'All nodes serving');
        if (side.status.textContent !== status) side.status.textContent = status;
        side.panel.classList.toggle('has-outage', !side.host && out > 0);
      }
      let caption = CAPTIONS[0][1];
      for (const [at, text] of CAPTIONS) if (t >= at) caption = text;
      if (title && title.textContent !== caption) title.textContent = caption;
    }

    let time = reduced() ? TO_DECODE + 3.6 : 0, playing = false, visible = false, last = null, frame = 0, destroyed = false;
    const removers = [];
    function setPlaying(value) {
      playing = value; last = null;
      section.dataset.playing = String(value);
      if (playButton) { playButton.textContent = value ? 'Pause' : 'Play'; playButton.setAttribute('aria-pressed', String(value)); }
    }
    function tick(now) {
      frame = 0;
      if (destroyed) return;
      if (playing && visible && !document.hidden) {
        if (last !== null) time = (time + Math.min(0.1, (now - last) / 1000)) % LOOP;
        last = now; render(time);
      } else last = null;
      frame = requestAnimationFrame(tick);
    }
    function listen(el, type, fn, opt) { if (!el) return; el.addEventListener(type, fn, opt); removers.push(() => el.removeEventListener(type, fn, opt)); }
    function restart() { time = 0; sides.forEach((s) => { s.last = []; }); render(time); setPlaying(true); }
    listen(playButton, 'click', (e) => { e.preventDefault(); auto = false; setPlaying(!playing); });
    listen(replayButton, 'click', (e) => { e.preventDefault(); auto = false; restart(); });
    listen(document, 'visibilitychange', () => { last = null; });
    let auto = !reduced();
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      visible = entry.isIntersecting; last = null;
      if (auto && entry.intersectionRatio >= 0.35) { auto = false; setPlaying(true); }
    }, { threshold: [0, 0.35] }) : null;
    if (observer) observer.observe(stage); else visible = true;
    // Grow the measured switch-time bars the first time they come into view.
    const measured = document.querySelector('.switch-measured');
    let measuredObserver = null;
    if (measured) {
      if (reduced() || !('IntersectionObserver' in window)) measured.classList.add('is-in');
      else {
        measuredObserver = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) { measured.classList.add('is-in'); measuredObserver.disconnect(); }
        }, { threshold: 0.4 });
        measuredObserver.observe(measured);
      }
    }

    const api = {
      seek(t) { auto = false; setPlaying(false); time = Math.max(0, Math.min(LOOP - 0.01, Number(t) || 0)); sides.forEach((s) => { s.last = []; }); render(time); return api.getState(); },
      play() { auto = false; setPlaying(true); return api.getState(); },
      pause() { auto = false; setPlaying(false); return api.getState(); },
      replay() { auto = false; restart(); return api.getState(); },
      getState() { return { time, playing, visible, reducedMotion: reduced() }; },
      destroy() { destroyed = true; if (frame) cancelAnimationFrame(frame); if (observer) observer.disconnect(); if (measuredObserver) measuredObserver.disconnect(); removers.forEach((r) => r()); if (window.RoleSwitchDemo === api) delete window.RoleSwitchDemo; }
    };
    window.RoleSwitchDemo = api;
    setPlaying(false); render(time);
    frame = requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
