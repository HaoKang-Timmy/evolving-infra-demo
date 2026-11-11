"""Build the cumulative series for the CC video candidate from its existing data.

Uses only the standard library and the compact (2.1 MB) video/data.json export.
Does not read raw lifecycle logs or run any new experiments.
"""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
source = root / "video/data.json"
data = json.loads(source.read_text())
result = {
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "windowSeconds": 3600,
    "sampleSeconds": 10,
    "ratesPerMillion": {"input": 1.4, "cachedInput": .26, "output": 4.4},
    "series": {},
    "totals": {},
}
for arm in ("dyn", "ours"):
    rows = sorted(
        (r for r in data[arm]["requests"] if r[4] == 1 and 1800 <= r[3] < 5400),
        key=lambda r: r[3],
    )
    count = prompt = cached = 0
    revenue = 0
    points = []
    for second in range(0, 3601, 10):
        while count < len(rows) and rows[count][3] < 1800 + second:
            row = rows[count]
            p, c, o = row[5] or 0, row[6] or 0, row[7] or 0
            revenue += ((p - c) * 1.4 + c * .26 + o * 4.4) / 1e6
            prompt += p
            cached += c
            count += 1
        points.append([
            second, round(revenue, 7), round(cached / prompt, 7) if prompt else None,
            count, round(revenue / count, 9) if count else None,
        ])
    assert count == data[arm]["check"]["n"], (arm, count)
    result["series"][arm] = points
    result["totals"][arm] = {
        "calls": count, "revenue": round(revenue, 7), "hit": cached / prompt,
        "userCostPerCall": revenue / count, "promptTokens": prompt, "cachedTokens": cached,
    }
result["note"] = (
    "Rows: seconds after warmup, cumulative revenue at demo token prices, cumulative "
    "token-weighted cache hit, completed requests, mean price per completed request. "
    "Cohort: non-warmup successful requests completed in [1800,5400). No requests at "
    "t=0: hit and mean cost are undefined. Playback interpolates 10-second samples."
)
target = root / "docs/design-preview/cc/story-run-data.js"
target.write_text("window.STORY_RUN_DATA = " + json.dumps(result, separators=(",", ":")) + ";\n")
print(json.dumps(result["totals"], indent=2))
