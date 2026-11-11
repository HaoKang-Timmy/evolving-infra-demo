/* A staged explanation of role switching, not a real-time performance trace. */
(() => {
  'use strict';

  function init() {
    const section = document.getElementById('role-switch-demo');
    if (!section) return;
    if (window.RoleSwitchDemo && typeof window.RoleSwitchDemo.destroy === 'function') {
      window.RoleSwitchDemo.destroy();
    }

    const playButton = document.getElementById('switch-play');
    const replayButton = document.getElementById('switch-replay');
    const baselineSelect = document.getElementById('switch-baseline');
    const title = document.getElementById('switch-step-title');
    const copy = document.getElementById('switch-step-copy');
    const baselineTitle = document.getElementById('baseline-title');
    const stage = section.querySelector('.switch-stage') || section;
    const stepButtons = Array.from(section.querySelectorAll('[data-switch-step]'));
    const panels = {
      baseline: section.querySelector('.switch-panel[data-system="baseline"]'),
      evolving: section.querySelector('.switch-panel[data-system="evolving"]')
    };
    const detailPanels = {
      baseline: section.querySelector('[data-detail-system="baseline"]'),
      evolving: section.querySelector('[data-detail-system="evolving"]')
    };
    const motion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const desktop = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 820px)')
      : null;
    // Three beats. Evolving Infra completes its switch early in beat 2, while the existing engine is still restarting.
    const stageDurations = [2600, 4200, 3600];
    const lastStep = 2;
    const removers = [];
    let step = Math.min(lastStep, Math.max(0, parseInt(section.dataset.step, 10) || 0));
    let baseline = 'restart';
    let playing = false;
    let timer = null;
    let observer = null;
    let visible = false;
    let visibleRatio = 0;
    let autoConsumed = false;
    let autoPlayed = false;
    let cycleCount = 0;
    let destroyed = false;

    const stages = [
      ['Workload shift: decode demand rises, so N3 must move from prefill to decode.', ''],
      ['Switching: the existing engine restarts N3; Evolving Infra switches it in place and keeps serving.', ''],
      ['KV outcome: N3’s local KV is lost on the left; on the right it stays readable by all nodes.', '']
    ];
    // Each row is engine state, cache state, and a panel explanation.
    const labels = {
      evolving: [
        ['N3 running', 'KV stored on N3', ''],
        ['N3 switched, still serving', 'KV stays on N3', ''],
        ['N3 serving decode', 'KV readable by all nodes', '']
      ],
      restart: [
        ['N3 running', 'KV cached on N3', ''],
        ['N3 restarting', 'N3 local KV lost', ''],
        ['N3 serving decode', 'N3 local KV lost', '']
      ]
    };
    const costDetails = { evolving: [['', ''], ['', ''], ['', '']], restart: [['', ''], ['', ''], ['', '']] };
    const nodeStatuses = {
      evolving: ['PREFILL', 'D · STILL SERVING', 'D · KV RETAINED'],
      restart: ['PREFILL', 'RESTARTING', 'D · LOCAL KV LOST']
    };

    if (baselineSelect) {
      const restartOption = baselineSelect.querySelector('option[value="restart"]');
      const sglangOption = baselineSelect.querySelector('option[value="sglang"]');
      if (restartOption && sglangOption && restartOption.parentElement === sglangOption.parentElement) {
        restartOption.parentElement.insertBefore(restartOption, sglangOption);
      }
    }

    const reducedMotion = () => !!(motion && motion.matches);
    const isDesktop = () => desktop ? desktop.matches : window.innerWidth >= 820;

    function setText(element, value) {
      if (!element || element.closest('[data-shared-prefix]') || element.querySelector('[data-shared-prefix]')) return;
      if (element.textContent !== value) element.textContent = value;
    }

    function updateControls() {
      section.dataset.playing = String(playing);
      if (playButton) {
        const label = reducedMotion()
          ? (step === lastStep ? 'Start over' : 'Next stage')
          : (playing ? 'Pause' : step === lastStep ? 'Play again' : 'Play');
        setText(playButton, label);
        playButton.setAttribute('aria-pressed', String(playing));
      }
    }

    function render() {
      section.dataset.step = String(step);
      section.dataset.baseline = baseline;
      section.style.setProperty('--stage-duration', `${stageDurations[step]}ms`);
      if (baselineSelect) baselineSelect.value = baseline;
      setText(baselineTitle, baseline === 'sglang' ? 'SGLang runtime switch' : 'Existing engine');
      setText(title, stages[step][0]);
      const explanation = stages[step][1];
      setText(copy, explanation);

      Object.entries(panels).forEach(([system, panel]) => {
        if (!panel) return;
        const path = system === 'evolving' ? 'evolving' : baseline;
        const row = labels[path][step];
        const costs = costDetails[path][step];
        const detail = detailPanels[system] || panel;
        if (system === 'baseline') {
          setText(panel.querySelector('[data-engine-family]'), baseline === 'restart'
            ? 'Engine example: SGLang'
            : 'In-place role switch · KV caching enabled');
          setText(panel.querySelector('[data-path-label]'), baseline === 'restart'
            ? 'Restart-based reconfiguration'
            : 'Idle → role switch → KV cache reset');
        }
        setText(detail.querySelector('[data-engine-state]'), row[0]);
        setText(panel.querySelector('[data-cache-state]'), row[1]);
        setText(detail.querySelector('[data-panel-note]'), row[2]);
        setText(panel.querySelector('[data-change-cost]'), system === 'evolving'
          ? 'No restart' : baseline === 'restart' ? 'Restart delay' : 'Idle + reconfigure');
        setText(detail.querySelector('[data-change-detail]'), costs[0]);
        setText(panel.querySelector('[data-kv-cost]'), system === 'evolving'
          ? 'KV retained' : baseline === 'restart' ? 'Local KV lost' : 'Local KV reset');
        setText(detail.querySelector('[data-kv-detail]'), costs[1]);
        setText(panel.querySelector('[data-split]'), step === 0 ? '3P · 3D' : step === 1 && system === 'baseline' ? 'N3 → D' : '2P · 4D');
        const phase = step === 0 ? 'P' : step === 1 && system === 'baseline' ? '…' : 'D';
        setText(panel.querySelector('.switch-node[data-node="3"] .node-phase'), phase);
        setText(panel.querySelector('.switch-node[data-node="3"] [data-node-status]')
          || panel.querySelector('[data-node-status]'), nodeStatuses[path][step]);
        const targetLabel = step === 0 ? 'N3: prefill → decode'
          : step === 1 ? (system === 'baseline' ? 'N3: restarting, not serving' : 'N3: switched, still serving')
            : system === 'baseline' ? 'N3: decode · local KV lost' : 'N3: decode · KV retained';
        setText(panel.querySelector('.switch-target-label'), targetLabel);
      });
      stepButtons.forEach((button) => {
        const current = Number(button.dataset.switchStep) === step;
        button.classList.toggle('is-current', current);
        button.setAttribute('aria-pressed', String(current));
        if (current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      updateControls();
    }

    function snapshot() {
      return { step, baseline, playing, visible, visibleRatio, reducedMotion: reducedMotion(), autoPlayed, autoConsumed, cycleCount, destroyed };
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
      if (step === lastStep) {
        step = 0;
        cycleCount += 1;
      } else {
        step += 1;
      }
      render();
      if (playing) timer = window.setTimeout(advance, stageDurations[step]);
    }

    function startTimed() {
      if (destroyed || playing || !visible || document.hidden || reducedMotion()) return;
      if (step === lastStep) step = 0;
      playing = true;
      render();
      timer = window.setTimeout(advance, stageDurations[step]);
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

    function replay() {
      if (destroyed) return snapshot();
      stop(true);
      step = 0;
      render();
      // Reduced motion stays at the first static stage until the next user action.
      if (!reducedMotion()) startTimed();
      return snapshot();
    }

    function maybeAutoplay() {
      if (destroyed || autoConsumed || !isDesktop() || reducedMotion() || document.hidden || visibleRatio < 0.45) return;
      autoConsumed = true;
      autoPlayed = true;
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
    listen(baselineSelect, 'change', () => {
      stop(true);
      baseline = baselineSelect.value === 'sglang' ? 'sglang' : 'restart';
      render();
    });
    stepButtons.forEach((button) => listen(button, 'click', (event) => {
      event.preventDefault();
      setStep(button.dataset.switchStep);
    }));
    listen(document, 'visibilitychange', () => {
      if (document.hidden && playing) stop(true);
      // Becoming visible does not resume a paused explanation.
    });
    listen(motion, 'change', () => {
      if (reducedMotion() && playing) stop(true);
      updateControls();
    });

    const api = {
      setStep, play, pause, replay, getState: snapshot,
      destroy() {
        if (destroyed) return;
        stop(true);
        destroyed = true;
        if (observer) observer.disconnect();
        removers.forEach((remove) => remove());
        removers.length = 0;
        if (window.RoleSwitchDemo === api) delete window.RoleSwitchDemo;
      }
    };
    window.RoleSwitchDemo = api;
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
