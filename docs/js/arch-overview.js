/* Section 02: the paper's Figure 1 as one continuous animation of Evolving Infra serving two requests.
   Branch counts follow the KV directory rules of the paper (Section 4.3):
   - Request 1 is the next step of agent A. Its prefill node pulls A's reusable KV from shared host
     memory; reused blocks keep their counts, since A is already counted on them. The decode node that
     receives the request writes the new KV, which only A references (count 1).
   - Request 2 is the first request of a fork of A. It reuses the same KV, now on the prefill node, so
     each reused block gains one branch (+1). Its decode node writes the fork's new KV (count 1).
   - The agent mix turns decode-heavy and one node switches from prefill to decode without a restart
     (6.2 s, the paper's measured average). A branch finishes and releases its counts; when memory is
     full, the KV that no active branch references is evicted first.
   The final frame is the paper figure. Timing is for presentation only. */
(() => {
  'use strict';

  function init() {
    const fig = document.querySelector('#architecture .arch-overview');
    if (!fig) return;
    const part = (name) => fig.querySelector(`[data-ov="${name}"]`);
    const svg = part('svg');
    const el = {
      request: part('request'), router: part('router'), portP: part('port-p'), portD: part('port-d'), mix: part('mix'),
      n2: part('n2'), n3: part('n3'), n5: part('n5'), ghost: part('ghost'), slot4: part('slot4'), memory: part('memory'),
      kvA: part('kv-a'), kvB: part('kv-b'), kvM: part('kv-m'), kvN: part('kv-n'), kvZ: part('kv-z'), kvX: part('kv-x'),
    };
    const paths = {};
    fig.querySelectorAll('[data-ov-path]').forEach((p) => { paths[p.dataset.ovPath] = { el: p, len: 1 }; });
    const toks = {};
    fig.querySelectorAll('[data-ov-tok]').forEach((g) => { toks[g.dataset.ovTok] = g; });
    const tags = {};
    fig.querySelectorAll('[data-ov-tag]').forEach((tag) => { tags[tag.dataset.ovTag] = tag; });
    const mask = fig.querySelector('#ov-arc-mask');
    const playButton = fig.querySelector('[data-ov-play]');
    const replayButton = fig.querySelector('[data-ov-replay]');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    // One timeline in seconds: two requests, one fast switch, then eviction; the final frame holds.
    const FINAL = 15.4;
    const LOOP = 18.0;

    const clamp = (x) => Math.max(0, Math.min(1, x));
    const span = (t, a, b) => clamp((t - a) / (b - a));
    const ease = (x) => x * x * (3 - 2 * x);
    const within = (t, a, b) => t >= a && t < b;

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

    // Arrow and label geometry follows the layout, so it is rebuilt on resize.
    function layout() {
      el.router.style.transform = '';
      const base0 = svg.getBoundingClientRect();
      if (!base0.width || !base0.height) { ready = false; return; }
      // As in the paper figure, the router's P port sits above the prefill node that serves the requests.
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
      const mix = box(el.mix, base);
      const n2 = box(el.n2, base);
      const n5 = box(el.n5, base);
      const s3 = box(el.ghost, base);
      const s4 = box(el.slot4, base);
      const mem = box(el.memory, base);
      const a = box(el.kvA, base);
      const b = box(el.kvB, base);
      const m = box(el.kvM, base);
      const n = box(el.kvN, base);
      const x = box(el.kvX, base);
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
      // As in the paper figure, the decode node that received a request writes its new KV to the pool:
      // straight down when the new block sits under it, otherwise along the bus.
      const write = (k) => (k.cx >= n5.l + 10 && k.cx <= n5.r - 10
        ? `M${k.cx} ${n5.b + gap} V${k.t - gap}`
        : `M${n5.cx} ${n5.b + gap} V${yBus} H${k.cx} V${k.t - gap}`);
      set('write1', write(m));
      set('write', write(n));
      // The phase switch rides a dashed arc from the old slot to the decode side, below the D route.
      const dx = s4.cx - s3.cx;
      const lift = Math.max(10, Math.min(dx * 0.4, (s3.t - gap - yD - 8) / 0.75));
      arc = { x0: s3.cx, y0: s3.t - gap, x1: s3.cx + dx * 0.25, y1: s3.t - gap - lift, x2: s4.cx - dx * 0.25, y2: s4.t - gap - lift, x3: s4.cx, y3: s4.t - gap };
      const arcPath = `M${arc.x0} ${arc.y0} C${arc.x1} ${arc.y1} ${arc.x2} ${arc.y2} ${arc.x3} ${arc.y3}`;
      set('arc', arcPath);
      set('arcReveal', arcPath);
      Object.values(paths).forEach((p) => { p.len = p.el.getTotalLength() || 1; });

      // Labels appear next to what changes. The anchor says which corner of the tag sits on the point.
      const narrow = base.width < 600;
      const place = (key, px, py, anchor) => {
        const tagEl = tags[key];
        tagEl.style.left = `${px}px`;
        tagEl.style.top = `${py}px`;
        tagEl.dataset.anchor = anchor;
      };
      // Request labels start at the Request box's left edge, so they stay inside the figure.
      place('r1', rq.l, rq.b + 6, 'below-start');
      place('r2', rq.l, rq.b + 6, 'below-start');
      place('forkA', a.cx, a.t - 6, 'above');
      place('forkB', b.cx, b.t - 6, 'above');
      place('new1', m.cx, m.b + 7, 'below');
      place('new2', n.cx, n.b + 7, 'below');
      // Near the right edge, tags sit in the free end of the memory label row (one at a time).
      place('done', x.r, x.b + 7, 'below-end');
      place('evict', x.r, x.b + 7, 'below-end');
      if (narrow) {
        // Small screens: the reuse note takes the free end of the label row, the switch label goes
        // under the two slots, and the mix label sits left of the bar.
        place('reuse', x.r, x.b + 7, 'below-end');
        tags.reuse.textContent = 'reused · no change';
        place('switch', (s3.cx + s4.cx) / 2, s3.b + 5, 'below');
        place('mix', mix.l - 8, mix.cy, 'left');
      } else {
        place('reuse', (a.cx + b.cx) / 2, a.b + 7, 'below');
        tags.reuse.textContent = 'reused KV · counts unchanged';
        place('switch', s3.cx, s3.cy, 'center');
        place('mix', mix.cx, mix.b + 6, 'below');
      }
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

    // A request goes from the Request box through the router's P port to the prefill node.
    function request(key, s) {
      if (s < 0.45) token(key, 'req', s / 0.45);
      else token(key, 'p', (s - 0.45) / 0.55);
    }

    function setText(element, text) {
      if (element.textContent !== text) element.textContent = text;
    }

    function tag(key, on) { tags[key].classList.toggle('is-on', on); }

    function render(t) {
      if (!ready) return;

      // Request 1, the next step of agent A: the prefill node pulls A's reusable KV (red).
      // Reused blocks keep their counts, since A is already counted on them.
      draw('req', span(t, 0, 0.5), 'ov-head-dark');
      draw('p', span(t, 0.5, 1.1), 'ov-head-dark');
      request('req', span(t, 0, 1.1));
      tag('r1', within(t, 0, 2.4));
      el.kvA.classList.toggle('is-req', t >= 1.1);
      el.kvB.classList.toggle('is-req', t >= 1.1);
      const pa = ease(span(t, 1.3, 2.3));
      const pb = ease(span(t, 1.6, 2.6));
      draw('pullA', pa, 'ov-head-red');
      draw('pullB', pb, 'ov-head-red');
      token('pullA', 'pullA', pa);
      token('pullB', 'pullB', pb);
      tag('reuse', within(t, 1.6, 3.6));
      el.n2.classList.toggle('is-busy', within(t, 2.5, 3.2) || within(t, 6.9, 7.5));
      // The router sends it to a decode node, which writes the new KV: only A references it (count 1).
      const d1 = span(t, 3.1, 3.7);
      draw('d', d1, 'ov-head-dark');
      token('d', 'd', d1);
      el.n5.classList.toggle('is-busy', within(t, 3.7, 4.6) || within(t, 7.9, 8.8));
      const w1 = ease(span(t, 4.3, 5.1));
      draw('write1', w1, 'ov-head-red');
      const fade1 = 1 - span(t, 7.9, 8.3);
      paths.write1.el.style.opacity = String(w1 > 0 ? fade1 : 0);
      if (fade1 <= 0) paths.write1.el.removeAttribute('marker-end');
      el.kvM.classList.toggle('is-new', t < 5.1);
      el.kvM.classList.toggle('is-req', within(t, 5.1, 6.0));
      tag('new1', within(t, 5.1, 6.3));

      // Request 2, the first request of a fork of A: it reuses the same KV, now on the prefill node,
      // so each reused block gains one branch. Its decode node writes the fork's new KV (count 1).
      request('req2', span(t, 5.6, 6.7));
      tag('r2', within(t, 5.6, 7.6));
      const forked = t >= 6.7;
      setText(el.kvA, forked ? '3' : '2');
      setText(el.kvB, forked ? '2' : '1');
      tag('forkA', within(t, 6.7, 8.0));
      tag('forkB', within(t, 6.7, 8.0));
      token('d2', 'd', span(t, 7.4, 7.9));
      const w2 = ease(span(t, 8.4, 9.2));
      draw('write', w2, 'ov-head-red');
      if (t < 6) token('write', 'write1', w1);
      else token('write', 'write', w2);
      el.kvN.classList.toggle('is-new', t < 9.2);
      tag('new2', within(t, 9.2, 10.3));

      // The agent mix turns decode-heavy, and one node switches from prefill to decode within seconds.
      el.mix.style.setProperty('--mix', String(ease(span(t, 9.6, 10.4))));
      tag('mix', within(t, 9.8, 11.8));
      const s = ease(span(t, 10.4, 11.2));
      el.n3.style.transform = s > 0 ? `translate(${bezier(s, 'x') - arc.x0}px, ${bezier(s, 'y') - arc.y0}px)` : '';
      el.n3.style.setProperty('--sw', String(s));
      el.ghost.style.opacity = String(clamp(s * 2.5));
      draw('arcReveal', s);
      paths.arc.el.style.opacity = s > 0 ? '1' : '0';
      if (s >= 0.985) paths.arc.el.setAttribute('marker-end', 'url(#ov-head-red)');
      else paths.arc.el.removeAttribute('marker-end');
      tag('switch', within(t, 10.4, 11.8));
      el.n3.classList.toggle('is-switched', t >= 11.2);
      el.n3.classList.toggle('is-busy', within(t, 11.5, 12.5));

      // A branch finishes and releases all its counts; when memory is full, KV at 0 is evicted first.
      const done = t >= 12.8;
      el.kvZ.classList.toggle('is-zero', done);
      setText(el.kvZ, done ? '0' : '1');
      el.kvX.classList.toggle('is-zero', done);
      setText(el.kvX, done ? '0' : '1');
      tag('done', within(t, 12.8, 13.8));
      el.memory.classList.toggle('is-full', within(t, 13.8, 15.2));
      tag('evict', within(t, 13.8, 15.4));
      el.kvX.classList.toggle('is-evicted', t >= 14.4);
    }

    // Jumps (replay, the loop) skip CSS transitions so nothing animates backwards.
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
