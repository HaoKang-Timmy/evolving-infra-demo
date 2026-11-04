# Evolving Infra demo

Evolving Infra is a serving system that adapts to agent workload at runtime. This repository holds its
project page, the demo video, and the code that renders the video.

- Project page: https://weilixu.com/evolving-infra-demo/ (source in `docs/`, served by GitHub Pages)
- Demo video: [`video/evolving-infra-vs-dynamo-cc126.mp4`](video/evolving-infra-vs-dynamo-cc126.mp4).
  Dynamo and Evolving Infra each serve 126 concurrent Claude Code agents with GLM-5.2 on 36 GB300 GPUs.
  The video shows one hour of each run at 60× speed.

## Layout

| Path | Content |
| --- | --- |
| `docs/` | The project page: one static `index.html` (HTML, CSS and JavaScript; Google Fonts and KaTeX load from CDNs), SVG figures in `fig/`, the video and its poster in `media/`. No build step. |
| `video/` | The video, `render.py` (renders it), `data.json` (its input), `extract.py` (built `data.json` from the benchmark logs), and the icon font. |
| `web/figbuild/` | TikZ wrappers of the architecture and KV-directory figures in `docs/fig/`. They compile against the paper's LaTeX sources, which are not included. |

## View the page locally

```
python3 -m http.server -d docs 8000    # then open http://localhost:8000
```

## Render the video

Tested with Python 3.12, matplotlib 3.11.2, numpy 2.5.4 and imageio-ffmpeg 0.8.1 (which ships an ffmpeg binary).

```
cd video
python3 -m venv .venv && . .venv/bin/activate
pip install matplotlib numpy imageio-ffmpeg
python render.py data.json out --preview      # a few PNG frames, in seconds
python render.py data.json out --ffmpeg "$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
```

The full render writes `out/evolving-infra-vs-dynamo-cc126.mp4` (1920×1080, 30 fps, H.264) in about 8 minutes on
8 CPU cores. The renderer checks that its live counters end at the summary values in `data.json`.

`data.json` has one entry per system (`dyn`, `ours`):

- `requests`: one row per LLM call, `[slot, t_start, t_first_token, t_end, status, prompt_tokens, cached_tokens,
  completion_tokens]`. Times are seconds after the benchmark start, measured at the client; status 1 = completed,
  0 = failed, 2 = warmup.
- `tasks`: one row per agent session, `[slot, t_start, t_end, ok]`.
- `check`: summary values of the scored window, used to verify the rendered counters.
- `roles` (Evolving Infra only): the prefill/decode role of each of the 9 nodes over time.

The video covers minutes 30 to 90 of each run, after a 30-minute warmup, and labels them 00:00 to 60:00. The
Dynamo node timeline (drain, restart and new role of each switch) is written in `render.py` from the Dynamo planner
log. Revenue and user cost use the GLM-5.2 list price: $1.40 per 1M input tokens ($0.26 if cached) and $4.40 per
1M output tokens.

## Credits

Window icons: [Material Icons](https://github.com/google/material-design-icons), Apache License 2.0
(`video/font-icons/LICENSE`).
