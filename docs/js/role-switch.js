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
    const stageDurations = [2800, 3200, 2800, 3200, 3200];
    const lastStep = 4;
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
      ['Decode demand rises; N3 is selected to switch.', 'Both sides start at 3P3D. R0/R1/R2 KV blocks are on N3: in its local cache on the left, and its host memory on the right.'],
      ['Evolving Infra: R1 → N1 / R2 → N2; N3 finishes R0.', ''],
      ['N3 switches P → D. Evolving Infra keeps KV on N3.', 'N3 now serves decode at 2P4D. Its local cache is lost on the left; all three KV groups stay in N3 host memory on the right.'],
      ['Evolving Infra: N1 reads a copy from N3; the originals stay.', 'N1 serves R3, which follows R1. The baseline restores or recomputes R1’s blocks on N1; Evolving Infra reads a copy from N3 host memory.'],
      ['N1 reuses R1’s blocks and prefills R3’s new block.', 'N1 fills R3’s new block. R1’s blocks are restored in N1 local cache on the left; on the right, N1 uses a copy and N3 keeps the originals.']
    ];
    // Each row is engine state, cache state, and a panel explanation.
    const labels = {
      evolving: [
        ['N3 running', 'KV stored on N3', 'R0/R1/R2 cached KV blocks all reside in N3 host memory.'],
        ['N3 drains R0', 'KV stays on N3', 'Queued R1 goes to N1 and R2 to N2; running R0 finishes on N3.'],
        ['N3 now serves decode', 'KV stays on N3', 'N3 changes role; all three KV groups remain in its host memory.'],
        ['N3 serving decode', 'N1 reads a copy from N3', 'N1 reads R1’s blocks from N3 host memory into its GPU.'],
        ['N3 serving decode', 'N1 reuses its R1 copy', 'N1 uses its copy for R3; all three original groups remain in N3 host memory.']
      ],
      sglang: [
        ['N3 running', 'R0/R1/R2 cached on N3', 'N3’s local cache holds all three groups of cached KV blocks.'],
        ['N3 waits until idle', 'N3 local cache awaits reset', 'The caller stops new arrivals and waits until N3 is fully idle.'],
        ['N3 now serves decode', 'N3 local KV reset', 'N3 changes to decode and resets its local KV cache without a restart.'],
        ['N3 serving decode', 'Restore/recompute on N1', 'N1 restores or recomputes R1’s blocks for R3; N3’s old local groups stay lost.'],
        ['N3 serving decode', 'R1 restored on N1', 'R1’s blocks are restored on N1. N3’s original local KV groups remain lost.']
      ],
      restart: [
        ['N3 running', 'R0/R1/R2 cached on N3', 'N3’s local cache holds all three groups of cached KV blocks.'],
        ['N3 restarting', 'N3 local KV lost', 'N3 is restarting; the other nodes keep serving.'],
        ['N3 now serves decode', 'N3 local KV lost', 'N3 returns as decode with an empty local KV cache.'],
        ['N3 serving decode', 'Restore/recompute on N1', 'N1 restores or recomputes R1’s blocks for R3; N3’s old local groups stay lost.'],
        ['N3 serving decode', 'R1 restored on N1', 'R1’s blocks are restored on N1. N3’s original local KV groups remain lost.']
      ]
    };
    // These cards distinguish the cost of changing roles from the loss and
    // later restoration of the original local prefix cache.
    const costDetails = {
      evolving: [
        ['Queued requests can reroute; running R0 must finish on N3.', 'R0/R1/R2 cached KV blocks are in N3 host memory.'],
        ['R1 moves to N1; R2 moves to N2. N3 drains R0.', 'All three KV groups stay in N3 host memory.'],
        ['N3 serves decode after R0 finishes; no engine restart.', 'Changing N3’s role leaves its cached KV blocks in place.'],
        ['N1 handles R3 under the new 2P4D split.', 'R1’s blocks are copied to N1’s GPU; all three groups stay on N3.'],
        ['The role change included rerouting R1/R2 and draining R0.', 'N1 reuses its copy; N3 still retains all three source groups.']
      ],
      sglang: [
        ['N3 must be fully idle before changing role.', 'Switching will reset N3’s local cached KV blocks.'],
        ['Wait for N3 to become idle, then change its role.', 'N3’s local KV groups will be reset when the role changes.'],
        ['N3 serves decode after the idle-and-switch sequence.', 'All three original groups in N3 local cache are lost.'],
        ['N3 serves decode while N1 restores R1’s blocks for R3.', 'Restore or recompute R1’s cached KV blocks on N1.'],
        ['N3 is serving decode after the idle-and-switch sequence.', 'R1’s blocks are in N1 local cache; N3’s old groups remain lost.']
      ],
      restart: [
        ['N3 must stop serving and restart in its new role.', 'Restarting will clear N3’s local cached KV blocks.'],
        ['N3 cannot serve requests while restarting.', 'N3’s local R0/R1/R2 cached KV blocks are lost.'],
        ['N3 returns to service as decode.', 'N3 returns without its original local cached KV groups.'],
        ['N3 serves decode while N1 restores R1’s blocks for R3.', 'Restore or recompute R1’s cached KV blocks on N1.'],
        ['N3 is serving decode after the restart.', 'R1’s blocks are in N1 local cache; N3’s old groups remain lost.']
      ]
    };
    const nodeStatuses = {
      evolving: ['PREFILL', 'REROUTE + DRAIN', 'D · KV STILL ON N3', 'D · KV STILL ON N3', 'D · SOURCE KV RETAINED'],
      sglang: ['PREFILL', 'IDLE → RECONFIGURE', 'D · LOCAL KV LOST', 'D · LOCAL KV LOST', 'D · R1 BLOCKS ON N1'],
      restart: ['PREFILL', 'RESTARTING', 'D · LOCAL KV LOST', 'D · LOCAL KV LOST', 'D · R1 BLOCKS ON N1']
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
      const explanation = step === 1
        ? baseline === 'sglang'
          ? 'With SGLang, N3 must become idle first. Evolving Infra reroutes R1 to N1 and R2 to N2, while R0 finishes on N3.'
          : 'The baseline restarts N3. Evolving Infra reroutes R1 to N1 and R2 to N2, while R0 finishes on N3.'
        : stages[step][1];
      setText(copy, explanation);

      Object.entries(panels).forEach(([system, panel]) => {
        if (!panel) return;
        const path = system === 'evolving' ? 'evolving' : baseline;
        const row = labels[path][step];
        const costs = costDetails[path][step];
        const detail = detailPanels[system] || panel;
        if (system === 'baseline') {
          setText(panel.querySelector('[data-engine-family]'), baseline === 'restart'
            ? 'Engine examples: vLLM · SGLang · TRT-LLM'
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
        setText(panel.querySelector('[data-split]'), step === 1 ? 'N3 → D' : step === 0 ? '3P · 3D' : '2P · 4D');
        const phase = step === 0 ? 'P' : step === 1 ? (system === 'baseline' ? '…' : 'P') : 'D';
        setText(panel.querySelector('.switch-node[data-node="3"] .node-phase'), phase);
        setText(panel.querySelector('.switch-node[data-node="3"] [data-node-status]')
          || panel.querySelector('[data-node-status]'), nodeStatuses[path][step]);
        const targetLabel = step === 0 ? 'N3: prefill → decode'
          : step === 1 ? (system === 'baseline' ? 'N3: no new requests during the change' : 'N3: finish running request R0')
            : system === 'baseline' ? 'N3: decode · local cache lost' : 'N3: decode · host KV retained';
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
