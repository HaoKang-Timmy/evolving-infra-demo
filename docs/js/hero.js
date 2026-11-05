/* The opening illustration becomes the backdrop for the project and demo. */
(() => {
  'use strict';

  function init() {
    const hero = document.getElementById('hero');
    if (!hero) return;
    if (window.InfraHero && typeof window.InfraHero.destroy === 'function') {
      window.InfraHero.destroy();
    }

    const before = document.getElementById('hero-before');
    const after = document.getElementById('hero-after');
    const content = document.getElementById('site-content');
    const trigger = document.getElementById('evolve-trigger');
    const replay = document.getElementById('replay-intro');
    const title = document.getElementById('revealed-title');
    const video = document.getElementById('demo-video');
    const announcement = document.getElementById('hero-announcement');
    const scene = hero.querySelector('.scene-world');
    const motion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const listeners = [];
    let mode = hero.dataset.mode === 'evolving' ? 'evolving' : 'rigid';
    let destroyed = false;
    let hashFrame = 0;
    let hashTarget = null;
    let sceneObserver = null;
    let sceneInView = true;

    if (title) title.setAttribute('tabindex', '-1');
    if (announcement) {
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      if (!announcement.hasAttribute('role')) announcement.setAttribute('role', 'status');
    }

    function listen(element, type, handler, options) {
      if (!element || typeof element.addEventListener !== 'function') return;
      element.addEventListener(type, handler, options);
      listeners.push(() => element.removeEventListener(type, handler, options));
    }

    function updateScenePause() {
      if (destroyed) return;
      hero.classList.toggle('scene-paused', document.hidden || !sceneInView || !!(motion && motion.matches));
    }

    if ('IntersectionObserver' in window) {
      sceneObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === hero) sceneInView = entry.isIntersecting;
        });
        updateScenePause();
      }, { threshold: 0 });
      sceneObserver.observe(hero);
    }
    listen(document, 'visibilitychange', updateScenePause);
    listen(motion, 'change', updateScenePause);
    updateScenePause();

    function cancelHashScroll() {
      hashTarget = null;
      if (hashFrame) window.cancelAnimationFrame(hashFrame);
      hashFrame = 0;
    }

    function focusWithoutScrolling(element) {
      if (!element || !element.isConnected || typeof element.focus !== 'function') return;
      if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '-1');
      }
      element.focus({ preventScroll: true });
    }

    function setMode(nextMode, options = {}) {
      if (destroyed || (nextMode !== 'rigid' && nextMode !== 'evolving')) return mode;
      if (!options.initialHash) cancelHashScroll();
      const evolving = nextMode === 'evolving';
      const active = document.activeElement;
      const hidingFocus = !!(active && (evolving
        ? before && before.contains(active)
        : (after && after.contains(active)) || (content && content.contains(active))));

      if (!evolving) {
        if (video && typeof video.pause === 'function') video.pause();
        if (options.scroll !== false) {
          window.scrollTo({ top: 0, left: 0, behavior: motion && motion.matches ? 'instant' : 'smooth' });
        }
      }

      // Keep state synchronous; CSS owns the illustration transition.
      mode = nextMode;
      hero.dataset.mode = mode;
      if (scene) {
        if (evolving) scene.setAttribute('aria-hidden', 'true');
        else scene.removeAttribute('aria-hidden');
      }
      if (before) before.hidden = evolving;
      if (after) after.hidden = !evolving;
      if (content) content.hidden = !evolving;
      if (document.body) document.body.classList.toggle('intro-active', !evolving);
      hero.setAttribute('aria-label', evolving
        ? 'Evolving Infra: infrastructure that moves with your agents'
        : 'Dynamic agents and limited infrastructure flexibility');
      hero.removeAttribute('aria-labelledby');

      if (options.announce !== false && announcement) {
        announcement.textContent = evolving
          ? 'Evolving Infra. The project, demo, and results are now available.'
          : 'Opening illustration restored. Activate Let it evolve to continue.';
      }
      if (options.focus !== false || hidingFocus) {
        focusWithoutScrolling(evolving ? title || after || hero : trigger || before || hero);
      }
      window.dispatchEvent(new CustomEvent('infra:evolved', { detail: { mode } }));
      return mode;
    }

    function enter(event) {
      if (event) event.preventDefault();
      setMode('evolving');
      const link = event && event.currentTarget;
      if (link && link.matches('a[data-enter]')) {
        const target = document.getElementById((link.getAttribute('href') || '').slice(1));
        if (target) window.requestAnimationFrame(() => {
          target.scrollIntoView({ block: 'start', behavior: motion && motion.matches ? 'instant' : 'smooth' });
        });
      }
    }

    function replayIntro(event) {
      if (event) event.preventDefault();
      setMode('rigid');
    }

    listen(trigger, 'click', enter);
    listen(replay, 'click', replayIntro);
    document.querySelectorAll('a[data-enter]').forEach((link) => listen(link, 'click', enter));

    const api = {
      setMode,
      getMode: () => mode,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelHashScroll();
        if (sceneObserver) sceneObserver.disconnect();
        hero.classList.add('scene-paused');
        listeners.forEach((remove) => remove());
        listeners.length = 0;
        if (window.InfraHero === api) delete window.InfraHero;
      }
    };
    window.InfraHero = api;

    let initialId = window.location.hash.slice(1);
    try { initialId = decodeURIComponent(initialId); } catch (_) { /* Keep an undecodable hash literal. */ }
    const initialTarget = initialId && initialId !== 'hero'
      ? document.getElementById(initialId)
      : null;
    if (initialTarget) {
      hashTarget = initialTarget;
      setMode('evolving', { focus: false, announce: false, scroll: false, initialHash: true });
      const scrollInitialTarget = () => {
        if (destroyed || !hashTarget || mode !== 'evolving') return;
        hashFrame = window.requestAnimationFrame(() => {
          hashFrame = window.requestAnimationFrame(() => {
            hashFrame = 0;
            if (destroyed || !hashTarget || !hashTarget.isConnected || mode !== 'evolving') return;
            const target = hashTarget;
            hashTarget = null;
            target.scrollIntoView({ block: 'start', behavior: 'instant' });
          });
        });
      };
      if (document.readyState === 'complete') scrollInitialTarget();
      else listen(window, 'load', scrollInitialTarget, { once: true });
    } else {
      setMode(mode, { focus: false, announce: false, scroll: false });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
