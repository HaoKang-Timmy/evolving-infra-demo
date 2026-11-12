/* Section 02: the paper's Figure 1, built up in three beats that follow the three points above it
   (03 decoupled infrastructure, 04 compute allocation, 05 KV cache management).
   The final frame is the paper figure. Timing is for presentation only, not a measurement. */
(() => {
  'use strict';

  function init() {
    const fig = document.querySelector('#architecture .arch-overview');
    if (!fig) return;
    const part = (name) => fig.querySelector(`[data-ov="${name}"]`);
    const svg = part('svg');
    const el = {
      request: part('request'), router: part('router'), portP: part('port-p'), portD: part('port-d'),
      n2: part('n2'), n3: part('n3'), n5: part('n5'), ghost: part('ghost'), slot4: part('slot4'),
      memory: part('memory'), kvA: part('kv-a'), kvB: part('kv-b'), kvN: part('kv-n'), kvZ: part('kv-z'), kvX: part('kv-x'),
    };
    const paths = {};
    fig.querySelectorAll('[data-ov-path]').forEach((p) => { paths[p.dataset.ovPath] = { el: p, len: 1 }; });
    const toks = {};
    fig.querySelectorAll('[data-ov-tok]').forEach((g) => { toks[g.dataset.ovTok] = g; });
    const mask = fig.querySelector('#ov-arc-mask');
    const caption = fig.querySelector('[data-ov-caption]');
    const playButton = fig.querySelector('[data-ov-play]');
    const replayButton = fig.querySelector('[data-ov-replay]');
    const steps = Array.from(fig.querySelectorAll('[data-ov-step]'));
    const points = Array.from(document.querySelectorAll('#architecture .arch-points > li'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Beats start at 0 s (03), 6 s (04) and 11.5 s (05); the full figure holds from FINAL until the loop restarts.
    const STEP_AT = [0, 6, 11.5];
    const STEP_END = [5.9, 11.4, 16.2];
    const FINAL = 16.2;
    const LOOP = 18.5;
    const CAPTIONS = [
      [0, 'A request arrives. The router sends its prefill to a prefill node.'],
      [1.2, 'While the request waits, the node pulls its reusable KV from shared host memory.'],
      [3.2, 'After prefill, the router sends the request to a decode node.'],
      [6, 'The agent mix turns decode-heavy. The planner moves one node from prefill to decode, without a restart.'],
      [9, 'The switched node decodes and writes its KV to shared host memory, readable by all nodes.'],
      [11.5, 'Agents compact their contexts and sub-agents finish, so the branch counts of their KV drop.'],
      [13.4, 'When memory is full, KV that no active branch references is evicted first.'],
      [FINAL, 'Compute and KV cache adapt to agent workloads, online.'],
    ];

    const clamp = (x) => Math.max(0, Math.min(1, x));
    const span = (t, a, b) => clamp((t - a) / (b - a));
    const ease = (x) => x * x * (3 - 2 * x);

    let time = 0;
    let playing = !reduced.matches;
    let visible = false;
    let last = null;
    let arc = null;
    let ready = false;

    function box(element, base) {
      const r = element.getBoundingClientRect();
      const l = r.left - base.left;
      const t = r.top - base.top;
      return { l, t, r: l + r.width, b: t + r.height, w: r.width, h: r.height, cx: l + r.width / 2, cy: t + r.height / 2 };
    }

    // Arrow geometry follows the layout, so it is rebuilt on resize.
    function layout() {
      el.router.style.transform = '';
      const base0 = svg.getBoundingClientRect();
      if (!base0.width || !base0.height) { ready = false; return; }
      // As in the paper figure, the router's P port sits above the prefill node that serves the request.
      const pp0 = box(el.portP, base0);
      const n20 = box(el.n2, base0);
      const ro0 = box(el.router, base0);
      const rq0 = box(el.request, base0);
      let shift = n20.cx - pp0.cx;
      shift = Math.min(shift, base0.width - 6 - ro0.r);
      // Never slide under the Request box; on narrow screens the P route then takes a short jog.
      shift = Math.max(shift, rq0.r + 22 - ro0.l);
      el.router.style.transform = `translateX(${shift}px)`;

      const base = svg.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
      mask.setAttribute('x', '0');
      mask.setAttribute('y', '0');
      mask.setAttribute('width', String(base.width));
      mask.setAttribute('height', String(base.height));
      const rq = box(el.request, base);
      const ro = box(el.router, base);
      const pp = box(el.portP, base);
      const pd = box(el.portD, base);
      const n2 = box(el.n2, base);
      const n5 = box(el.n5, base);
      const s3 = box(el.ghost, base);
      const s4 = box(el.slot4, base);
      const mem = box(el.memory, base);
      const a = box(el.kvA, base);
      const b = box(el.kvB, base);
      const n = box(el.kvN, base);
      const gap = 4;
      const yP = (ro.b + n2.t) / 2;
      const yD = ro.b + (n2.t - ro.b) * 0.3;
      const yBus = n2.b + (mem.t - n2.b) * 0.5;
      const set = (key, d) => paths[key].el.setAttribute('d', d);
      set('req', `M${rq.r + gap} ${rq.cy} H${ro.l - gap}`);
      set('p', `M${pp.cx} ${pp.b + gap} V${yP} H${n2.cx} V${n2.t - gap}`);
      set('d', `M${pd.cx} ${pd.b + gap} V${yD} H${n5.cx} V${n5.t - gap}`);
      set('pullA', `M${a.cx} ${a.t - gap} V${yBus} H${n2.cx} V${n2.b + gap}`);
      set('pullB', `M${b.cx} ${b.t - gap} V${yBus} H${n2.cx} V${n2.b + gap}`);
      set('write', `M${s4.cx} ${s4.b + gap} V${yBus} H${n.cx} V${n.t - gap - 5}`);
      // The phase switch rides a dashed arc from the old slot to the decode side, below the D route.
      const dx = s4.cx - s3.cx;
      const lift = Math.max(10, Math.min(dx * 0.4, (s3.t - gap - yD - 8) / 0.75));
      arc = { x0: s3.cx, y0: s3.t - gap, x1: s3.cx + dx * 0.25, y1: s3.t - gap - lift, x2: s4.cx - dx * 0.25, y2: s4.t - gap - lift, x3: s4.cx, y3: s4.t - gap };
      const arcPath = `M${arc.x0} ${arc.y0} C${arc.x1} ${arc.y1} ${arc.x2} ${arc.y2} ${arc.x3} ${arc.y3}`;
      set('arc', arcPath);
      set('arcReveal', arcPath);
      Object.values(paths).forEach((p) => { p.len = p.el.getTotalLength() || 1; });
      ready = true;
    }

    function bezier(k, axis) {
      const u = 1 - k;
      return u * u * u * arc[`${axis}0`] + 3 * u * u * k * arc[`${axis}1`] + 3 * u * k * k * arc[`${axis}2`] + k * k * k * arc[`${axis}3`];
    }

    // Draw a path up to fraction p; its arrowhead appears once the line arrives.
    function draw(key, p, head) {
      const path = paths[key];
      path.el.style.strokeDasharray = `${path.len} ${path.len}`;
      path.el.style.strokeDashoffset = String(path.len * (1 - p));
      if (key !== 'arcReveal') path.el.style.opacity = p > 0 ? '1' : '0';
      if (head) {
        if (p >= 0.985) path.el.setAttribute('marker-end', `url(#${head})`);
        else path.el.removeAttribute('marker-end');
      }
    }

    // Move a token along a path; it fades in and out at the ends.
    function token(key, pathKey, s) {
      const g = toks[key];
      if (s <= 0 || s >= 1) { g.style.opacity = '0'; return; }
      const path = paths[pathKey];
      const pt = path.el.getPointAtLength(path.len * s);
      g.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
      const edge = 0.08;
      g.style.opacity = String(s < edge ? s / edge : s > 1 - edge ? (1 - s) / edge : 1);
    }

    function setText(element, text) {
      if (element.textContent !== text) element.textContent = text;
    }

    function render(t) {
      if (!ready) return;
      const step = t < STEP_AT[1] ? 0 : t < STEP_AT[2] ? 1 : 2;
      steps.forEach((button, i) => {
        if (i === step) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      points.forEach((li, i) => li.classList.toggle('is-current', i === step));
      let text = CAPTIONS[0][1];
      CAPTIONS.forEach(([at, line]) => { if (t >= at) text = line; });
      setText(caption, text);

      // 03: a request is served from shared host memory.
      draw('req', span(t, 0, 0.5), 'ov-head-dark');
      draw('p', span(t, 0.5, 1.1), 'ov-head-dark');
      const sr = span(t, 0, 1.1);
      if (sr < 0.45) token('req', 'req', sr / 0.45);
      else token('req', 'p', (sr - 0.45) / 0.55);
      el.kvA.classList.toggle('is-req', t >= 1.2);
      el.kvB.classList.toggle('is-req', t >= 1.2);
      const pa = ease(span(t, 1.5, 2.7));
      const pb = ease(span(t, 1.9, 3.1));
      draw('pullA', pa, 'ov-head-red');
      draw('pullB', pb, 'ov-head-red');
      token('pullA', 'pullA', pa);
      token('pullB', 'pullB', pb);
      el.n2.classList.toggle('is-busy', t >= 3.1 && t < 4.3);
      const pd = span(t, 4.3, 5.0);
      draw('d', pd, 'ov-head-dark');
      token('d', 'd', pd);
      el.n5.classList.toggle('is-busy', t >= 5.0 && t < 6.0);

      // 04: the planner moves one node from prefill to decode without a restart.
      const m = ease(span(t, 6.6, 8.6));
      el.n3.style.transform = m > 0 ? `translate(${bezier(m, 'x') - arc.x0}px, ${bezier(m, 'y') - arc.y0}px)` : '';
      el.n3.style.setProperty('--sw', String(m));
      el.ghost.style.opacity = String(clamp(m * 2.5));
      draw('arcReveal', m);
      paths.arc.el.style.opacity = m > 0 ? '1' : '0';
      if (m >= 0.985) paths.arc.el.setAttribute('marker-end', 'url(#ov-head-red)');
      else paths.arc.el.removeAttribute('marker-end');
      el.n3.classList.toggle('is-switched', t >= 8.6);
      el.n3.classList.toggle('is-busy', t >= 9.2 && t < 10.8);
      const pw = ease(span(t, 9.4, 10.6));
      draw('write', pw, 'ov-head-red');
      token('write', 'write', pw);
      el.kvN.classList.toggle('is-new', t < 10.6);

      // 05: branch counts drop, and KV that no active branch references is evicted first.
      const zero = t >= 12.0;
      const zeroX = t >= 12.6;
      el.kvZ.classList.toggle('is-zero', zero);
      setText(el.kvZ, zero ? '0' : '1');
      el.kvX.classList.toggle('is-zero', zeroX);
      setText(el.kvX, zeroX ? '0' : '1');
      el.memory.classList.toggle('is-full', t >= 13.4 && t < 15.2);
      el.kvX.classList.toggle('is-evicted', t >= 14.2);
    }

    // Jumps (replay, step buttons, the loop) skip CSS transitions so nothing animates backwards.
    function jump(t) {
      time = t;
      fig.classList.add('is-jumping');
      render(time);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => fig.classList.remove('is-jumping')));
    }

    function setPlaying(value) {
      playing = value;
      last = null;
      playButton.textContent = value ? 'Pause' : 'Play';
      playButton.setAttribute('aria-pressed', String(value));
    }

    playButton.addEventListener('click', () => {
      if (!playing && time >= FINAL) jump(0);
      setPlaying(!playing);
    });
    replayButton.addEventListener('click', () => { jump(0); setPlaying(!reduced.matches); });
    steps.forEach((button, i) => button.addEventListener('click', () => {
      // With reduced motion, a step shows the result of its beat instead of playing it.
      if (reduced.matches) { setPlaying(false); jump(STEP_END[i]); return; }
      jump(STEP_AT[i]);
      setPlaying(true);
    }));

    function relayout() { layout(); jump(time); }
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(fig);
    window.addEventListener('infra:evolved', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        last = null;
        if (visible && !ready) relayout();
      }, { threshold: 0.2 }).observe(fig);
    } else {
      visible = true;
    }
    document.addEventListener('visibilitychange', () => { last = null; });

    function tick(now) {
      if (playing && visible && !document.hidden) {
        if (last !== null) {
          time += Math.min(0.1, (now - last) / 1000);
          if (time >= LOOP) jump(0);
          else render(time);
        }
        last = now;
      } else {
        last = null;
      }
      window.requestAnimationFrame(tick);
    }

    if (reduced.matches) time = FINAL;
    setPlaying(playing);
    relayout();
    window.requestAnimationFrame(tick);

    window.archOverview = {
      seek(t) { setPlaying(false); jump(Math.max(0, Math.min(LOOP - 0.01, t))); },
      play() { setPlaying(true); },
      state() { return { time, playing, ready }; },
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
