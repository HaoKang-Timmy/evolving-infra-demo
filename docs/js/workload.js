/* Illustrative agent workflows; these states are not benchmark telemetry. */
(() => {
  'use strict';

  function init() {
    const hero = document.getElementById('hero');
    if (!hero) return;
    if (window.WorkloadScene && typeof window.WorkloadScene.destroy === 'function') {
      window.WorkloadScene.destroy();
    }

    const layer = hero.querySelector('.application-layer');
    const moment = document.getElementById('workload-moment');
    const definitions = [
      {
        key: 'math', moment: 'Deep reasoning', chips: ['Thought', 'Check', 'Next'],
        phases: [
          ['reasoning', 'Reasoning'], ['checking', 'Checking'], ['new-problem', 'New problem']
        ]
      },
      {
        key: 'cua', moment: 'Fresh visual context', chips: ['View', 'Click', 'Read'],
        phases: [
          ['reading-screen', 'Reading screen'], ['clicking', 'Clicking'], ['new-screen', 'New screen']
        ]
      },
      {
        key: 'code', moment: 'Parallel branches', chips: ['Edit', 'Test', 'Fork'],
        phases: [
          ['editing', 'Editing'], ['testing', 'Testing'], ['new-branch', 'New branch']
        ]
      },
      {
        key: 'proactive', moment: 'New tasks arriving', chips: ['Watch', 'Trigger', 'Run'],
        phases: [
          ['watching', 'Watching'], ['triggered', 'Triggered'], ['starting-task', 'Starting task']
        ]
      }
    ];
    const applications = definitions.map((definition) => {
      const figure = hero.querySelector(`.application-${definition.key}`);
      return {
        ...definition,
        figure,
        label: figure ? figure.querySelector('.activity-label') : null,
        track: figure ? figure.querySelector('.activity-track') : null,
        chips: figure ? Array.from(figure.querySelectorAll('.activity-track .task-chip')) : [],
        chipLabels: definition.chips,
        step: 0
      };
    });
    if (!applications.some((application) => application.figure)) return;

    const motion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const removers = [];
    const viewportTarget = layer || hero;
    let observer = null;
    let classObserver = null;
    let timer = null;
    let tick = 0;
    let inViewport = true;
    let manuallyPaused = false;
    let running = false;
    let destroyed = false;

    const mainIndex = () => Math.floor(tick / 2) % applications.length;
    const setText = (element, value) => {
      if (element && element.textContent !== value) element.textContent = value;
    };

    function render() {
      const primary = mainIndex();
      const currentMoment = definitions[primary];
      setText(moment, currentMoment.moment);
      if (moment) moment.dataset.moment = currentMoment.key;
      applications.forEach((application, index) => {
        const { figure, label, track, chips, chipLabels, phases, step } = application;
        if (!figure) return;
        const distance = (index - primary + applications.length) % applications.length;
        figure.classList.toggle('is-busy', distance === 0);
        figure.classList.toggle('is-working', distance === 1 || distance === 2);
        figure.dataset.phase = phases[step][0];
        figure.dataset.step = String(step + 1);
        setText(label, phases[step][1]);
        if (track) track.dataset.step = String(step + 1);
        chips.forEach((chip, chipIndex) => {
          if (chipIndex >= chipLabels.length) return;
          const state = chipIndex < step ? 'complete' : chipIndex === step ? 'current' : 'next';
          setText(chip, chipLabels[chipIndex]);
          chip.dataset.state = state;
          chip.classList.toggle('is-current', state === 'current');
          chip.classList.toggle('is-complete', state === 'complete');
          if (state === 'current') chip.setAttribute('aria-current', 'step');
          else chip.removeAttribute('aria-current');
        });
      });
    }

    function pauseReasons() {
      const reasons = [];
      if (destroyed) reasons.push('destroyed');
      if (manuallyPaused) reasons.push('manual');
      if (motion && motion.matches) reasons.push('reduced-motion');
      if (document.hidden) reasons.push('document-hidden');
      if (hero.classList.contains('scene-paused')) reasons.push('scene-paused');
      if (!inViewport) reasons.push('offscreen');
      return reasons;
    }

    function paintRunningState() {
      if (layer) {
        layer.classList.toggle('workload-paused', !running);
        layer.dataset.running = String(running);
      }
      applications.forEach(({ figure }) => {
        if (figure) figure.classList.toggle('is-paused', !running);
      });
    }

    function stopTimer() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      running = false;
      paintRunningState();
    }

    function advance() {
      timer = null;
      if (pauseReasons().length) {
        stopTimer();
        return;
      }
      // Two staggered substeps per main scene; all workflows return to their
      // starting phase after the four scenes, with no skipped workflow steps.
      tick = (tick + 1) % (applications.length * 2);
      const primary = mainIndex();
      const active = applications[primary];
      active.step = (active.step + 1) % active.phases.length;
      if (tick % 2 === 1) {
        const secondary = applications[(primary + 1) % applications.length];
        secondary.step = (secondary.step + 1) % secondary.phases.length;
      }
      render();
      timer = window.setTimeout(advance, 1200);
    }

    function reconcile() {
      if (pauseReasons().length) {
        stopTimer();
        return;
      }
      running = true;
      paintRunningState();
      if (timer === null) timer = window.setTimeout(advance, 1200);
    }

    function listen(element, type, callback, options) {
      if (!element || typeof element.addEventListener !== 'function') return;
      element.addEventListener(type, callback, options);
      removers.push(() => element.removeEventListener(type, callback, options));
    }

    function checkViewport() {
      const rect = viewportTarget.getBoundingClientRect();
      inViewport = rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
      reconcile();
    }

    render();
    if ('IntersectionObserver' in window) {
      // Seed visibility now; the observer handles subsequent scroll/layout changes.
      checkViewport();
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === viewportTarget) inViewport = entry.isIntersecting;
        });
        reconcile();
      }, { threshold: 0 });
      observer.observe(viewportTarget);
    } else {
      listen(window, 'scroll', checkViewport, { passive: true });
      listen(window, 'resize', checkViewport, { passive: true });
      checkViewport();
    }
    if ('MutationObserver' in window) {
      classObserver = new MutationObserver(reconcile);
      classObserver.observe(hero, { attributes: true, attributeFilter: ['class'] });
    }
    listen(document, 'visibilitychange', reconcile);
    listen(motion, 'change', reconcile);
    listen(window, 'infra:evolved', reconcile);
    reconcile();

    const api = {
      pause() {
        manuallyPaused = true;
        reconcile();
      },
      resume() {
        if (destroyed) return;
        manuallyPaused = false;
        reconcile();
      },
      getState() {
        return {
          running,
          paused: !running,
          reasons: pauseReasons(),
          moment: definitions[mainIndex()].moment,
          activeApplication: definitions[mainIndex()].key,
          applications: applications.filter(({ figure }) => figure).map((application) => ({
            key: application.key,
            step: application.step + 1,
            phase: application.phases[application.step][0],
            label: application.phases[application.step][1]
          }))
        };
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopTimer();
        if (observer) observer.disconnect();
        if (classObserver) classObserver.disconnect();
        removers.forEach((remove) => remove());
        removers.length = 0;
        if (window.WorkloadScene === api) delete window.WorkloadScene;
      }
    };
    window.WorkloadScene = api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
