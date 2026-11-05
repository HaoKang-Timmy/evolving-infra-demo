/* A decorative copy keeps the opening landscape behind the reading view. */
(() => {
  'use strict';

  function init() {
    const body = document.body;
    const hero = document.getElementById('hero');
    if (!body || !hero) return;
    if (window.ReadingView && typeof window.ReadingView.destroy === 'function') {
      window.ReadingView.destroy();
    }

    // Clean up a stale instance without touching the live scene in the hero.
    document.querySelectorAll('#reading-backdrop, #header-affiliations').forEach((element) => element.remove());
    const scene = hero.querySelector('.scene-world');
    let backdrop = null;
    let headerAffiliations = null;
    let destroyed = false;

    if (scene) {
      const copy = scene.cloneNode(true);
      // No executable content or links belong in this purely visual layer.
      copy.querySelectorAll('script').forEach((script) => script.remove());
      copy.querySelectorAll('a').forEach((link) => link.replaceWith(...link.childNodes));
      [copy, ...copy.querySelectorAll('*')].forEach((element) => {
        element.removeAttribute('id');
        element.removeAttribute('tabindex');
        ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for'].forEach((attribute) => {
          element.removeAttribute(attribute);
        });
        Array.from(element.attributes).forEach((attribute) => {
          if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        });
      });

      backdrop = document.createElement('div');
      backdrop.id = 'reading-backdrop';
      backdrop.className = 'page-backdrop';
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.setAttribute('inert', '');
      backdrop.inert = true;
      backdrop.appendChild(copy);

      const main = Array.from(body.children).find((element) => element.tagName === 'MAIN');
      body.insertBefore(backdrop, main || null);
    }

    const header = document.querySelector('.site-header');
    const affiliations = hero.querySelector('.intro-affiliations');
    if (header && affiliations) {
      headerAffiliations = affiliations.cloneNode(true);
      headerAffiliations.className = 'header-affiliations';
      headerAffiliations.id = 'header-affiliations';
      headerAffiliations.removeAttribute('hidden');
      headerAffiliations.removeAttribute('aria-hidden');
      headerAffiliations.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      headerAffiliations.querySelectorAll('script').forEach((script) => script.remove());
      headerAffiliations.querySelectorAll('a').forEach((link) => link.replaceWith(...link.childNodes));
      [headerAffiliations, ...headerAffiliations.querySelectorAll('*')].forEach((element) => {
        Array.from(element.attributes).forEach((attribute) => {
          if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        });
      });
      const navigation = header.querySelector('#nav-links');
      header.insertBefore(headerAffiliations, navigation && navigation.parentElement === header ? navigation : null);
    }

    function sync() {
      if (destroyed) return;
      const active = hero.dataset.mode === 'evolving';
      body.classList.toggle('content-active', active);
      if (backdrop) backdrop.hidden = !active;
    }

    const api = {
      sync,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        window.removeEventListener('infra:evolved', sync);
        if (backdrop) backdrop.remove();
        backdrop = null;
        if (headerAffiliations) headerAffiliations.remove();
        headerAffiliations = null;
        body.classList.remove('content-active');
        if (window.ReadingView === api) delete window.ReadingView;
      }
    };
    window.ReadingView = api;
    window.addEventListener('infra:evolved', sync);
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
