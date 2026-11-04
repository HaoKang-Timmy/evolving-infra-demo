"""Extract a compact per-request timeline for the side-by-side demo (Dynamo vs Ambidex, CC c126).

Times are seconds after the benchmark start (continuous-timing.json benchmark_start_monotonic_ns), client clock.
Per request: [slot, t_start, t_first, t_end, status, prompt_tokens, cached_tokens, completion_tokens]
  t_start = client_timing.request_start_mono_ns (else CLIENT_ADMIT); t_first = t_start + request_start_to_first_parsed_
  token_ns (else CLIENT_FIRST_TOKEN); t_end = CLIENT_COMPLETE / REQUEST_FAILED; status 1 ok, 0 failed, 2 warmup.
Slot: the 126 concurrency slots; a task takes the slot freed earliest before its TASK_START.
Check (paper definitions, dyn_cmp_w.py): cohort = non-warmup CLIENT_COMPLETE in [start+1800, deadline).
Usage: python3 -I extract.py RAW_DIR OUT_JSON
"""
import gzip
import heapq
import json
import sys
from pathlib import Path

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
NS = 1e9


def interp(v, p):
    v = sorted(v)
    k = p * (len(v) - 1)
    lo = int(k)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def load(prefix):
    t = json.loads(gzip.open(raw / f'{prefix}-timing.json.gz').read())
    t0, t1 = int(t['benchmark_start_monotonic_ns']), int(t['benchmark_deadline_monotonic_ns'])
    adm, first, done, tasks_start, tasks_end, tasks_ev = {}, {}, {}, {}, {}, {}
    with gzip.open(raw / f'{prefix}-lifecycle.jsonl.gz', 'rt', errors='replace') as fh:
        for line in fh:
            if not line.endswith('\n'):
                continue
            r = json.loads(line)
            ev = r['event']
            rid = (r.get('request') or {}).get('rid')
            m = r['mono_ns']
            if ev == 'CLIENT_ADMIT':
                adm[rid] = r
            elif ev == 'CLIENT_FIRST_TOKEN':
                first[rid] = m
            elif ev in ('CLIENT_COMPLETE', 'REQUEST_FAILED'):
                done[rid] = r
            elif ev == 'TASK_START':
                tasks_start[rid] = m
            elif ev in ('TASK_COMPLETE', 'TASK_CANCELLED', 'TASK_FAILED'):
                tasks_end[rid] = m
                tasks_ev[rid] = ev
    # slots: assign tasks in start order to the slot freed earliest
    free = []  # (free_at, slot)
    nslots = 0
    task_slot = {}
    for tid, ts in sorted(tasks_start.items(), key=lambda kv: kv[1]):
        if free and free[0][0] <= ts:
            _, s = heapq.heappop(free)
        else:
            s = nslots
            nslots += 1
        task_slot[tid] = s
        heapq.heappush(free, (tasks_end.get(tid, t1 + 10**12), s))
    reqs, ttft, e2e, n_cohort, unmapped = [], [], [], 0, 0
    for rid, a in adm.items():
        at = a.get('attrs') or {}
        warm = at.get('warmup') is True
        d = done.get(rid)
        if d is None:
            continue
        da = d.get('attrs') or {}
        ct = da.get('client_timing') or {}
        start = ct.get('request_start_mono_ns') or a['mono_ns']
        ft = ct.get('request_start_to_first_parsed_token_ns')
        tf = start + ft if ft is not None else first.get(rid)
        ok = d['event'] == 'CLIENT_COMPLETE'
        status = 2 if warm else (1 if ok else 0)
        slot = task_slot.get(at.get('task_request_id'))
        if slot is None:
            unmapped += 1
            slot = -1
        reqs.append([slot, round((start - t0) / NS, 3), round((tf - t0) / NS, 3) if tf else None,
                     round((d['mono_ns'] - t0) / NS, 3), status, da.get('prompt_tokens') or at.get('source_prompt_tokens'),
                     da.get('cached_prompt_tokens'), da.get('completion_tokens')])
        if ok and not warm and t0 + 1800 * 10**9 <= d['mono_ns'] < t1:
            n_cohort += 1
            e2e.append((d['mono_ns'] - start) / NS)
            if ft is not None:
                ttft.append(ft / NS)
    reqs.sort(key=lambda r: r[1])
    # sessions: [slot, t_start, t_end, 1 completed / 0 cancelled or failed]
    tasks = sorted([[task_slot[k], round((tasks_start[k] - t0) / NS, 3),
                     round((tasks_end[k] - t0) / NS, 3) if k in tasks_end else None,
                     1 if tasks_ev.get(k) == 'TASK_COMPLETE' else 0] for k in tasks_start], key=lambda x: x[1])
    check = {'n': n_cohort, 'req_s': round(n_cohort / ((t1 - t0) / NS - 1800), 4),
             'e2e_mean': round(sum(e2e) / len(e2e), 2), 'ttft_p95': round(interp(ttft, 0.95), 2),
             'ttft_n': len(ttft), 'slots': nslots, 'unmapped': unmapped, 'requests': len(reqs),
             'sessions_done': sum(1 for x in tasks if x[3] == 1 and 1800 <= x[2] < (t1 - t0) / NS),
             'step_s': round(nslots * ((t1 - t0) / NS - 1800) / n_cohort, 1)}
    return t0, reqs, tasks, check


def ours_roles(t0):
    rows = []
    with gzip.open(raw / 'ours-roles.jsonl.gz', 'rt') as fh:
        for line in fh:
            d = json.loads(line)
            snap = d['snapshot']
            roles = snap['assignment']['roles']
            drain = snap.get('draining') or {}
            rows.append([round(d['at'] - t0 / NS, 1), {k: v for k, v in sorted(roles.items())},
                         sorted(drain) if isinstance(drain, (list, dict)) else []])
    nodes = sorted({k for _, r, _ in rows for k in r})
    tl = []
    prev = None
    for t, r, dr in rows:
        state = ''.join(('S' if n in dr else ('P' if r.get(n) == 'prefill' else 'D')) for n in nodes)
        if state != prev:
            tl.append([t, state])
            prev = state
    return tl


data = {}
for arm in ('dyn', 'ours'):
    t0, reqs, tasks, check = load(arm)
    data[arm] = {'requests': reqs, 'tasks': tasks, 'check': check}
    if arm == 'ours':
        data[arm]['roles'] = ours_roles(t0)
    print(arm, json.dumps(check))
out.write_text(json.dumps(data, separators=(',', ':')))
print('wrote', out, out.stat().st_size)
