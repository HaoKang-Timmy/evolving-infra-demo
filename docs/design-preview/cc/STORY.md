# Video cut: one session, then one hour

`story.html` is a roughly 43-second candidate for the Claude Code part of the
demo. The original session replay, with all waiting intervals, stays in
`session.html`. `?film=1` gives the video frame without playback controls;
`?t=12` pauses at a chosen video second. `storyDemo.seek(seconds)` is available
for deterministic capture.

The layout matches the computer-use section of the live combined demo: Source
Sans 3, a centered heading, rectangular gray/red screen frames, segmented
progress strips, step counters and large per-system clocks. `combined.html`
plays a preview combining the existing intro and CUA segment (through 56.4 s,
after its result slide fades out) with this new CC segment. The appended CC
segment fades in over 0.25 s during its opening hold. This preview does not
replace the production video's `media/merge_demo.mp4`.

## Session scene

The scene replays all 25 requests from matched session `fd0aecb95d7f`, using
`session-data.js`. Every request retains its recorded TTFT, decode duration,
prompt length, cached-token count and output length. Only between-request gaps
with no request in flight are removed. The two initial overlapping requests
remain overlapping. Both sides contain the same 15,028 output tokens.

The model-serving clock excludes those omitted intervals. Both panels share the
same playback rate: 8× while either streams, 120× when neither streams. Time
continues advancing at the displayed rate. The source session elapsed times
remain 1863.4 s and 651.2 s; the animation is not a new experiment with tool
latency changed to zero. In particular, the measured cache outcomes still come
from the original run, with its real tool waits.

Each system's clock stops when its model calls finish: 23:15 for Dynamo and
02:55 for Evolving Infra. Cache hit and user cost update when calls complete;
neither shows a future whole-session total. Both are undefined before the first
completion. Cache hit is cumulative cached input divided by cumulative input.
User cost per million tokens is cumulative charge divided by cumulative input
plus output tokens, multiplied by one million. Cached input is counted once.
The terminal status shows the current first-token wait.

| Whole selected session | Dynamo | Evolving Infra |
|---|---:|---:|
| Input-token-weighted cache hit | 80.8390% | 94.3499% |
| Sum of request TTFT | 1335.2 s | 114.4 s |
| Sum of decode durations | 62.5 s | 63.1 s |
| Cost at the demo token rates | $0.81015192 | $0.57062424 |
| Input + output tokens | 1,570,158 | 1,570,158 |
| User cost / 1M input + output tokens | $0.5159684 | $0.3634184 |

The terminal transcript is illustrative, using the same text generator as the
original candidate. Source logs contain request boundaries and token counts,
not response text or individual token-arrival timestamps. Text reveal is
interpolated; a completed session is not a correctness score for the illustrative
coding task. Cache reuse reduces prefill work, but this comparison also changes
allocation and routing and does not isolate a cache-only causal speedup.

## Full-hour scene

This scene shows the original wall-clock measurement window `[1800, 5400)` of
the 126-agent benchmark, after warmup, on 36 GB300 GPUs per system. Its tool
intervals have not been removed. Successful non-warmup calls enter the cohort
when they complete. Values are sampled every 10 seconds and interpolated during
playback. Cache hit is undefined before any requests complete; the plot does
not use future requests to fill that initial sample.

- Cumulative revenue = the sum of per-request token charges.
- Cumulative average cache hit = sum(cached input tokens) / sum(input tokens).
  This is token weighted, not an arithmetic average of request percentages or a
  trailing-window average.
- User cost per million tokens = cumulative revenue / (cumulative input tokens
  + cumulative output tokens) × 1,000,000. Cached input is counted once. This value also
  changes throughout playback; both hit and cost remain undefined before the
  first completion sample.

The demo rates are $1.40/M uncached input, $0.26/M cached input, and $4.40/M
output tokens. These are valuations at the recorded demo rates, not measured
payments or a claim about current prices.

| Measurement hour | Dynamo | Evolving Infra |
|---|---:|---:|
| Completed requests | 7,710 | 21,302 |
| Cumulative revenue | $459.7243078 | $1082.7685777 |
| Cumulative cache hit | 90.9046% | 96.2819% |
| Input + output tokens | 1,163,247,423 | 3,269,214,409 |
| User cost / 1M input + output tokens | $0.3952077 | $0.3312015 |

The whole-hour revenue ratio is 2.36×, and user cost per million tokens is
16.2% lower.
The selected session and the full-hour cohort must not be conflated.

Run data is reproducible from the repository's `video/data.json` with
`python3 video/build_story_data.py`. The source hash is included in
`story-run-data.js`.

## Workload comparison on the main page

`js/shift-data.js` contains the recorded counts from the report's
`figures/data/eval_shift_splits.csv`, with a source SHA-256. Both the Evidence
animation and the compute-allocation demo use it. Each of the nine separate
node boxes represents four GB300 GPUs. During Dynamo restarts the recorded
prefill and decode counts sum to eight; the remaining node is explicitly
unavailable. Nodes are grouped by role, not identified by physical node ID.
