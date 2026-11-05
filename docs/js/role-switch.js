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
    const stepButtons = Array.from(section.querySelectorAll('[data-switch-step]'));
    const panels = {
      baseline: section.querySelector('.switch-panel[data-system="baseline"]'),
      evolving: section.querySelector('.switch-panel[data-system="evolving"]')
    };
    const motion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const desktop = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 820px)')
      : null;
    const stageDuration = 3200;
    const lastStep = 4;
    const removers = [];
    let step = Math.min(lastStep, Math.max(0, parseInt(section.dataset.step, 10) || 0));
    let baseline = section.dataset.baseline === 'restart' ? 'restart' : 'sglang';
    let playing = false;
    let timer = null;
    let observer = null;
    let visible = false;
    let visibleRatio = 0;
    let autoConsumed = false;
    let autoPlayed = false;
    let destroyed = false;

    const stages = [
      ['A sustained workload shift', 'Demand shifts toward decode. Both sides start at 3P3D, with prefix K cached on the switch target, Node 3.'],
      ['Prepare the switch', ''],
      ['Same node, new role', 'N3 now serves decode. The split is 2P4D. Local prefix state resets on the left; shared K stays available on the right.'],
      ['The next request arrives', 'K + Δ arrives at N1. The baseline restores K; Evolving Infra fetches the retained prefix from peer L2 while queued.'],
      ['Reuse across the role change', 'Evolving Infra reuses K and prefills Δ. Both paths send request KV from the prefill GPU onward to decode.']
    ];
    // Each row is engine state, cache state, and a panel explanation.
    const labels = {
      evolving: [
        ['Engine running', 'K in shared L2', 'Node 3 serves prefill; its reusable KV is accessible through the shared pool.'],
        ['Engine running; draining work', 'Shared L2 retains K', 'Queued prefills move to other P nodes. Running work drains on Node 3.'],
        ['Same engine, now decode', 'Shared L2 retains K', 'The role changes; the host-memory KV remains accessible.'],
        ['Engine running', 'Fetch K while queued', 'Node 1 fetches peer-L2 prefix K while the request waits in its queue.'],
        ['Engine running', 'Reuse K; prefill Δ', 'This request continues to decode through the normal GPU-to-GPU KV transfer.']
      ],
      sglang: [
        ['Engine running', 'K in local cache', 'Node 3 serves prefill; K is cached locally.'],
        ['Idle required; process running', 'Local K awaits cache reset', 'The caller stops new arrivals and waits until the instance is fully idle before invoking the switch.'],
        ['Same process, now decode', 'Local prefix K unavailable', 'The runtime switch resets the local prefix cache without restarting the process.'],
        ['Process running', 'Reload or recompute K', 'Node 1 restores the missing local prefix by reloading or recomputing it.'],
        ['Process running', 'Prefix restored', 'With K restored, Node 1 prefills the new input.']
      ],
      restart: [
        ['Worker running', 'K in local cache', 'Node 3 serves prefill in the restart-based deployment evaluated in the paper.'],
        ['Selected worker restarting', 'Local K tied to stopped worker', 'The selected worker is terminated; the other nodes keep serving.'],
        ['Replacement worker running', 'Local prefix K unavailable', 'The replacement worker serves decode with a fresh local KV cache.'],
        ['Replacement worker running', 'Reload or recompute K', 'Node 1 restores the missing local prefix by reloading or recomputing it.'],
        ['Replacement worker running', 'Prefix restored', 'With K restored, Node 1 prefills the new input.']
      ]
    };

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
      if (baselineSelect) baselineSelect.value = baseline;
      setText(baselineTitle, baseline === 'sglang' ? 'SGLang runtime switch' : 'Dynamo restart path');
      setText(title, stages[step][0]);
      const explanation = step === 1
        ? baseline === 'sglang'
          ? 'The caller makes SGLang idle before switching. Evolving Infra reroutes queued prefills and drains N3’s running work.'
          : 'The baseline relaunches N3’s worker. Evolving Infra reroutes queued prefills and finishes in-flight work without a restart.'
        : stages[step][1];
      setText(copy, explanation);

      Object.entries(panels).forEach(([system, panel]) => {
        if (!panel) return;
        const row = labels[system === 'evolving' ? 'evolving' : baseline][step];
        setText(panel.querySelector('[data-engine-state]'), row[0]);
        setText(panel.querySelector('[data-cache-state]'), row[1]);
        setText(panel.querySelector('[data-panel-note]'), row[2]);
        setText(panel.querySelector('[data-split]'), step === 1 ? 'N3 → D' : step === 0 ? '3P · 3D' : '2P · 4D');
        setText(panel.querySelector('.switch-node[data-node="3"] .node-phase'), step < 2 ? 'P' : 'D');
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
      return { step, baseline, playing, visible, visibleRatio, reducedMotion: reducedMotion(), autoPlayed, autoConsumed, destroyed };
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
      step = Math.min(step + 1, lastStep);
      if (step === lastStep) playing = false;
      render();
      if (playing) timer = window.setTimeout(advance, stageDuration);
    }

    function startTimed() {
      if (destroyed || playing || !visible || document.hidden || reducedMotion()) return;
      if (step === lastStep) step = 0;
      playing = true;
      render();
      timer = window.setTimeout(advance, stageDuration);
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
      const rect = section.getBoundingClientRect();
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
      baseline = baselineSelect.value === 'restart' ? 'restart' : 'sglang';
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
          if (entry.target !== section) return;
          visibleRatio = entry.intersectionRatio;
          visible = entry.isIntersecting && visibleRatio > 0;
        });
        reactToVisibility();
      }, { threshold: [0, 0.45] });
      observer.observe(section);
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
