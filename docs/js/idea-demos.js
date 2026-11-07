/* Staged comparisons for workload-aware planning and agent-aware KV management.
   The controls and autoplay rules follow the role-switch demo (role-switch.js). */
(() => {
  'use strict';

  const NODES = 6;

  // Planning: work in node units, i.e. how many nodes each phase needs. Stage 3 adds a short prefill spike.
  const NEED = [[2.6, 2.8], [2.6, 2.8], [2.6, 2.8], [3.6, 1.8], [3.6, 1.8]];
  const SPIKE = [0, 0, 4.4, 0, 0];
  const PLAN = {
    titles: [
      'Coding agents reuse long cached contexts. Both sides start at 3P3D.',
      'Each planner sizes the split from what it measures.',
      'Six sub-agents start at once. Prefill work spikes, then drains.',
      'Computer-use agents take over. Screenshots add new prefill work.',
      'Measured over one hour of Claude Code agents.'
    ],
    durations: [3200, 3800, 3800, 4000, 3600],
    systems: {
      dynamo: {
        name: 'Dynamo planner',
        chips: ['Reads queue depth and KV use', 'Relaunches a worker per switch'],
        prefill: [3, 2, 2, 2, 2],
        guess: [[2.6, 4.2], [2.6, 4.2], [2.6, 4.2], [3.6, 3.2], [3.6, 3.2]],
        tp: [1, 0.77, 0.77, 0.56, 0.51],
        status: [
          'Starts at 3P3D. Long contexts keep decode KV use high.',
          'High KV use reads as decode demand: N3 moves to decode.',
          'KV use stays high, so prefill stays one node short.',
          'Prefill work grows, but the split stays at 2P4D.',
          'Measured: 49% below the best static split.'
        ]
      },
      arrow: {
        name: 'Arrow planner',
        chips: ['Counts the full input as prefill', 'Reacts to short bursts'],
        prefill: [3, 4, 5, 5, 5],
        guess: [[4.2, 2.8], [4.2, 2.8], [5.9, 2.8], [5.2, 1.8], [5.2, 1.8]],
        tp: [1, 0.71, 0.36, 0.56, 0.35],
        status: [
          'Starts at 3P3D. Cached prefixes count as prefill work.',
          'Prefill looks heavy: N4 moves to prefill. Decode falls short.',
          'The burst looks like lasting demand: N5 moves as well.',
          'Still at 5P1D. Decode is the bottleneck.',
          'Measured: 65% below the best static split, with 34 switches.'
        ]
      },
      evolving: {
        chips: ['Models work after KV reuse', 'Switches on lasting gains'],
        prefill: [3, 3, 3, 4, 4],
        guess: [[2.6, 2.8], [2.6, 2.8], [2.7, 2.8], [3.6, 1.8], [3.6, 1.8]],
        tp: [1, 1, 1, 1, 1],
        status: [
          'Starts at 3P3D. Models the work left after KV reuse.',
          'The model matches the work, so the split stays.',
          'The window average barely moves. No switch.',
          'The gain holds across the window: N4 moves to prefill, once.',
          'Measured: over twice the throughput of either planner.'
        ]
      }
    }
  };

  // KV management: one row of states per stage. o = kept, n = new, h = reused, d = no branch reuses it,
  // g = evicted, r = recomputed, - = absent; the digit is the count of branches that reuse the block there.
  const STATE = { o: 'on', n: 'new', h: 'hit', d: 'dead', g: 'gone', r: 'redo', '-': 'off' };
  const BASE = 'a1:o a2:o a3:o a4:- c1:o c2:o c3:o s:- b1:- b2:-';
  function rows(base, ...changes) {
    let cur = Object.fromEntries(base.split(' ').map((kv) => kv.split(':')));
    return changes.map((c) => {
      cur = Object.assign({}, cur, Object.fromEntries(c.split(' ').filter(Boolean).map((kv) => kv.split(':'))));
      return cur;
    });
  }
  const LRU = (b1, b2) => rows(BASE, '', b1, `s:n ${b2}`, 'a1:g a2:g a3:g s:o', 'a1:r a2:r a3:r a4:n');
  const KV = {
    titles: [
      'Agent C spawns sub-agent B, which reuses C’s context on N1.',
      'B’s first request arrives. N1 holds the context but has a long queue.',
      'C compacts its context. Its old history is no longer reused.',
      'N1 needs room for new KV and evicts three blocks.',
      'Agent A’s tool call returns. Its next request needs its context.'
    ],
    durations: [3200, 4200, 3600, 3800, 3600],
    agents: [
      ['waiting for a tool', '', 'sub-agent of C'],
      ['waiting for a tool', '', 'sub-agent of C'],
      ['waiting for a tool', 'compacted', 'sub-agent of C'],
      ['waiting for a tool', 'compacted', 'sub-agent of C'],
      ['tool returned', 'compacted', 'sub-agent of C']
    ],
    systems: {
      cache: {
        name: 'Cache-aware router',
        chips: ['Routes to the KV holder', 'Evicts least recently used'],
        routeB: 1,
        blocks: LRU('', ''),
        notes: [['', '', ''], ['B waits behind 4', '', ''], ['', '', ''], ['evicts A’s blocks', '', ''], ['recomputes A', '', '']],
        status: [
          'N1 holds the contexts of A and C.',
          'B waits behind N1’s queue.',
          'C’s old history stays: it was used recently.',
          'LRU evicts A’s context: A was waiting for a tool.',
          'A recomputes its whole context before its next step.'
        ]
      },
      load: {
        name: 'Dynamo KV router',
        chips: ['Balances load, recomputes KV', 'Evicts least recently used'],
        routeB: 2,
        blocks: LRU('b1:r b2:r', 'b1:o b2:o'),
        notes: [['', '', ''], ['', 'recomputes C’s prefix', ''], ['', '', ''], ['evicts A’s blocks', '', ''], ['recomputes A', '', '']],
        status: [
          'N1 holds the contexts of A and C.',
          'B starts on N2, which recomputes C’s prefix.',
          'C’s old history stays: it was used recently.',
          'LRU evicts A’s context: A was waiting for a tool.',
          'A recomputes its whole context before its next step.'
        ]
      },
      evolving: {
        chips: ['Routes by predicted TTFT', 'Evicts unreused KV first'],
        routeB: 2,
        blocks: rows('a1:o1 a2:o1 a3:o1 a4:- c1:o2 c2:o2 c3:o1 s:- b1:- b2:-',
          '', 'c1:o1 c2:o1 b1:n1 b2:n1', 'c1:d0 c2:d0 c3:d0 s:n1 b1:o1 b2:o1', 'c1:g c2:g c3:g s:o1',
          'a1:h1 a2:h1 a3:h1 a4:n1 c1:- c2:- c3:-'),
        notes: [['', '', ''], ['', 'copies C’s prefix', ''], ['', '', ''], ['evicts count-0 blocks', '', ''], ['reuses A’s blocks', '', '']],
        status: [
          'Counts show how many branches reuse each block.',
          'B starts on N2, which copies C’s prefix while B waits.',
          'C’s old history drops to a count of 0.',
          'N1 evicts the count-0 blocks. A’s context stays.',
          'A reuses its context on N1 right away.'
        ]
      }
    }
  };

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function renderPlan(panel, sys, step) {
    setText(panel.querySelector('[data-t="name"]'), sys.name || '');
    setText(panel.querySelector('[data-t="chip1"]'), sys.chips[0]);
    setText(panel.querySelector('[data-t="chip2"]'), sys.chips[1]);
    setText(panel.querySelector('[data-t="status"]'), sys.status[step]);
    const prefill = sys.prefill[step];
    const before = sys.prefill[Math.max(0, step - 1)];
    setText(panel.querySelector('[data-split]'), `${prefill}P · ${NODES - prefill}D`);
    const counts = [prefill, NODES - prefill];
    panel.querySelectorAll('.plan-track').forEach((track, row) => {
      const need = NEED[step][row];
      track.style.setProperty('--need', need);
      track.style.setProperty('--guess', sys.guess[step][row]);
      track.style.setProperty('--spike', row === 0 && SPIKE[step] ? SPIKE[step] : need);
      track.classList.toggle('is-short', counts[row] < need);
    });
    panel.querySelectorAll('.plan-node').forEach((node) => {
      const id = Number(node.dataset.node);
      const decode = id > prefill;
      node.style.setProperty('--row', decode ? 1 : 0);
      node.style.setProperty('--col', decode ? id - prefill - 1 : id - 1);
      node.classList.toggle('is-decode', decode);
      node.classList.toggle('is-moved', step > 0 && (id > before) !== decode);
      setText(node.querySelector('b'), decode ? 'D' : 'P');
    });
    const bar = panel.querySelector('.plan-bar');
    if (bar) bar.style.setProperty('--tp', sys.tp[step]);
  }

  function renderKv(panel, sys, step) {
    setText(panel.querySelector('[data-t="name"]'), sys.name || '');
    setText(panel.querySelector('[data-t="chip1"]'), sys.chips[0]);
    setText(panel.querySelector('[data-t="chip2"]'), sys.chips[1]);
    setText(panel.querySelector('[data-t="status"]'), sys.status[step]);
    const table = sys.blocks[step];
    panel.querySelectorAll('.kvm-b').forEach((block) => {
      const code = table[block.dataset.b] || '-';
      block.dataset.state = STATE[code[0]] || 'off';
      setText(block.querySelector('em'), code.slice(1));
    });
    panel.querySelectorAll('.kvm-row').forEach((row) => {
      row.classList.toggle('is-empty', !row.querySelector('.kvm-b:not([data-state="off"])'));
    });
    panel.querySelectorAll('.kvm-note').forEach((note, i) => setText(note, sys.notes[step][i]));
    panel.querySelectorAll('.kvm-agent').forEach((agent, i) => setText(agent.querySelector('em'), KV.agents[step][i]));
    const reqB = panel.querySelector('[data-req="B"]');
    const reqA = panel.querySelector('[data-req="A"]');
    if (reqB) reqB.dataset.at = step === 0 ? 'hidden' : step === 1 ? `q${sys.routeB}` : 'done';
    if (reqA) reqA.dataset.at = step === 4 ? 'n1' : 'hidden';
  }

  function setup(section, cfg, renderPanel) {
    const playButton = section.querySelector('[data-demo-play]');
    const replayButton = section.querySelector('[data-demo-replay]');
    const select = section.querySelector('[data-demo-baseline]');
    const title = section.querySelector('[data-demo-title]');
    const stage = section.querySelector('.switch-stage') || section;
    const stepButtons = Array.from(section.querySelectorAll('[data-demo-step]'));
    const panels = Array.from(section.querySelectorAll('.switch-panel[data-system]'));
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const desktop = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 820px)') : null;
    const lastStep = cfg.titles.length - 1;
    const removers = [];
    let step = 0;
    let baseline = select ? select.value : Object.keys(cfg.systems)[0];
    let playing = false;
    let timer = null;
    let observer = null;
    let visible = false;
    let visibleRatio = 0;
    let autoConsumed = false;
    let destroyed = false;

    const reducedMotion = () => !!(motion && motion.matches);
    const isDesktop = () => desktop ? desktop.matches : window.innerWidth >= 820;

    function updateControls() {
      section.dataset.playing = String(playing);
      if (playButton) {
        setText(playButton, reducedMotion()
          ? (step === lastStep ? 'Start over' : 'Next stage')
          : (playing ? 'Pause' : step === lastStep ? 'Play again' : 'Play comparison'));
        playButton.setAttribute('aria-pressed', String(playing));
      }
    }

    function render() {
      section.dataset.stage = String(step);
      section.dataset.baseline = baseline;
      section.style.setProperty('--stage-duration', `${cfg.durations[step]}ms`);
      if (select) select.value = baseline;
      setText(title, cfg.titles[step]);
      panels.forEach((panel) => {
        const key = panel.dataset.system === 'evolving' ? 'evolving' : baseline;
        renderPanel(panel, cfg.systems[key], step);
      });
      stepButtons.forEach((button) => {
        const current = Number(button.dataset.demoStep) === step;
        button.setAttribute('aria-pressed', String(current));
        if (current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      updateControls();
    }

    function snapshot() {
      return { step, baseline, playing, visible, visibleRatio, autoConsumed, destroyed };
    }

    function stop(consumeAuto = false) {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      playing = false;
      if (consumeAuto) autoConsumed = true;
      updateControls();
    }

    function advance() {
      timer = null;
      if (destroyed || !playing) return;
      if (!visible || document.hidden || reducedMotion()) {
        stop(true);
        return;
      }
      step = step === lastStep ? 0 : step + 1;
      render();
      if (playing) timer = window.setTimeout(advance, cfg.durations[step]);
    }

    function startTimed() {
      if (destroyed || playing || !visible || document.hidden || reducedMotion()) return;
      if (step === lastStep) step = 0;
      playing = true;
      render();
      timer = window.setTimeout(advance, cfg.durations[step]);
    }

    function play() {
      if (destroyed) return snapshot();
      autoConsumed = true;
      if (reducedMotion()) {
        stop();
        step = step === lastStep ? 0 : step + 1;
        render();
      } else {
        startTimed();
      }
      return snapshot();
    }

    function pause() {
      if (!destroyed) stop(true);
      return snapshot();
    }

    function setStep(value) {
      if (destroyed) return snapshot();
      const requested = Number(value);
      if (!Number.isFinite(requested)) return snapshot();
      stop(true);
      step = Math.min(lastStep, Math.max(0, Math.trunc(requested)));
      render();
      return snapshot();
    }

    function setBaseline(value) {
      if (destroyed || !cfg.systems[value] || value === 'evolving') return snapshot();
      stop(true);
      baseline = value;
      render();
      return snapshot();
    }

    function replay() {
      if (destroyed) return snapshot();
      stop(true);
      step = 0;
      render();
      if (!reducedMotion()) startTimed();
      return snapshot();
    }

    function maybeAutoplay() {
      if (destroyed || autoConsumed || !isDesktop() || reducedMotion() || document.hidden || visibleRatio < 0.45) return;
      autoConsumed = true;
      startTimed();
    }

    function reactToVisibility() {
      if (!visible && playing) stop(true);
      maybeAutoplay();
    }

    function measureVisibility() {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      visibleRatio = rect.width > 0 && rect.height > 0 ? width * height / (rect.width * rect.height) : 0;
      visible = visibleRatio > 0;
      reactToVisibility();
    }

    function listen(element, type, listener, options) {
      if (!element || typeof element.addEventListener !== 'function') return;
      element.addEventListener(type, listener, options);
      removers.push(() => element.removeEventListener(type, listener, options));
    }

    if (title) {
      title.setAttribute('aria-live', 'polite');
      title.setAttribute('aria-atomic', 'true');
    }
    listen(playButton, 'click', (event) => {
      event.preventDefault();
      if (playing) pause();
      else play();
    });
    listen(replayButton, 'click', (event) => {
      event.preventDefault();
      replay();
    });
    listen(select, 'change', () => setBaseline(select.value));
    stepButtons.forEach((button) => listen(button, 'click', (event) => {
      event.preventDefault();
      setStep(button.dataset.demoStep);
    }));
    listen(document, 'visibilitychange', () => {
      if (document.hidden && playing) stop(true);
    });
    listen(motion, 'change', () => {
      if (reducedMotion() && playing) stop(true);
      updateControls();
    });

    const api = {
      setStep, setBaseline, play, pause, replay, getState: snapshot,
      destroy() {
        if (destroyed) return;
        stop(true);
        destroyed = true;
        if (observer) observer.disconnect();
        removers.forEach((remove) => remove());
        removers.length = 0;
      }
    };
    render();
    measureVisibility();
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target !== stage) return;
          visibleRatio = entry.intersectionRatio;
          visible = entry.isIntersecting && visibleRatio > 0;
        });
        reactToVisibility();
      }, { threshold: [0, 0.45] });
      observer.observe(stage);
    } else {
      listen(window, 'scroll', measureVisibility, { passive: true });
      listen(window, 'resize', measureVisibility, { passive: true });
    }
    return api;
  }

  function init() {
    if (window.IdeaDemos) Object.values(window.IdeaDemos).forEach((demo) => demo.destroy());
    const demos = {};
    const planning = document.getElementById('planning-demo');
    const kv = document.getElementById('kv-demo');
    if (planning) demos.planning = setup(planning, PLAN, renderPlan);
    if (kv) demos.kv = setup(kv, KV, renderKv);
    window.IdeaDemos = demos;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
