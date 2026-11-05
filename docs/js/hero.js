/* Evolving Infra: a schematic, not a replay of benchmark telemetry. */
(() => {
  'use strict';

  function init() {
    const canvas = document.getElementById('infra-canvas');
    const hero = document.getElementById('hero');
    const trigger = document.getElementById('evolve-trigger');
    if (!canvas || !hero) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (window.InfraHero && typeof window.InfraHero.destroy === 'function') window.InfraHero.destroy();

    const status = document.getElementById('infra-status');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const font = '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace';
    const agents = ['CUA', 'Math', 'Code', 'Proactive'];
    const red = '#f32e3a';
    const tau = Math.PI * 2;
    let width = 680, height = 470, layout;
    let mode = hero.dataset.mode === 'evolving' ? 'evolving' : 'rigid';
    let time = 0, began = 0, transitionDuration = 1.25;
    let frame = 0, last = null, inView = true, destroyed = false;
    let settled = false;

    const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
    const ease = v => { v = clamp(v); return v * v * (3 - 2 * v); };
    const mix = (a, b, v) => a + (b - a) * v;
    const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${clamp(a)})`;

    function box(x, y, w, h, radius = 5) {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function text(value, x, y, size = 12, color = '#a1a1aa', align = 'left', weight = 400) {
      ctx.font = `${weight} ${size}px ${font}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(value, x, y);
    }

    function line(x1, y1, x2, y2, color, lineWidth = 1) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    function curve(path, color, lineWidth = 1) {
      ctx.beginPath();
      ctx.moveTo(path[0], path[1]);
      ctx.bezierCurveTo(...path.slice(2));
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    function point(path, t) {
      const u = 1 - t;
      return {
        x: u * u * u * path[0] + 3 * u * u * t * path[2] + 3 * u * t * t * path[4] + t * t * t * path[6],
        y: u * u * u * path[1] + 3 * u * u * t * path[3] + 3 * u * t * t * path[5] + t * t * t * path[7]
      };
    }

    function progress() {
      if (mode !== 'evolving') return 0;
      if (motion.matches || transitionDuration === 0) return 1;
      return ease((time - began) / transitionDuration);
    }

    function nodeStates() {
      if (mode !== 'evolving') return Array.from({ length: 6 }, (_, i) => ({ d: i >= 3 ? 1 : 0, flash: 0 }));
      if (motion.matches) return Array.from({ length: 6 }, (_, i) => ({ d: i >= 2 ? 1 : 0, flash: 0 }));
      const elapsed = Math.max(0, time - began - transitionDuration * 0.7) + (transitionDuration === 0 ? 0.85 : 0);
      const counts = [2, 3, 4, 3];
      const phase = Math.floor(elapsed / 4.5);
      const local = elapsed % 4.5;
      const before = phase === 0 ? 3 : counts[(phase - 1) % counts.length];
      const after = counts[phase % counts.length];
      const blend = ease(local / 0.85);
      return Array.from({ length: 6 }, (_, i) => {
        const a = i >= before ? 1 : 0, b = i >= after ? 1 : 0;
        return { d: mix(a, b, blend), flash: a !== b ? Math.sin(Math.PI * clamp(local / 1.5)) : 0 };
      });
    }

    function measure() {
      if (destroyed) return;
      const bounds = canvas.getBoundingClientRect();
      const parent = canvas.parentElement;
      width = Math.max(1, bounds.width || (parent && parent.clientWidth) || 680);
      height = Math.max(1, bounds.height || (parent && parent.clientHeight) || 470);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const compact = width < 500;
      const pad = compact ? 12 : 22;
      const gap = compact ? 6 : 12;
      const agentGap = compact ? 6 : 12;
      const aw = (width - pad * 2 - agentGap * 3) / 4;
      const agentY = 30, ah = compact ? 48 : 60;
      const nw = (width - pad * 2 - gap * 5) / 6;
      const ny = height * 0.655, nh = compact ? 45 : 59;
      const cw = Math.min(width - 48, compact ? 194 : 238);
      const ch = compact ? 44 : 54, cy = height * 0.42;
      const memoryY = height * 0.86;
      layout = {
        compact, pad, gap, aw, ah, agentY, nw, ny, nh, cw, ch, cy, memoryY,
        ax: agents.map((_, i) => pad + i * (aw + agentGap) + aw / 2),
        nx: Array.from({ length: 6 }, (_, i) => pad + i * (nw + gap) + nw / 2)
      };
      layout.ingress = layout.ax.map(x => [x, agentY + ah, x, agentY + ah + 24, width / 2 + (x - width / 2) * 0.16, cy - ch / 2 - 24, width / 2 + (x - width / 2) * 0.16, cy - ch / 2]);
      layout.egress = layout.nx.map(x => [width / 2 + (x - width / 2) * 0.12, cy + ch / 2, width / 2 + (x - width / 2) * 0.12, cy + ch / 2 + 22, x, ny - 22, x, ny]);
      draw();
    }

    function icon(index, x, y, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.35;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (index === 0) {
        box(-8, -6, 16, 11, 2); ctx.stroke();
        line(0, 5, 0, 9, color, 1.35); line(-4, 9, 4, 9, color, 1.35);
        ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(8, 1); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
      } else if (index === 1) {
        ctx.beginPath(); ctx.moveTo(-7, 5); ctx.lineTo(-4, 8); ctx.lineTo(0, -7); ctx.lineTo(8, -7); ctx.stroke();
        line(3, -1, 8, 5, color, 1.35); line(8, -1, 3, 5, color, 1.35);
      } else if (index === 2) {
        ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-9, 0); ctx.lineTo(-4, 5); ctx.moveTo(4, -5); ctx.lineTo(9, 0); ctx.lineTo(4, 5); ctx.moveTo(2, -7); ctx.lineTo(-2, 7); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(2, -9); ctx.lineTo(-6, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 9); ctx.lineTo(7, -2); ctx.lineTo(1, -2); ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }

    function drawAgents() {
      const l = layout;
      text('AGENTS', l.pad, 13, 12, '#9898a1');
      text('ILLUSTRATION', width - l.pad, 13, 12, '#777780', 'right');
      agents.forEach((name, i) => {
        const x = l.ax[i] - l.aw / 2;
        const activity = motion.matches ? 0.45 : Math.pow((Math.sin(time * (1.1 + i * 0.31) + i * 1.8) + 1) / 2, 3);
        box(x, l.agentY, l.aw, l.ah, 7);
        ctx.fillStyle = '#141416'; ctx.fill();
        ctx.strokeStyle = rgba(243, 46, 58, 0.18 + activity * 0.28); ctx.lineWidth = 1; ctx.stroke();
        const iy = l.agentY + (l.compact ? 15 : 20);
        icon(i, l.ax[i], iy, i === 3 ? '#e9e9ed' : '#c2c2c9');
        text(name, l.ax[i], l.agentY + l.ah - 11, 12, '#ddddE3', 'center', 500);
        line(x + 9, l.agentY + l.ah, x + 9 + (l.aw - 18) * (0.22 + activity * 0.62), l.agentY + l.ah, rgba(243, 46, 58, 0.6), 1.5);
      });
    }

    function drawRequests(p, states) {
      const l = layout;
      const pathColor = rgba(173, 173, 188, 0.14 + p * 0.03);
      l.ingress.forEach(path => curve(path, pathColor));
      l.egress.forEach((path, i) => curve(path, p > 0 ? rgba(243, 46, 58, 0.12 + p * 0.14) : rgba(173, 173, 188, i < 3 ? 0.23 : 0.12)));
      const count = 18;
      for (let i = 0; i < count; i++) {
        const agent = i % 4;
        const duration = mix(5.5, 3.0, p) + (i % 3) * 0.33;
        const raw = motion.matches ? (i * 0.137 + 0.2) % 1 : (time / duration + i * 0.137) % 1;
        let travel = raw;
        // In the rigid state, a brief queue forms before the fixed dispatcher.
        if (p < 1) {
          const queued = raw < 0.32 ? raw / 0.32 * 0.45 : raw < 0.62 ? 0.45 : 0.5 + (raw - 0.62) / 0.38 * 0.5;
          travel = mix(queued, raw, p);
        }
        const kind = i % 3 === 0 ? 'D' : 'P';
        const candidates = states.map((s, n) => ({ n, role: s.d >= 0.5 ? 'D' : 'P' })).filter(s => s.role === kind);
        const fixed = kind === 'P' ? [0, 1, 2, 0][agent] : 3 + agent % 3;
        const cycle = Math.floor(time / duration + i * 0.137);
        const target = p < 0.65 ? fixed : candidates[(i + cycle) % candidates.length].n;
        const path = travel < 0.5 ? l.ingress[agent] : l.egress[target];
        const position = travel < 0.5 ? travel * 2 : (travel - 0.5) * 2;
        const at = point(path, clamp(position));
        const tail = point(path, clamp(position - 0.045));
        const opacity = 0.4 + 0.45 * Math.sin(Math.PI * clamp(position));
        line(tail.x, tail.y, at.x, at.y, rgba(243, 46, 58, opacity * 0.55), 1.4);
        ctx.beginPath(); ctx.arc(at.x, at.y, l.compact ? 1.65 : 2, 0, tau);
        ctx.fillStyle = rgba(255, 76, 86, opacity);
        ctx.shadowColor = red; ctx.shadowBlur = 5; ctx.fill(); ctx.shadowBlur = 0;
      }
    }

    function drawCore(p) {
      const l = layout, x = (width - l.cw) / 2, y = l.cy - l.ch / 2;
      if (p > 0) {
        const glow = ctx.createRadialGradient(width / 2, l.cy, 8, width / 2, l.cy, l.cw * 0.65);
        glow.addColorStop(0, rgba(243, 46, 58, p * 0.11)); glow.addColorStop(1, 'rgba(243,46,58,0)');
        ctx.fillStyle = glow; ctx.fillRect(x - 60, y - 55, l.cw + 120, l.ch + 110);
        box(x - 4 * p, y - 4 * p, l.cw + 8 * p, l.ch + 8 * p, 11);
        ctx.strokeStyle = rgba(243, 46, 58, p * 0.13); ctx.lineWidth = 1; ctx.stroke();
      }
      box(x, y, l.cw, l.ch, 8);
      ctx.fillStyle = '#161619'; ctx.fill();
      ctx.strokeStyle = p ? rgba(243, 46, 58, 0.2 + p * 0.6) : '#44444b';
      ctx.lineWidth = 1; ctx.setLineDash(p > 0.4 ? [] : [4, 4]); ctx.stroke(); ctx.setLineDash([]);
      const markX = x + (l.compact ? 18 : 23), markY = l.cy - 8;
      for (let i = 0; i < 9; i++) {
        const rearrange = p * (i === 2 || i === 6 ? Math.sin(motion.matches ? 0 : time * 0.8) * 1.5 : 0);
        box(markX + (i % 3) * 6 + rearrange, markY + Math.floor(i / 3) * 6, 4, 4, 1);
        ctx.fillStyle = p ? rgba(243, 46, 58, i === 4 ? 1 : 0.45 + p * 0.45) : '#6b6b75'; ctx.fill();
      }
      const tx = markX + 29;
      if (p < 1) text('FIXED ALLOCATION', tx, l.cy, 12, rgba(170, 170, 180, 1 - p), 'left', 500);
      if (p > 0) text('EVOLVING INFRA', tx, l.cy, l.compact ? 12 : 13, rgba(255, 230, 233, p), 'left', 600);
    }

    function drawNodes(p, states) {
      const l = layout;
      l.nx.forEach((cx, i) => {
        const s = states[i], x = cx - l.nw / 2, y = l.ny, h = l.nh;
        box(x + 1, y + 6, l.nw - 2, h - 1, 5); ctx.fillStyle = '#0b0b0d'; ctx.fill();
        ctx.strokeStyle = '#34343a'; ctx.lineWidth = 1; ctx.stroke();
        if (s.flash > 0) {
          box(x - 3, y - 3, l.nw + 6, h + 5, 8);
          ctx.strokeStyle = rgba(243, 46, 58, s.flash * p * 0.6); ctx.stroke();
        }
        box(x, y, l.nw, h - 3, 5);
        const shade = Math.round(mix(36, 177, s.d));
        ctx.fillStyle = `rgb(${shade},${shade},${Math.min(255, shade + 4)})`; ctx.fill();
        ctx.strokeStyle = s.flash > 0 ? rgba(243, 46, 58, 0.3 + s.flash * 0.6) : rgba(195, 195, 204, 0.35);
        ctx.lineWidth = 1; ctx.stroke();
        const ink = s.d > 0.5 ? '#202025' : '#eeeeF3';
        const chipY = y + (l.compact ? 14 : 21);
        box(cx - 10, chipY - 9, 20, 18, 3);
        ctx.strokeStyle = s.d > 0.5 ? '#7a7a83' : '#62626e'; ctx.stroke();
        text(s.d >= 0.5 ? 'D' : 'P', cx, chipY, 12, ink, 'center', 600);
        text('GPU', cx, y + h - 13, 12, ink, 'center');
        line(x + 6, y + 3, x + l.nw - 6, y + 3, rgba(255, 255, 255, 0.12));
        const led = p ? 0.65 + Math.sin(time * 1.6 + i * 1.7) * 0.2 : i < 2 ? 0.5 : 0.18;
        line(cx - 4, y + h + 2, cx + 4, y + h + 2, rgba(243, 46, 58, led), 1.5);
      });
    }

    function drawMemory(p) {
      const l = layout, my = l.memoryY, mh = 22;
      l.nx.forEach(cx => line(cx, l.ny + l.nh + 5, cx, my, rgba(177, 177, 190, 0.14 + p * 0.14)));
      if (p > 0) {
        box(l.pad, my, width - l.pad * 2, mh, 5);
        ctx.fillStyle = rgba(243, 46, 58, p * 0.035); ctx.fill();
        ctx.strokeStyle = rgba(243, 46, 58, p * 0.45); ctx.lineWidth = 1; ctx.stroke();
      }
      l.nx.forEach((cx, i) => {
        if (p < 1) {
          box(cx - l.nw / 2, my, l.nw, mh, 4);
          ctx.strokeStyle = rgba(150, 150, 162, (1 - p) * 0.32); ctx.lineWidth = 1; ctx.stroke();
        }
        // The exact same KV blocks stay in the exact same places through the transition.
        // Only the local boundaries disappear into one shared pool.
        for (let k = 0; k < 3; k++) {
          const bw = l.compact ? 6 : 8, gap = 3;
          const bx = cx - (3 * bw + 2 * gap) / 2 + k * (bw + gap);
          box(bx, my + 7, bw, 8, 1.5);
          ctx.fillStyle = (i + k) % 4 === 0 ? rgba(243, 46, 58, 0.75) : '#74747f'; ctx.fill();
        }
      });
      text(p > 0.65 ? 'SHARED KV · ADAPTIVE ROLES' : 'LOCAL KV · FIXED ROLES', width / 2, Math.min(height - 8, my + mh + 17), 12, p > 0.65 ? '#bdbdc6' : '#888892', 'center');
    }

    function updateAccessibleState() {
      const evolved = mode === 'evolving';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', evolved
        ? 'Illustration: diverse agents use Evolving Infra. The same six GPU workers change prefill and decode roles while their KV blocks remain available in a shared pool.'
        : 'Illustration: computer-use, math, coding and proactive agents send changing requests to six GPU workers with fixed prefill and decode roles and separate local KV caches.');
      if (trigger) trigger.setAttribute('aria-pressed', String(evolved));
      if (status) status.textContent = evolved
        ? 'Same hardware. Adaptive roles. KV stays available.'
        : 'Agent demand changes. Worker roles and local KV stay coupled.';
    }

    function draw() {
      if (!layout || destroyed) return;
      ctx.clearRect(0, 0, width, height);
      const p = progress(), states = nodeStates();
      ctx.lineCap = 'round';
      drawRequests(p, states);
      drawMemory(p);
      drawNodes(p, states);
      drawCore(p);
      drawAgents();
      if (mode === 'evolving' && p >= 1 && !settled) {
        settled = true;
        if (status) status.textContent = 'Same hardware. Adaptive roles. KV stays available.';
      }
    }

    function canAnimate() {
      return !destroyed && !motion.matches && inView && !document.hidden && canvas.isConnected;
    }

    function tick(now) {
      frame = 0;
      if (!canAnimate()) { last = null; return; }
      if (last !== null) time += Math.min((now - last) / 1000, 0.05);
      last = now;
      draw();
      frame = requestAnimationFrame(tick);
    }

    function schedule() {
      if (!canAnimate()) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0; last = null;
        return;
      }
      if (!frame) { last = null; frame = requestAnimationFrame(tick); }
    }

    function setMode(value, options = {}) {
      if (value !== 'rigid' && value !== 'evolving') return false;
      if (destroyed) return false;
      mode = value;
      began = time;
      transitionDuration = options.animate === false ? 0 : 1.25;
      settled = false;
      hero.dataset.mode = value;
      updateAccessibleState();
      if (status && value === 'evolving' && !motion.matches && transitionDuration > 0) status.textContent = 'Reconfiguring the same workers. Keeping their KV available.';
      draw();
      schedule();
      if (value === 'evolving') window.dispatchEvent(new CustomEvent('infra:evolved', { detail: { mode: value, replay: Boolean(options.replay) } }));
      return true;
    }

    const onClick = () => setMode('evolving', { replay: mode === 'evolving' });
    const onVisibility = () => { if (!document.hidden) draw(); schedule(); };
    const onMotion = () => { draw(); schedule(); };
    const onResize = () => measure();
    if (trigger) trigger.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize, { passive: true });
    if (motion.addEventListener) motion.addEventListener('change', onMotion);
    else motion.addListener(onMotion);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (resizeObserver) resizeObserver.observe(canvas);
    const intersectionObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      schedule();
    }, { threshold: 0.01 }) : null;
    if (intersectionObserver) intersectionObserver.observe(canvas);

    const api = {
      setMode,
      getMode: () => mode,
      redraw: measure,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (frame) cancelAnimationFrame(frame);
        if (trigger) trigger.removeEventListener('click', onClick);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', onResize);
        if (motion.removeEventListener) motion.removeEventListener('change', onMotion);
        else motion.removeListener(onMotion);
        if (resizeObserver) resizeObserver.disconnect();
        if (intersectionObserver) intersectionObserver.disconnect();
        if (window.InfraHero === api) delete window.InfraHero;
      }
    };
    window.InfraHero = api;
    hero.dataset.mode = mode;
    updateAccessibleState();
    measure();
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
