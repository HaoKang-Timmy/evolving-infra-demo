(() => {
  'use strict';

  // Add the implementation repository and report URLs when they are public.
  const releaseLinks = { code: null, paper: null };

  const init = () => {
    const hero = document.getElementById('hero');
    const before = document.getElementById('hero-before');
    const after = document.getElementById('hero-after');
    const evolveTrigger = document.getElementById('evolve-trigger');
    const announcement = document.getElementById('hero-announcement');

    if (announcement && !announcement.hasAttribute('aria-live')) {
      announcement.setAttribute('aria-live', 'polite');
    }

    const syncHero = (announce = false) => {
      if (!hero) return;
      const evolving = hero.dataset.mode === 'evolving';
      if (before) before.hidden = evolving;
      if (after) after.hidden = !evolving;
      hero.setAttribute('aria-label', evolving
        ? 'Evolving Infra: infrastructure that moves with your agents'
        : 'Dynamic agents and limited infrastructure flexibility');
      hero.removeAttribute('aria-labelledby');
      if (evolveTrigger) {
        evolveTrigger.textContent = evolving
          ? 'Replay the transformation'
          : 'Let it evolve';
      }
      if (announce && announcement) {
        announcement.textContent = evolving
          ? 'Evolving Infra: compute allocation adapts and reusable KV stays available.'
          : 'Rigid serving shown. Activate Let it evolve to transform the cluster.';
      }
    };

    window.addEventListener('infra:evolved', () => syncHero(true));
    syncHero();

    const reveals = Array.from(document.querySelectorAll('[data-reveal]'));
    const motion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let revealObserver = null;

    const revealAll = () => {
      reveals.forEach((element) => element.classList.add('is-visible'));
      if (revealObserver) revealObserver.disconnect();
    };

    // The stylesheet only hides pending reveals after this enhancement is active.
    if (document.body) document.body.classList.add('has-js');
    if ((motion && motion.matches) || !('IntersectionObserver' in window)) {
      revealAll();
    } else {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
      reveals.forEach((element) => revealObserver.observe(element));
    }

    if (motion && typeof motion.addEventListener === 'function') {
      motion.addEventListener('change', (event) => {
        if (event.matches) revealAll();
      });
    }

    const releaseDialog = document.getElementById('release-dialog');
    const releaseTitle = document.getElementById('release-title');
    const releaseMessage = document.getElementById('release-message');
    const releaseClose = document.getElementById('release-close');
    let releaseTrigger = null;

    const closeRelease = () => {
      if (releaseDialog && releaseDialog.open && typeof releaseDialog.close === 'function') {
        releaseDialog.close();
      }
    };

    document.querySelectorAll('[data-release="code"], [data-release="paper"]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        const destination = releaseLinks[trigger.dataset.release];
        if (destination) {
          window.location.assign(destination);
          return;
        }
        if (!releaseDialog || typeof releaseDialog.showModal !== 'function') return;
        const isCode = trigger.dataset.release === 'code';
        if (releaseTitle) {
          releaseTitle.textContent = isCode
            ? 'Code release coming soon'
            : 'Technical report coming soon';
        }
        if (releaseMessage) {
          releaseMessage.textContent = isCode
            ? 'The Evolving Infra implementation will be linked here when it is released.'
            : 'The technical report is being prepared for arXiv. Its link and citation will appear here when it is available.';
        }
        releaseTrigger = trigger;
        if (!releaseDialog.open) releaseDialog.showModal();
      });
    });

    const codeNote = document.getElementById('code-release-note');
    if (codeNote && releaseLinks.code) codeNote.textContent = 'Explore the implementation on GitHub';

    if (releaseClose) releaseClose.addEventListener('click', closeRelease);
    if (releaseDialog) {
      releaseDialog.addEventListener('close', () => {
        if (releaseTrigger && releaseTrigger.isConnected && typeof releaseTrigger.focus === 'function') {
          releaseTrigger.focus({ preventScroll: true });
        }
        releaseTrigger = null;
      });
      releaseDialog.addEventListener('click', (event) => {
        if (event.target !== releaseDialog) return;
        const bounds = releaseDialog.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (outside) closeRelease();
      });
      // Native <dialog> handles Escape and emits the same close event.
    }

    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.getElementById('nav-links');
    const setMenuOpen = (open) => {
      if (navLinks) navLinks.dataset.open = String(open);
      if (menuToggle) menuToggle.setAttribute('aria-expanded', String(open));
    };

    if (menuToggle && navLinks) {
      setMenuOpen(false);
      menuToggle.addEventListener('click', () => {
        setMenuOpen(navLinks.dataset.open !== 'true');
      });
      navLinks.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => setMenuOpen(false));
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
