# Evolving Infra demo

Evolving Infra is a serving system that adapts to agent workload at runtime. This repository holds its
project page, the demo video, and the code that renders the video.

- Project page: https://inference-rsi.com/ (source in `docs/`, served by GitHub Pages)
- Demo video: [`video/evolving-infra-vs-dynamo-cc126.mp4`](video/evolving-infra-vs-dynamo-cc126.mp4) (light) and
  [`video/evolving-infra-vs-dynamo-cc126-dark.mp4`](video/evolving-infra-vs-dynamo-cc126-dark.mp4) (dark, played by the
  page). Dynamo and Evolving Infra each serve 126 concurrent Claude Code agents with GLM-5.2 on 36 GB300
  GPUs. The video shows one hour of each run at 60× speed. Each agent window shows with an icon what its agent did for
  most of the last 30 seconds: waiting for the model, generating, or a tool call / idle. A check mark in its title bar
  counts each agent that finished in that window. The counters and charts are exact.

## Layout

| Path | Content |
| --- | --- |
| `docs/` | The static project page: `index.html`, `site.css`, and native JavaScript in `js/`. An interactive Canvas opening illustrates adaptation, followed by the dark demo, results, and technical details. SVG figures live in `fig/`; videos and posters in `media/`. Google Fonts load from a CDN. No build step. |
| `video/` | The video, `render.py` (renders it), `data.json` (its input), `extract.py` (built `data.json` from the benchmark logs), and the icon font. |
| `web/figbuild/` | TikZ wrappers of the architecture and KV-directory figures in `docs/fig/`. They compile against the paper's LaTeX sources, which are not included. |

## View the page locally

```
python3 -m http.server -d docs 8000    # then open http://localhost:8000
```

The site publishes from `main` → `docs/` on GitHub Pages at `inference-rsi.com`.
The code and report buttons show a release notice until the corresponding URLs are set in
`releaseLinks` at the top of `docs/js/site.js`. The website repository is separate from the
future implementation repository.

## Render the video

Tested with Python 3.12, matplotlib 3.11.2, numpy 2.5.4 and imageio-ffmpeg 0.8.1 (which ships an ffmpeg binary).

```
cd video
python3 -m venv .venv && . .venv/bin/activate
pip install matplotlib numpy imageio-ffmpeg
python render.py data.json out --preview                 # a few PNG frames, in seconds
FF="$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
python render.py data.json out --ffmpeg "$FF"              # light video
python render.py data.json out --theme dark --ffmpeg "$FF" # dark video
```

A full render writes `out/evolving-infra-vs-dynamo-cc126.mp4` (or `…-dark.mp4` with `--theme dark`; 1920×1080,
30 fps, H.264) in about 8 minutes on 8 CPU cores. The dark theme uses the MIT brand colors (Bright Red, Silver Gray,
Light Silver Gray, Green, Yellow, Blue) on the page's dark background. The renderer checks that its live counters end at the summary values in `data.json`.

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
