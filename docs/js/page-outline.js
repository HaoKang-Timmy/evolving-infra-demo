/* Outline of the reading view: shown beside the idea sections, it marks the section that is being read. */
(() => {
  'use strict';

  function init() {
    const nav = document.querySelector('.page-outline');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const targets = links.map((link) => document.getElementById(link.getAttribute('href').slice(1)));
    const ideas = Array.from(document.querySelectorAll('.idea-section'));
    let queued = false;

    function update() {
      queued = false;
      const line = window.innerHeight * 0.35;
      const first = ideas.length ? ideas[0].getBoundingClientRect() : null;
      const last = ideas.length ? ideas[ideas.length - 1].getBoundingClientRect() : null;
      // Hidden content has an empty box, so the outline stays hidden until the reading view opens.
      nav.classList.toggle('is-shown', !!(first && last && first.height > 0
        && first.top < window.innerHeight * 0.55 && last.bottom > line));
      let current = -1;
      targets.forEach((target, i) => {
        if (target && target.getBoundingClientRect().top <= line) current = i;
      });
      links.forEach((link, i) => {
        if (i === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }

    function queue() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
