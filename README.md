# Evolving Infra demo

Evolving Infra is an agent-adaptive LLM serving framework that adapts compute allocation to agent workloads and KV cache management to agent context management at runtime. This repository holds its
project page, the demo video, and the code that renders the video.

- Project page: https://inference-rsi.com/ (source in `docs/`, served by GitHub Pages)
- Demo video: [`docs/media/merge_demo.mp4`](docs/media/merge_demo.mp4), played by the page.
  The merged demo compares Dynamo and Evolving Infra on OSWorld computer-use tasks and concurrent Claude Code agents.
  Its poster is extracted from the opening title. Evolving Infra is drawn in the page red (`#c92336`). In the coding
  part, a Dynamo node that restarts is shown in amber, so red marks only Evolving Infra, and the icon legend sits above
  the area that player controls cover. In the OSWorld part, no status pill is shown during the race, so the pace of the
  actions on the two screens shows the difference; a FINISHED pill marks the end of each agent.
- Original coding replay: [`docs/media/evolving-infra-vs-dynamo-cc126.mp4`](docs/media/evolving-infra-vs-dynamo-cc126.mp4) (light) and
  [`docs/media/evolving-infra-vs-dynamo-cc126-dark.mp4`](docs/media/evolving-infra-vs-dynamo-cc126-dark.mp4) (dark).
  Dynamo and Evolving Infra each serve 126 concurrent Claude Code agents with GLM-5.2 on 36 GB300
  GPUs. The video shows one hour of each run at 60× speed. Each agent window shows with an icon what its agent did for
  most of the last 30 seconds: waiting for the model, generating, or a tool call / idle. A check mark in its title bar
  counts each agent that finished in that window. The counters and charts are exact.

## Layout

| Path | Content |
| --- | --- |
| `docs/` | The static project page: `index.html`, base styles in `site.css` and `scene.css`, the default light palette in `light.css`, motion styling in `workload.css`, and native JavaScript in `js/`. An illustrated opening places changing agent applications above fixed hardware; activating it turns the scene into the background for the project and demo. Results and technical details follow. SVG figures live in `fig/`; videos, posters, and scene artwork in `media/`. Google Fonts load from a CDN. No build step. |
| `video/` | `render.py` (renders the original coding replay), `data.json` (its input), `extract.py` (built `data.json` from the benchmark logs), and the icon font. Published videos live in `docs/media/`. |
| `web/figbuild/` | TikZ wrappers of the architecture and KV-directory figures in `docs/fig/`. They compile against the paper's LaTeX sources, which are not included. |

## View the page locally

```
python3 -m http.server -d docs 8000    # then open http://localhost:8000
```

The site publishes from `main` → `docs/` on GitHub Pages at `inference-rsi.com`.
The header links open the implementation repository,
[mit-han-lab/EvolvingInfra](https://github.com/mit-han-lab/EvolvingInfra), and the technical report,
[arXiv:2611.12304](https://arxiv.org/abs/2611.12304), in a new tab; the research section links the same report. The "Try it!!"
button also links to the implementation repository, which is open source.
The website repository is separate from the implementation repository.

After the opening, `js/reading-view.js` keeps a decorative copy of the scene behind the
scrolling content. The fixed header shows the project gear mark, author affiliations, and
only the report/code actions. `reading-view.css` scopes this behavior to the revealed page;
replaying the opening restores its original layout. `brand-mark.png` (header and footer) and the
favicons `favicon-32.png`, `favicon-192.png` and `apple-touch-icon.png` share the supplied gear-and-orbit design.

`reading-compact.css` keeps the demo and its three acceleration results together in the first
content view, beside each other on desktop and tightly stacked on phones. `reading-typography.css`
sets larger reading text without changing the opening scene. The result figures retain the same
demo-run definitions and values.

The third headline result is list-price token revenue over the scored hour: $459.72430776 for
Dynamo and $1,082.76857768 for Evolving Infra, a 2.3552563 ratio displayed as 2.36×. It uses the
same completed requests and token prices as the video renderer; it is not a profit measurement.

The five-stage illustration inside the Idea section is implemented in `js/role-switch.js` and
`role-switch.css`. The section leads with decoupling compute allocation from KV cache
management, and the diagram labels the two layers explicitly. Its default "Existing engine" comparison illustrates restart-based
reconfiguration, grounded in the report's Dynamo/SGLang deployment. A separate SGLang runtime
switch option illustrates an idle, in-place switch that releases the local prefix cache. Red
callouts and node/cache states make switching time and lost reusable KV explicit.
N1–N6 are compute nodes. Each request is represented directly by its KV block group:
R0 uses dark blocks, R1 red blocks, and R2 striped gray blocks. The same groups appear
in storage. R3 continues R1’s context, showing the retained R1 blocks plus an outlined
new-input block that becomes solid after prefill. No separate request-card symbol is used.
The storage boxes align with their owning nodes. N3 holds the three original KV groups.
The baseline shows separate local caches, with R1 recomputed on N1 after the switch; the
Evolving Infra side shows per-node host memory with a shared-access rail. Its read arrow
runs from N3 host memory to N1 GPU, retaining the original groups on N3.
Solid arrows reroute execution; red dashed arrows read/copy KV while stored copies remain.
Engine names are examples, not a claim that every configuration requires a restart. The compact stage keeps the desktop animation within one viewport beneath the fixed header;
detailed explanations and sources are in the following disclosure. Controls support
pause, replay and direct stage selection; desktop playback loops, while reduced-motion
users advance one stage at a time. The sequence is qualitative, not a timed benchmark. The
comparison scope includes pinned upstream source links and does not claim that vLLM or SGLang
universally lack KV transfer or runtime phase switching.

The opening uses two transparent 2×2 illustration atlases in `docs/media/scene/`, with generation
prompts alongside them. They are conceptual artwork, not product photographs or a list of validated
platforms. The demo and result captions state the actual experimental hardware. The upper-layer
motion stops for reduced-motion preferences and when the scene is offscreen or the page is hidden.

The light opening uses explicit workflow stages (reasoning/checking, reading/clicking,
editing/testing/forking, and watching/triggering) rather than decorative floating alone.
`js/workload.js` advances these illustrative states every 1.2 seconds, with a new focal workload
every 2.4 seconds. It never changes the hardware layer. These states are not experiment telemetry.
Design references: [Figma's interactive homepage case study](https://rive.app/blog/figma-s-new-homepage-is-full-of-rive-animations)
for demonstrating actions, [Dropbox Motion](https://brand.dropbox.com/motion) for purposeful motion
and immediate feedback, and [Stripe](https://stripe.com/) for a bright, structured presentation.

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
- `roles` (Evolving Infra only): the phase (prefill or decode) of each of the 9 nodes over time.

The video covers minutes 30 to 90 of each run, after a 30-minute warmup, and labels them 00:00 to 60:00. The
Dynamo node timeline (drain, restart and new phase of each switch) is written in `render.py` from the Dynamo planner
log. Revenue and user cost use the GLM-5.2 list price: $1.40 per 1M input tokens ($0.26 if cached) and $4.40 per
1M output tokens.

## Credits

Window icons: [Material Icons](https://github.com/google/material-design-icons), Apache License 2.0
(`video/font-icons/LICENSE`).


## Architecture and evidence

Section 02 (`#architecture`) comes directly after the demo and gives the overview before the three idea
sections (03–05). Under its heading, three points state what each of 03–05 contributes in the paper's words,
with the key phrase in red; each label links to its section. Below them, the paper's Figure 1 is built up in
three beats that match the points: a prefill node pulls the request's reusable KV from shared host memory (03),
the planner moves one node from prefill to decode without a restart and the node writes its KV to the pool
(04), and branch counts drop until, with memory full, KV that no active branch references is evicted first
(05). Step buttons jump to a beat, and the point of the current beat is marked in red. The final frame is the
paper figure; with reduced motion it is shown without animation. `docs/arch-overview.css` and
`docs/js/arch-overview.js` hold its layout and timeline.
Section 06 (`#evidence`) presents the
measured results; `docs/research-details.css` scopes its layout, and `docs/js/evidence.js` switches the
stationary workload figures and their interpretation.

The wording follows the arXiv paper's three contribution names and its three problems of existing systems.
Evidence distinguishes the coding demo run from the report benchmarks, labels the SGLang reference splits,
shows the Putnam TTFT tradeoff, and attributes the fixed-split gain to infrastructure, routing, and eviction
together. The 0.3% ablation result describes throughput, not all runtime costs. No new dependencies or build step.
