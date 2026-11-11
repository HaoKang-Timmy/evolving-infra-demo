// Shared player for the 1920x1080 prototypes: scales the stage, loops, play/pause (space), scrubber, ?t= to freeze.
// window.renderAt(t) draws one frame deterministically, so frames can later be captured for the real video.
(() => {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  // progress of t inside [a, b], 0 before a and 1 after b
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtClock = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const D = () => window.CC_DATA;
  // agent counts [waiting, generating, tool, idle] at window second w (0..3600), linear between 10 s samples
  const occAt = (arm, w) => {
    const o = D()[arm].occ, x = clamp(w, 0, 3600) / 10, i = Math.min(Math.floor(x), o.length - 2), k = x - i;
    return [1, 2, 3, 4].map((j) => lerp(o[i][j], o[i + 1][j], k));
  };
  // 126-character state string (W/G/T/I per agent slot) at window second w, nearest earlier 10 s sample
  const gridAt = (arm, w) => { const g = D()[arm].grid; return g[clamp(Math.floor(clamp(w, 0, 3600) / 10), 0, g.length - 1)]; };
  // cumulative completed model calls / sessions at window second w, linear between 60 s samples
  const cumAt = (arm, key, w) => {
    const c = D()[arm][key], x = clamp(w, 0, 3600) / 60, i = Math.min(Math.floor(x), c.length - 2), k = x - i;
    return lerp(c[i][1], c[i + 1][1], k);
  };

  function run(opts) {
    const stage = document.getElementById('stage');
    const dur = opts.duration, hold = opts.hold ?? 2.5;
    // ?embed=1: no control bar (for thumbnails on the index page)
    const embed = qs.has('embed');
    if (embed) document.body.classList.add('embed');
    const bar = document.createElement('div');
    bar.className = 'controls';
    bar.innerHTML = '<button type="button" data-k="play">Pause</button><input type="range" min="0" step="0.01" aria-label="Time">' +
      '<span class="time"></span><span class="name"></span><a href="index.html">All versions</a>';
    if (!embed) document.body.appendChild(bar);
    const btn = bar.querySelector('button'), range = bar.querySelector('input'), label = bar.querySelector('.time');
    bar.querySelector('.name').textContent = opts.name || document.title;
    range.max = String(dur);
    const fit = () => {
      const s = Math.min(innerWidth / 1920, (innerHeight - (embed ? 0 : 52)) / 1080);
      stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    addEventListener('resize', fit);
    fit();
    let t = qs.has('t') ? clamp(+qs.get('t') || 0, 0, dur) : 0;
    let playing = !qs.has('t'), last = null;
    const draw = () => {
      const tt = Math.min(t, dur);
      opts.render(tt);
      range.value = String(tt);
      label.textContent = `${tt.toFixed(1)} s`;
    };
    const setPlaying = (p) => { playing = p; btn.textContent = p ? 'Pause' : 'Play'; last = null; };
    btn.addEventListener('click', () => setPlaying(!playing));
    addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); } });
    range.addEventListener('input', () => { setPlaying(false); t = +range.value; draw(); });
    window.renderAt = (x) => { setPlaying(false); t = clamp(x, 0, dur); draw(); };
    const loop = (now) => {
      if (playing) {
        if (last !== null) { t += (now - last) / 1000; if (t > dur + hold) t = 0; }
        last = now;
        draw();
      }
      requestAnimationFrame(loop);
    };
    setPlaying(playing);
    if (opts.init) opts.init(stage);
    draw();
    requestAnimationFrame(loop);
  }

  window.Stage = { run, clamp, lerp, ease, seg, fmtClock, occAt, gridAt, cumAt };
})();
