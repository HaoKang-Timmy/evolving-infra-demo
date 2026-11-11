# Terminal replay candidate

`session.html` presents one matched session from the same CC126 runs used by the
existing demo. `?mode=reply` shows call 13 at actual speed. The full session runs
at a constant 45× on both sides. Pause, replay, seek, and reduced motion are
supported. Previous candidates, including S4, remain available.

## Measured and illustrated

- Source: `cc-demo-data.js`, `one_agent` entry `fd0aecb95d7f`. The extracted data
  and source hash are in `session-data.js`.
- Both arms have 25 requests and 15,028 output tokens; per-request prompt lengths
  and output lengths match. Starts are normalized separately to zero.
- Evolving Infra finishes at 651.2 s; Dynamo at 1863.4 s (2.86× for this selected
  example). It is not a population-average speedup.
- Summed first-token waits are 114.4 s versus 1335.2 s. Summed decode durations
  are 63.1 s versus 62.5 s. This example mainly demonstrates less waiting, not
  faster decoding across the session.
- Call 13 has 1,148 output tokens on each side. Dynamo: 7.8 s TTFT and 8.6 s
  decoding. Evolving Infra: 3.6 s TTFT and 3.2 s decoding. The 1× view shows this
  request's measured durations, not a claim about average decode speed.
- The exported events have request/first-token/completion timestamps and token
  counts, but no transcript or individual token-arrival timestamps. Text and the
  coding task are explicitly illustrative. Text is revealed linearly between
  first-token and completion events, and the terminal scrolls with that text.
- Between-request intervals include tool calls and harness overhead. Overlapping
  requests remain overlapping; no artificial serial request chain is imposed.
- The replay does not establish coding-task correctness or represent an actual
  screen recording. A completed session means the recorded requests completed.

These limits are also visible in the demo and its expandable measurement notes.

## Website feedback preview

The accompanying root-page changes address four comments:

1. Architecture: synchronized phase-change illustration on both sides, including
   baseline downtime and local KV loss. The shared pool on the right persists.
   Durations are illustrative, not a second benchmark.
2. Compute allocation: explicitly label the comparison `Dynamo planner`.
3. KV cache: independent Compaction, Subagent, and Tool call scenes. Eviction
   priorities follow the report's zero-reference-before-positive-reference rule;
   they do not imply a separate client context-management event stream or an
   unconditional deletion on compaction.
4. Shifting workload: replay workload composition and Evolving Infra's PD split
   on the same clock. Transitions are reconstructed from the existing paper
   figure, and the original measured comparison plot remains expandable.

The terminology and eviction semantics were checked against the arXiv Overleaf
project, `Section/Control_plane.tex`, on 2026-11-11.
