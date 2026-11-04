"""Side-by-side demo video v9: Dynamo vs Evolving Infra, Claude Code workload, 126 concurrent agents.

Design (merged from three reviews):
  * one persistent result line under the title (from the check fields) so every frame carries the message;
  * each panel is a card: node strip (neutral P/D, hatched drain, dashed empty slot = offline) with a split
    label that counts every node, 9x14 agent windows, live 'waiting now N/126', and a stats row with one hero
    number (agent sessions completed) plus revenue, cost per step and P95 TTFT up to the current time;
  * v11 (user 2026-11-04): icons, not colors alone, say what each agent window is doing (Material Icons:
    hourglass = waiting for the model, sparkles = generating, wrench = tool call or idle, check = agent
    finished); finished agents leave small check marks in the window's title bar; no 'so far' wording;
  * one centered caption narrates timestamped, data-driven beats (no causal claims);
  * bottom: cumulative agents finished + cumulative LLM calls completed (v10e, user 2026-11-03: cumulative calls
    instead of the trailing 5-min rate, so the chart ends at the end-card totals);
  * intro hold (clock frozen at 00:00), final freeze, opaque fade to a paired-bar end card.
All counts, curves and states are exact data at the current trace time; easing only touches presentation
(alpha / bar growth on the end card, pulse of a highlight frame).

Input: data.json from extract.py. Output: MP4 (H.264) or preview PNGs.
Usage: python render.py data.json OUT_DIR [--preview [--frames I,J]] [--ffmpeg PATH] [--icons TTF]
"""
import argparse
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import animation
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyBboxPatch, Rectangle

ap = argparse.ArgumentParser()
ap.add_argument('data')
ap.add_argument('out')
ap.add_argument('--preview', action='store_true')
ap.add_argument('--ffmpeg', default='ffmpeg')
ap.add_argument('--frames', default='', help='with --preview: comma-separated frame indices instead of the default set')
ap.add_argument('--icons', default=str(Path(__file__).resolve().parent / 'font-icons' / 'MaterialIcons-Regular.ttf'))
args = ap.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
D = json.loads(Path(args.data).read_text())

# ---------------------------------------------------------------- timing
W0, W1 = 1800.0, 5400.0       # shown window (s after the benchmark start), presented as elapsed 00:00-60:00
STEP = 2.0                    # trace seconds per frame -> 60x speed at 30 fps
FPS = 30
TIMES = np.arange(W0, W1 + 1e-9, STEP)
NT = len(TIMES)               # 1801
INTRO = 45                    # 1.5 s hold at 00:00 (clock frozen; nothing advances)
FREEZE = 30                   # 1 s hold on the last data frame
FADE = 15                     # 0.5 s fade to the end card
CARD = 150                    # 5 s end card
TOTAL = INTRO + NT + FREEZE + FADE + CARD
ROWS, COLS = 9, 14
NSLOT = ROWS * COLS
FLASH = 60.0                  # trace seconds a finished session stays gold (1 s of video)
MAXPIP = 4

# ---------------------------------------------------------------- palette (light)
BG, CARD_BG, CARD_EC = '#ffffff', '#f6f7f9', '#e3e6ea'
INK, MUTED, FAINT, GRIDL = '#1f2328', '#5b6470', '#8a929c', '#e6e9ee'
C_DYN, C_OURS = '#64748b', '#2563eb'           # slate vs blue (blue never reads as 'waiting' red / 'generating' green)
C_WAIT, C_GEN, C_IDLE, C_DONE = '#d1495b', '#3a9d5d', '#e4e7eb', '#e5a000'
C_PIP, C_PIP_EC = '#f5b400', '#7a5a00'
C_OFF = '#b4424f'
C_BAND = '#94a3b8'
C_TOOL = '#8a919c'
ICON_FP = FontProperties(fname=args.icons)       # Material Icons (Apache 2.0), glyphs by codepoint
IC_WAIT, IC_GEN, IC_TOOL, IC_DONE, IC_PIP = '\uea5b', '\ue65f', '\ue869', '\ue86c', '\ue5ca'
#   hourglass_top, auto_awesome (sparkles), build (wrench), check_circle, check
# tile state -> (body, title bar, icon, icon color); 0 idle/tool, 1 generating, 2 waiting, 3 just finished
TILE = {0: (C_IDLE, '#cdd2d9', IC_TOOL, C_TOOL),
        1: (C_GEN, '#2a7a46', IC_GEN, 'white'),
        2: (C_WAIT, '#a8323f', IC_WAIT, 'white'),
        3: (C_DONE, '#b07d00', IC_DONE, INK)}


def mmss(el):
    el = max(0.0, float(el))
    return f'{int(el // 60):02d}:{int(el % 60):02d}'


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


# ---------------------------------------------------------------- data
P_IN, P_CACHED, P_OUT = 1.40e-6, 0.26e-6, 4.40e-6   # GLM-5.2 list price per token: input, cached input, output


def arm_arrays(arm):
    r = np.array([[x[0], x[1], x[2] if x[2] is not None else x[3], x[3], x[4], x[5] or 0, x[6] or 0, x[7] or 0]
                  for x in D[arm]['requests']], float)
    a = dict(slot=r[:, 0].astype(int), ts=r[:, 1], tf=r[:, 2], te=r[:, 3], st=r[:, 4].astype(int),
             usd=(r[:, 5] - r[:, 6]) * P_IN + r[:, 6] * P_CACHED + r[:, 7] * P_OUT)
    k = np.array([[x[0], x[1], x[2] if x[2] is not None else 1e12, x[3]] for x in D[arm]['tasks']], float)
    a.update(kslot=k[:, 0].astype(int), kte=k[:, 2], kok=k[:, 3] == 1)
    return a


A = {'dyn': arm_arrays('dyn'), 'ours': arm_arrays('ours')}
FINAL = {arm: D[arm]['check'] for arm in A}


def precompute(a):
    st = np.zeros((NT, NSLOT), np.int8)
    pips = np.zeros((NT, NSLOT), np.int8)
    waitn = np.zeros(NT, int)
    sess = np.zeros(NT, int)
    steps = np.zeros(NT, int)
    p95 = np.full(NT, np.nan)
    rate = np.full(NT, np.nan)
    valid = (a['slot'] >= 0) & (a['slot'] < NSLOT)
    slot = a['slot'][valid]
    ts, tf, te = a['ts'][valid], a['tf'][valid], a['te'][valid]
    oks = (a['st'] == 1) & (a['te'] >= W0)
    order = np.argsort(a['te'][oks], kind='stable')
    te_s = a['te'][oks][order]
    tt_s = (a['tf'] - a['ts'])[oks][order]
    rev_cum = np.concatenate([[0.0], np.cumsum(a['usd'][oks][order])])   # revenue of the first n completed calls
    rev = np.zeros(NT)
    cps = np.full(NT, np.nan)
    kf = a['kok'] & (a['kte'] >= W0) & (a['kslot'] >= 0) & (a['kslot'] < NSLOT)
    kte, kslot = a['kte'][kf], a['kslot'][kf]
    for k, t in enumerate(TIMES):
        wait = np.bincount(slot[(ts <= t) & (t < tf)], minlength=NSLOT)[:NSLOT] > 0
        gen = np.bincount(slot[(tf <= t) & (t < te)], minlength=NSLOT)[:NSLOT] > 0
        done = kte < t
        flash = np.bincount(kslot[done & (kte > t - FLASH)], minlength=NSLOT)[:NSLOT] > 0
        pips[k] = np.minimum(np.bincount(kslot[done], minlength=NSLOT)[:NSLOT], MAXPIP)
        st[k] = np.where(flash, 3, np.where(wait, 2, np.where(gen, 1, 0)))
        waitn[k] = int(wait.sum())
        sess[k] = int(done.sum())
        n = int(np.searchsorted(te_s, t, side='left'))       # LLM calls completed in [W0, t)
        steps[k] = n
        rev[k] = rev_cum[n]
        if n >= 200:
            cps[k] = rev_cum[n] / n                           # user cost per agent step (LLM call), so far
        if n >= 200:                                          # P95 TTFT so far, same definition as the check field
            p95[k] = float(np.percentile(tt_s[:n], 95))
        span = min(300.0, t - W0)
        if span >= 60.0:                                      # LLM calls/min, trailing 5 min (shorter at the start)
            n0 = int(np.searchsorted(te_s, t - span, side='left'))
            rate[k] = (n - n0) / (span / 60.0)
    return dict(st=st, pips=pips, waitn=waitn, sess=sess, steps=steps, p95=p95, rate=rate, rev=rev, cps=cps)


print('precomputing frames ...', flush=True)
PRE = {arm: precompute(A[arm]) for arm in A}
for arm in A:
    f, p = FINAL[arm], PRE[arm]
    print(arm, 'sessions', p['sess'][-1], 'check', f['sessions_done'], '| steps', p['steps'][-1], 'check', f['n'],
          '| p95 %.2f' % p['p95'][-1], 'check', f['ttft_p95'], flush=True)
    if p['sess'][-1] != f['sessions_done'] or p['steps'][-1] != f['n'] or abs(p['p95'][-1] - f['ttft_p95']) > 0.5:
        print('WARNING: live counters do not converge to the check fields for', arm, flush=True)

# ---------------------------------------------------------------- node timelines
# Dynamo: node, state, from_s, to_s (app_switch_dynamo.csv / planner log, CC126; minutes from the run start).
# States: P prefill, D decode, S draining before restart, R restarting (offline).
_m = 60.0
DYN_EV = [
    (5, 'S', 30.7 * _m, 31.2 * _m), (5, 'R', 31.2 * _m, 44.4 * _m), (5, 'D', 44.4 * _m, 1e9),
    (4, 'S', 44.6 * _m, 46.5 * _m), (4, 'R', 46.5 * _m, 59.3 * _m), (4, 'D', 59.3 * _m, 1e9),
    (3, 'S', 59.4 * _m, 60.0 * _m), (3, 'R', 60.0 * _m, 73.6 * _m), (3, 'D', 73.6 * _m, 74.1 * _m),
    (3, 'S', 74.1 * _m, 75.2 * _m), (3, 'R', 75.2 * _m, 85.7 * _m), (3, 'P', 85.7 * _m, 1e9),
    (4, 'S', 85.9 * _m, 1e9),
]
# Dynamo switches: (drain start, offline start, back online, from, to); None = still in progress at 60:00
DYN_SW = [(30.7 * _m, 31.2 * _m, 44.4 * _m, '6P3D', '5P4D'),
          (44.6 * _m, 46.5 * _m, 59.3 * _m, '5P4D', '4P5D'),
          (59.4 * _m, 60.0 * _m, 73.6 * _m, '4P5D', '3P6D'),
          (74.1 * _m, 75.2 * _m, 85.7 * _m, '3P6D', '4P5D'),
          (85.9 * _m, None, None, '4P5D', '5P4D')]
DYN_OFF = [(a, b) for _n, s, a, b in DYN_EV if s == 'R']    # offline intervals (trace s)


def dyn_nodes(t):
    s = list('PPPPPPDDD')
    rem = None
    for n, st, a, b in DYN_EV:
        if a <= t < b:
            s[n] = st
            if st == 'R':
                rem = t - a                  # seconds offline so far (counts up; user: no countdown)
    return s, rem


ROLES = D['ours']['roles']
ROLE_T = np.array([x[0] for x in ROLES])


def ours_nodes(t):
    k = max(0, int(np.searchsorted(ROLE_T, t, side='right')) - 1)
    return list(ROLES[k][1]), None


def compact_split(s):
    return f"{sum(x == 'P' for x in s)}P{sum(x == 'D' for x in s)}D"


def ours_switches():
    """(start, end, from, to) from the role-controller timeline; S = draining during an in-place switch."""
    res, stable, pending = [], ROLES[0][1], None
    for t, s in ROLES[1:]:
        if 'S' in s:
            if pending is None:
                pending = t
            continue
        if s != stable:
            t0 = pending if pending is not None else t
            res.append((t0, t, compact_split(stable), compact_split(s)))
            stable = s
        pending = None
    return [x for x in res if W0 <= x[0] < W1]


OURS_SW = ours_switches()
print('ours switches', OURS_SW, flush=True)
NODES = {'dyn': dyn_nodes, 'ours': ours_nodes}
ORDER = {'P': 0, 'S': 1, 'R': 2, 'D': 3}

# ---------------------------------------------------------------- caption beats (timestamped, observed facts only)
BEATS = []   # (t0, t1, fn(k) -> str), trace seconds


def sched(t_want, dur, fn):
    t0 = max(t_want, BEATS[-1][1] if BEATS else W0)
    BEATS.append((t0, t0 + dur, fn))


BEATS.append((W0, W0 + 90.0, lambda k: '@legend'))   # drawn as icon runs (INTRO_LEG), not as caption text
if OURS_SW:
    _a = OURS_SW[0]
    sched(_a[0], 150.0, lambda k, a=_a: f'{mmss(a[0] - W0)}  ·  Evolving Infra re-balances {a[2]} → {a[3]} in place, '
                                         f'without a restart')
def dyn_state(k, d):
    t = TIMES[min(k, NT - 1)]
    if t < d[1]:
        return 'node draining'
    if t < d[2]:
        return f'node offline for {mmss(t - d[1])}'
    return 'node back online'


_d = DYN_SW[0]
sched(_d[0], 210.0, lambda k, d=_d: f'{mmss(d[0] - W0)}  ·  Dynamo switches {d[3]} → {d[4]} by draining and restarting '
                                     f'a node  ·  {dyn_state(k, d)}')
sched(W0 + 600.0, 210.0, lambda k: f'Each check mark on a window = one agent finished there  ·  '
                                   f'Evolving Infra {PRE["ours"]["sess"][k]},  Dynamo {PRE["dyn"]["sess"][k]}')
_d = DYN_SW[1]
sched(_d[0], 180.0, lambda k, d=_d: f'{mmss(d[0] - W0)}  ·  Dynamo {d[3]} → {d[4]}: another drain + restart  ·  '
                                     f'{dyn_state(k, d)}')
if len(OURS_SW) > 1:
    _a = OURS_SW[1]
    sched(_a[1], 210.0, lambda k, a=_a: f'{mmss(a[0] - W0)}  ·  Evolving Infra {a[2]} → {a[3]} in {a[1] - a[0]:.0f} s, '
                                         f'in place, no restart')
_d = DYN_SW[2]
sched(_d[1], 480.0, lambda k, d=_d: f'{mmss(d[0] - W0)}  ·  Dynamo {d[3]} → {d[4]}: {dyn_state(k, d)}')
_d = DYN_SW[3]
sched(_d[0], 180.0, lambda k, d=_d: f'{mmss(d[0] - W0)}  ·  Dynamo {d[3]} → {d[4]}: drain + restart  ·  '
                                     f'{dyn_state(k, d)}')


def _final_beat(k):
    cd, co = int(PRE['dyn']['sess'][k]), int(PRE['ours']['sess'][k])
    r = f'  (×{co / cd:.2f})' if cd >= 12 else ''
    return f'Agents finished:  Evolving Infra {co}  vs  Dynamo {cd}{r}'


sched(W0 + 3000.0, W1 - W0, _final_beat)


def beat_text(k, t, mode):
    if mode == 'intro':
        return BEATS[0][2](k)
    if mode != 'run':
        return BEATS[-1][2](k)
    for t0, t1, fn in BEATS:
        if t0 <= t < t1:
            return fn(k)
    return ''


# ---------------------------------------------------------------- figure
plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': INK, 'axes.edgecolor': '#c9ced6',
                     'hatch.linewidth': 1.0})
fig = plt.figure(figsize=(19.2, 10.8), dpi=100, facecolor=BG)
FW, FH = 1920.0, 1080.0
REND = fig.canvas.get_renderer()


def text_w(t):
    return t.get_window_extent(renderer=REND).width / FW


def runs(x, y, parts, ha='left', zorder=3):
    """Place text runs side by side using measured widths. parts: (text, kwargs, gap_px_after)."""
    arts, ws = [], []
    for txt, kw, gap in parts:
        t = fig.text(x, y, txt, va='center', ha='left', zorder=zorder, **kw)
        arts.append(t)
        ws.append(text_w(t) + gap / FW)
    total = sum(ws) - parts[-1][2] / FW
    cx = x - total if ha == 'right' else (x - total / 2 if ha == 'center' else x)
    for t, w in zip(arts, ws):
        t.set_x(cx)
        cx += w
    return arts


fo, fd = FINAL['ours'], FINAL['dyn']
R_SESS = fo['sessions_done'] / fd['sessions_done']
R_STEP = fd['step_s'] / fo['step_s']

# header
runs(0.03, 0.955, [('Serving 126 coding agents concurrently', dict(fontsize=30, weight='bold', color=INK), 22),
                   ('Claude Code workload  ·  GLM-5.2  ·  36 GB300 GPUs', dict(fontsize=15, color=MUTED), 0)])
clock = fig.text(0.97, 0.955, '00:00', fontsize=30, ha='right', va='center', family='DejaVu Sans Mono', weight='bold')
fig.text(0.97, 0.910, '60× speed  ·  elapsed mm:ss', fontsize=13, ha='right', va='center', color=MUTED)

PX = {'dyn': 0.03, 'ours': 0.515}
PW = 0.455
CARD_Y0, CARD_Y1 = 0.330, 0.878
STRIP = (0.735, 0.058)          # node strip y, height
STRIP_WF = 0.74                 # node strip width as a fraction of the panel width
GRID = (0.432, 0.268)           # agent grid y, height
SUB = {'dyn': "switches a node's role by draining and restarting it",
       'ours': 'switches node roles in place, no restart  ·  agent-aware KV cache management'}
NAME = {'dyn': 'Dynamo', 'ours': 'Evolving Infra (ours)'}
COL = {'dyn': C_DYN, 'ours': C_OURS}
S_LABEL = {'dyn': 'drain', 'ours': 'switch'}

# per-axes pixel scale for round shapes in data coords
gx_px = PW * FW / COLS
gy_px = GRID[1] * FH / ROWS
nx_px = PW * STRIP_WF * FW / 9
ny_px = STRIP[1] * FH

PANELS = {}
for arm in ('dyn', 'ours'):
    x0 = PX[arm]
    col = COL[arm]
    card = FancyBboxPatch((x0 - 0.012, CARD_Y0), PW + 0.024, CARD_Y1 - CARD_Y0, transform=fig.transFigure,
                          boxstyle='round,pad=0,rounding_size=0.008', mutation_aspect=FW / FH,
                          fc=CARD_BG, ec=CARD_EC, lw=1.2,   # user: no outline that singles out our panel
                          zorder=-1)
    fig.add_artist(card)
    fig.text(x0, 0.848, NAME[arm], fontsize=24, weight='bold', color=col, va='center')
    # user: the video does not explain what each system uses, so no panel subtitle

    # node strip
    axn = fig.add_axes([x0, STRIP[0], PW * STRIP_WF, STRIP[1]])
    axn.set_axis_off(); axn.patch.set_visible(False)
    axn.set_xlim(0, 9); axn.set_ylim(0, 1)
    boxes, nlabels = [], []
    for i in range(9):
        b = FancyBboxPatch((i + 0.06, 0.06), 0.88, 0.88, boxstyle='round,pad=0,rounding_size=0.12',
                           mutation_aspect=nx_px / ny_px, lw=0, fc='#2f3640', ec='#2f3640')
        axn.add_patch(b); boxes.append(b)
        nlabels.append(axn.text(i + 0.5, 0.5, 'P', ha='center', va='center', fontsize=16, weight='bold',
                                color='white', linespacing=1.0))
    hl = FancyBboxPatch((x0 - 0.004, STRIP[0] - 0.005), PW * STRIP_WF + 0.008, STRIP[1] + 0.010,
                        transform=fig.transFigure, boxstyle='round,pad=0,rounding_size=0.006',
                        mutation_aspect=FW / FH, fc='none', ec=C_OURS, lw=3, zorder=5, visible=False)
    fig.add_artist(hl)
    t_split = fig.text(x0 + PW, 0.777, '', fontsize=22, weight='bold', ha='right', va='center', color=INK,
                       family='DejaVu Sans Mono')
    t_extra = fig.text(x0 + PW, 0.744, '', fontsize=12.5, weight='bold', ha='right', va='center', color=C_OFF)

    # grid header: inline legend + live waiting counter
    t_waitn = fig.text(x0 + PW, 0.713, '126/126 waiting now', fontsize=14, weight='bold', ha='right', va='center',
                       color=C_WAIT)
    budget = PW - text_w(t_waitn) - 0.012            # legend must end before the widest counter text
    for fs in (12.0, 11.5, 11.0, 10.5, 10.0, 9.5):
        ic = dict(fontproperties=ICON_FP, fontsize=fs + 4)
        leg = runs(x0, 0.713, [(IC_WAIT, dict(ic, color=C_WAIT), 3),
                               ('waiting for model', dict(fontsize=fs, color=INK), 12),
                               (IC_GEN, dict(ic, color=C_GEN), 3), ('generating', dict(fontsize=fs, color=INK), 12),
                               (IC_TOOL, dict(ic, color=C_TOOL), 3),
                               ('tool / idle', dict(fontsize=fs, color=INK), 12),
                               (IC_DONE, dict(ic, color=C_DONE), 3),
                               ('agent finished', dict(fontsize=fs, color=INK), 0)])
        right = leg[-1].get_position()[0] + text_w(leg[-1])
        if right - x0 <= budget or fs <= 9.5:
            break
        for _t in leg:
            _t.remove()

    # agent grid
    axg = fig.add_axes([x0, GRID[0], PW, GRID[1]])
    axg.set_axis_off(); axg.patch.set_visible(False)
    axg.set_xlim(0, COLS); axg.set_ylim(ROWS, 0)
    tiles, pips = [], []
    for r in range(ROWS):
        for c in range(COLS):
            body = FancyBboxPatch((c + 0.06, r + 0.08), 0.88, 0.84, boxstyle='round,pad=0,rounding_size=0.08',
                                  mutation_aspect=gx_px / gy_px, lw=0, fc=C_IDLE)
            axg.add_patch(body)
            bar = Rectangle((c + 0.06, r + 0.08), 0.88, 0.27, lw=0, fc=TILE[0][1])
            axg.add_patch(bar)
            bar.set_clip_path(body)
            txt = axg.text(c + 0.5, r + 0.635, TILE[0][2], ha='center', va='center', fontproperties=ICON_FP,
                           fontsize=15, color=TILE[0][3])   # glyph ~17 px of the ~18 px below the title bar
            tiles.append([body, bar, txt, -1])
            row = []
            for j in range(MAXPIP):
                e = axg.text(c + 0.20 + j * 0.18, r + 0.08 + 0.135, IC_PIP, ha='center', va='center',
                             fontproperties=ICON_FP, fontsize=8, color=C_PIP, zorder=3, visible=False,
                             path_effects=[pe.withStroke(linewidth=1.4, foreground=C_PIP_EC)])
                row.append(e)
            pips.append([row, 0])
    callout = axg.annotate('one Claude Code agent', xy=(0.5, 0.6), xytext=(2.4, 1.6), fontsize=15, weight='bold',
                           color=INK, va='center', zorder=20,
                           bbox=dict(boxstyle='round,pad=0.35', fc='white', ec=INK, lw=1.5),
                           arrowprops=dict(arrowstyle='-|>', color=INK, lw=2))

    # stats row
    # columns: fixed minimum x, pushed right by the measured label widths so labels never collide
    lab1 = fig.text(x0, 0.346, 'agents finished', fontsize=12, color=MUTED, va='center')
    x2 = max(x0 + 0.14, x0 + text_w(lab1) + 0.02)
    lab2 = fig.text(x2, 0.346, 'revenue', fontsize=12, color=MUTED, va='center')
    x3 = max(x2 + 0.10, x2 + text_w(lab2) + 0.025)
    lab3 = fig.text(x3, 0.346, 'user cost per agent step', fontsize=12, color=MUTED, va='center')
    x4 = max(x3 + 0.10, x3 + text_w(lab3) + 0.025)
    lab4 = fig.text(x4, 0.346, 'P95 TTFT', fontsize=12, color=MUTED, va='center')
    if x4 + text_w(lab4) > x0 + PW:                    # shorten rather than overflow the card
        lab3.set_text('cost / agent step')
        x4 = max(x3 + 0.10, x3 + text_w(lab3) + 0.025)
        lab4.set_x(x4)
    t_sess = fig.text(x0, 0.386, '', fontsize=44, weight='bold', va='center', color=col)
    t_steps = fig.text(x2, 0.386, '', fontsize=26, weight='bold', va='center', color=INK)
    t_cps = fig.text(x3, 0.386, '', fontsize=26, weight='bold', va='center', color=INK)
    t_p95 = fig.text(x4, 0.386, '', fontsize=26, weight='bold', va='center', color=INK)
    t_waitn.set_visible(False)                         # user: no 'waiting now' counter
    PANELS[arm] = dict(boxes=boxes, nlabels=nlabels, hl=hl, split=t_split, extra=t_extra, waitn=t_waitn,
                       tiles=tiles, pips=pips, callout=callout, sess=t_sess, steps=t_steps, cps=t_cps, p95=t_p95)

# caption pill
caption = fig.text(0.5, 0.290, '', fontsize=17, weight='bold', ha='center', va='center', color=INK, zorder=6,
                   bbox=dict(boxstyle='round,pad=0.45', fc='#eceef2', ec='none'))
# first beat ('@legend'): what the icons mean, as icon + text runs on a pill like the caption's
_ic, _tx = dict(fontproperties=ICON_FP, fontsize=21), dict(fontsize=17, weight='bold', color=INK)
INTRO_LEG = runs(0.5, 0.290, [(IC_WAIT, dict(_ic, color=C_WAIT), 5), ('waiting for the model', _tx, 30),
                              (IC_GEN, dict(_ic, color=C_GEN), 5), ('generating', _tx, 30),
                              (IC_TOOL, dict(_ic, color=C_TOOL), 5), ('tool call or idle', _tx, 30),
                              (IC_DONE, dict(_ic, color=C_DONE), 5), ('agent finished', _tx, 0)], ha='center', zorder=7)
_bx = [a.get_window_extent(renderer=REND) for a in INTRO_LEG]
_pad = 0.45 * 17 * 100 / 72                       # px, the caption pill's pad (0.45 x 17 pt)
_hh = max(b.height for b in _bx) / 2 + _pad
_pill = FancyBboxPatch(((_bx[0].x0 - _pad) / FW, 0.290 - _hh / FH), (_bx[-1].x1 - _bx[0].x0 + 2 * _pad) / FW, 2 * _hh / FH,
                       transform=fig.transFigure, boxstyle=f'round,pad=0,rounding_size={_pad / FW}',
                       mutation_aspect=FW / FH, fc='#eceef2', ec='none', zorder=6)
fig.add_artist(_pill)
INTRO_LEG.append(_pill)

# ---------------------------------------------------------------- charts
MINS = (TIMES - W0) / 60.0
YMAX_C = max(fo['sessions_done'], fd['sessions_done']) * 1.12
YMAX_R = max(fo['n'], fd['n']) * 1.12


def style_chart(ax, title, ymax, yticks):
    ax.set_xlim(0, 60); ax.set_ylim(0, ymax)
    ax.patch.set_visible(False)
    for s in ('top', 'right', 'left'):
        ax.spines[s].set_visible(False)
    ax.spines['bottom'].set_color('#b8bfc8')
    ax.set_xticks(range(0, 61, 10))
    ax.set_xticklabels([str(v) for v in range(0, 60, 10)] + ['60 min'])
    ax.set_yticks(yticks)
    ax.tick_params(labelsize=12, colors=MUTED, length=0, pad=6)
    ax.grid(axis='y', color=GRIDL, lw=1)
    ax.set_axisbelow(True)
    ax.text(0, 1.10, title, transform=ax.transAxes, fontsize=13.5, weight='bold', color=INK, va='bottom', ha='left')


CH_Y, CH_H = 0.072, 0.152
axc = fig.add_axes([0.06, CH_Y, 0.40, CH_H])
style_chart(axc, 'Agents finished', YMAX_C, [0, 50, 100])
axr = fig.add_axes([0.575, CH_Y, 0.37, CH_H])   # narrower than v10d: room for 6-digit end labels
style_chart(axr, 'LLM calls completed', YMAX_R, [0, 10000, 20000])
axr.set_yticklabels(['0', '10K', '20K'])
BANDS, SWMARK = [], []   # user: no offline / in-place-switch markers in the charts

(l_dyn,) = axc.plot([], [], color=C_DYN, lw=3.2, solid_capstyle='round', zorder=3)
(l_ours,) = axc.plot([], [], color=C_OURS, lw=3.2, solid_capstyle='round', zorder=3)
(r_dyn,) = axr.plot([], [], color=C_DYN, lw=2.6, solid_capstyle='round', zorder=3)
(r_ours,) = axr.plot([], [], color=C_OURS, lw=2.6, solid_capstyle='round', zorder=3)
e_dyn = axc.text(0, 0, '', color=C_DYN, fontsize=13, weight='bold', va='center', clip_on=False)
e_ours = axc.text(0, 0, '', color=C_OURS, fontsize=13, weight='bold', va='center', clip_on=False)
er_dyn = axr.text(0, 0, '', color=C_DYN, fontsize=12, weight='bold', va='center', clip_on=False)
er_ours = axr.text(0, 0, '', color=C_OURS, fontsize=12, weight='bold', va='center', clip_on=False)
(bracket,) = axc.plot([], [], color=C_OURS, lw=1.6, clip_on=False, zorder=4)
ratio_t = axc.text(0, 0, '', fontsize=14, weight='bold', color='white', va='center', ha='left', clip_on=False,
                   zorder=5, bbox=dict(boxstyle='round,pad=0.25', fc=C_OURS, ec='none'))

fig.text(0.03, 0.016, 'Both start at 6 prefill + 3 decode nodes  ·  latencies measured at the client', fontsize=11,
         color=MUTED)


def place_pair(ylo, yhi, gap, ymin):
    """Separate two end labels by at least `gap` data units (presentation only)."""
    if yhi - ylo >= gap:
        return ylo, yhi
    c = (ylo + yhi) / 2.0
    lo, hi = c - gap / 2.0, c + gap / 2.0
    if lo < ymin:
        lo, hi = ymin, ymin + gap
    return lo, hi


# ---------------------------------------------------------------- end card (pre-built, hidden)
overlay = Rectangle((0, 0), 1, 1, transform=fig.transFigure, fc=BG, ec='none', zorder=50, alpha=0.0, visible=False)
fig.add_artist(overlay)
CARD_ARTS = []   # (artist, appear_frame)


def card_text(x, y, s, appear, **kw):
    t = fig.text(x, y, s, zorder=60, visible=False, **kw)
    CARD_ARTS.append((t, appear))
    return t


card_text(0.5, 0.875, 'Serving 126 coding agents concurrently', appear=0, ha='center', va='center', fontsize=34,
          weight='bold', color=INK)
card_text(0.5, 0.815, 'Same Claude Code workload  ·  GLM-5.2 on the same 36 GB300 GPUs  ·  totals over the 60 minutes shown',
          appear=3, ha='center', va='center', fontsize=16, color=MUTED)
_leg = runs(0.5, 0.757, [('■', dict(fontsize=16, color=C_DYN), 5), ('Dynamo', dict(fontsize=15, color=INK, weight='bold'), 26),
                         ('■', dict(fontsize=16, color=C_OURS), 5),
                         ('Evolving Infra (ours)', dict(fontsize=15, color=INK, weight='bold'), 0)], ha='center', zorder=60)
for _t in _leg:
    _t.set_visible(False)
    CARD_ARTS.append((_t, 5))

REV = {arm: float(PRE[arm]['rev'][-1]) for arm in A}
CPS = {arm: REV[arm] / float(PRE[arm]['steps'][-1]) for arm in A}
print('revenue', REV, 'cost per step', CPS, flush=True)
ROWS_CARD = [
    ('Agents finished', 'higher is better', fd['sessions_done'], fo['sessions_done'], '{:,.0f}',
     f'{fo["sessions_done"] / fd["sessions_done"]:.2f}× more'),
    ('Revenue (60 min)', 'higher is better', REV['dyn'], REV['ours'], '${:,.0f}',
     f'{REV["ours"] / REV["dyn"]:.2f}× higher'),
    ('User cost per agent step', 'lower is better', CPS['dyn'], CPS['ours'], '${:.3f}',
     f'{(1 - CPS["ours"] / CPS["dyn"]) * 100:.0f}% lower'),
    ('Time per agent step (LLM call + tool)', 'lower is better', fd['step_s'], fo['step_s'], '{:.0f} s',
     f'{fd["step_s"] / fo["step_s"]:.1f}× faster'),
    ('P95 time to first token', 'lower is better', fd['ttft_p95'], fo['ttft_p95'], '{:.0f} s',
     f'{fd["ttft_p95"] / fo["ttft_p95"]:.1f}× lower'),
    ('Mean end-to-end latency per LLM call', 'lower is better', fd['e2e_mean'], fo['e2e_mean'], '{:.0f} s',
     f'{fd["e2e_mean"] / fo["e2e_mean"]:.1f}× lower'),
]
BX0, BLEN, BH = 0.42, 0.36, 0.030
CARD_BARS = []   # (rect, final_width, start_frame)
for r_i, (lab, sub, vd, vo, fmt, rtxt) in enumerate(ROWS_CARD):
    yc = 0.672 - r_i * 0.093
    ap0 = 8 + 5 * r_i
    card_text(0.12, yc + 0.016, lab, appear=ap0, ha='left', va='center', fontsize=18, weight='bold', color=INK)
    card_text(0.12, yc - 0.022, sub, appear=ap0, ha='left', va='center', fontsize=13, color=MUTED)
    vmax = max(vd, vo)
    for v, c, dy in ((vd, C_DYN, +0.019), (vo, C_OURS, -0.019)):
        wfin = BLEN * v / vmax
        rect = Rectangle((BX0, yc + dy - BH / 2), 0.0, BH, transform=fig.transFigure, fc=c, ec='none', zorder=60,
                         visible=False)
        fig.add_artist(rect)
        CARD_BARS.append((rect, wfin, ap0))
        card_text(BX0 + wfin + 0.008, yc + dy, fmt.format(v), appear=ap0 + 14, ha='left', va='center', fontsize=16,
                  weight='bold', color=c)
    card_text(0.905, yc, rtxt, appear=ap0 + 16, ha='center', va='center', fontsize=21, weight='bold', color=C_OURS)
card_text(0.5, 0.150, 'Revenue and user cost at the GLM-5.2 list price: $1.40 per 1M input tokens ($0.26 if cached), '
                      '$4.40 per 1M output tokens', appear=34, ha='center', va='center', fontsize=13, color=MUTED)
card_text(0.5, 0.112, f'Time per agent step = 126 agents × 60 min ÷ LLM calls completed '
                      f'(Dynamo {fd["n"]:,}, Evolving Infra {fo["n"]:,})  ·  latencies measured at the client',
          appear=34, ha='center', va='center', fontsize=13, color=MUTED)

NODE_STYLE = {'P': dict(fc='#2f3640', ec='#2f3640', lw=0, ls='-', hatch=None, tc='white', fs=16),
              'D': dict(fc='#cbd3dd', ec='#cbd3dd', lw=0, ls='-', hatch=None, tc=INK, fs=16),
              'S': dict(fc='white', ec='#7c8696', lw=1.2, ls='-', hatch='////', tc=INK, fs=11),
              'R': dict(fc='white', ec='#9aa5b1', lw=1.6, ls='--', hatch=None, tc=C_OFF, fs=10.5)}


# ---------------------------------------------------------------- per-frame drawing
def frame_info(i):
    if i < INTRO:
        return 0, 'intro', i
    j = i - INTRO
    if j < NT:
        return j, 'run', j
    j -= NT
    if j < FREEZE:
        return NT - 1, 'freeze', j
    j -= FREEZE
    if j < FADE:
        return NT - 1, 'fade', j
    return NT - 1, 'card', j - FADE


def draw_panel(arm, k, t, i, mode):
    P = PANELS[arm]
    pre = PRE[arm]
    st_row, pip_row = pre['st'][k], pre['pips'][k]
    for idx in range(NSLOT):
        tile = P['tiles'][idx]
        s = int(st_row[idx])
        if tile[3] != s:
            fc, bc, g, gc = TILE[s]
            tile[0].set_facecolor(fc); tile[1].set_facecolor(bc)
            tile[2].set_text(g); tile[2].set_color(gc)
            tile[3] = s
        pr = P['pips'][idx]
        n = int(pip_row[idx])
        if pr[1] != n:
            for j, e in enumerate(pr[0]):
                e.set_visible(j < n)
            pr[1] = n
    P['callout'].set_visible(i < INTRO + 45)
    P['sess'].set_text(f'{int(pre["sess"][k]):,}')
    P['steps'].set_text(f'${pre["rev"][k]:,.0f}')
    cps = pre['cps'][k]
    P['cps'].set_text('–' if np.isnan(cps) else f'${cps:.3f}')
    p95 = pre['p95'][k]
    P['p95'].set_text('–' if np.isnan(p95) else f'{p95:.0f} s')

    raw, rem = NODES[arm](t)
    states = sorted(raw, key=lambda x: ORDER[x])
    n_p, n_d = states.count('P'), states.count('D')
    n_s, n_r = states.count('S'), states.count('R')
    P['split'].set_text(f'{n_p}P · {n_d}D')
    extra = []
    if n_r:
        extra.append(f'+{n_r} offline')
    if n_s:
        extra.append(f'+{n_s} {"draining" if arm == "dyn" else "switching"}')
    P['extra'].set_text('  '.join(extra))
    P['extra'].set_color(C_OFF if n_r else MUTED)
    for b, lab, s in zip(P['boxes'], P['nlabels'], states):
        ns = NODE_STYLE[s]
        b.set_facecolor(ns['fc']); b.set_edgecolor(ns['ec']); b.set_linewidth(ns['lw'])
        b.set_linestyle(ns['ls']); b.set_hatch(ns['hatch'])
        if s == 'R':
            txt = f'offline\n{mmss(rem if rem is not None else 0)}'
        elif s == 'S':
            txt = S_LABEL[arm]
        else:
            txt = s
        lab.set_text(txt); lab.set_color(ns['tc']); lab.set_fontsize(ns['fs'])
        lab.set_bbox(dict(boxstyle='round,pad=0.15', fc='white', ec='none') if s == 'S' else None)
    # pulse a frame around our strip during each in-place switch (>= 3 s of video)
    if arm == 'ours':
        on = False
        for s0, s1, _f, _t in OURS_SW:
            if mode == 'run' and s0 <= t < max(s1, s0 + 180.0):
                on = True
                ph = (t - s0) / 60.0
                P['hl'].set_alpha(0.35 + 0.65 * abs(math.sin(math.pi * ph)))
        P['hl'].set_visible(False)   # user: do not frame our method


def draw_charts(k):
    m = MINS[k]
    cd, co = PRE['dyn']['sess'], PRE['ours']['sess']
    l_dyn.set_data(MINS[:k + 1], cd[:k + 1]); l_ours.set_data(MINS[:k + 1], co[:k + 1])
    rd, ro = PRE['dyn']['steps'], PRE['ours']['steps']
    r_dyn.set_data(MINS[:k + 1], rd[:k + 1]); r_ours.set_data(MINS[:k + 1], ro[:k + 1])
    for rect, am, bm in BANDS:
        if m <= am:
            rect.set_visible(False)
        else:
            rect.set_visible(True); rect.set_width(min(m, bm) - am)
    for art, m0 in SWMARK:
        art.set_visible(m >= m0)
    # cumulative end labels + ratio bracket
    yd, yo = float(cd[k]), float(co[k])
    lo, hi = place_pair(min(yd, yo), max(yd, yo), 14.0, 0.0)
    yd_l, yo_l = (lo, hi) if yo >= yd else (hi, lo)
    e_dyn.set_position((m + 0.6, yd_l)); e_dyn.set_text(f'{int(cd[k]):,}')
    e_ours.set_position((m + 0.6, yo_l)); e_ours.set_text(f'{int(co[k]):,}')
    xb = m + 4.0
    if co[k] > cd[k]:
        bracket.set_data([xb - 0.5, xb, xb, xb - 0.5], [yd, yd, yo, yo])
        bracket.set_visible(True)
        ratio_t.set_position((xb + 0.7, (yd + yo) / 2.0))
        ratio_t.set_text(f'×{float(co[k]) / float(cd[k]):.2f}' if cd[k] >= 12 else f'+{int(co[k] - cd[k])}')
        ratio_t.set_visible(True)
    else:
        bracket.set_visible(False); ratio_t.set_visible(False)
    # cumulative LLM-call end labels (same label gap as v10d: 10.7% of the y range)
    lo, hi = place_pair(float(min(rd[k], ro[k])), float(max(rd[k], ro[k])), 0.107 * YMAX_R, 0.0)
    a_d, a_o = (lo, hi) if ro[k] >= rd[k] else (hi, lo)
    er_dyn.set_position((m + 0.6, a_d)); er_dyn.set_text(f'{int(rd[k]):,}')
    er_ours.set_position((m + 0.6, a_o)); er_ours.set_text(f'{int(ro[k]):,}')


_last_live = [None]


def draw(i):
    k, mode, j = frame_info(i)
    t = TIMES[k]
    if mode != 'card' or _last_live[0] != k:
        clock.set_text(mmss(t - W0))
        for arm in PANELS:
            draw_panel(arm, k, t, i, mode)
        draw_charts(k)
        txt = beat_text(k, t, mode)
        leg_on = txt == '@legend'
        caption.set_text('' if leg_on else txt); caption.set_visible(bool(txt) and not leg_on)
        for a in INTRO_LEG:
            a.set_visible(leg_on)
        _last_live[0] = k
    # overlay + end card
    if mode in ('fade', 'card'):
        overlay.set_visible(True)
        overlay.set_alpha(ease_out((j + 1) / FADE) if mode == 'fade' else 1.0)
    else:
        overlay.set_visible(False)
    show = mode == 'card'
    for art, ap0 in CARD_ARTS:
        if show and j >= ap0:
            art.set_visible(True); art.set_alpha(ease_out((j - ap0 + 1) / 8.0))
        else:
            art.set_visible(False)
    for rect, wfin, ap0 in CARD_BARS:
        if show and j >= ap0:
            rect.set_visible(True); rect.set_width(wfin * ease_out((j - ap0 + 1) / 15.0))
        else:
            rect.set_visible(False)
    return []


if args.preview:
    # v11: icon legend (intro), icons at 05:00, the check-mark caption (11:30), the poster frame (35:00), 60:00
    picks = [0,                                   # intro, icon legend
             INTRO + int(300 / STEP),             # 05:00
             INTRO + int(690 / STEP),             # 11:30, 'Each check mark on a window ...'
             INTRO + int(2100 / STEP),            # 35:00 = frame 1095, the poster of the demo page and site
             INTRO + NT - 1]                      # last data frame (60:00)
    if args.frames:                               # e.g. 1095 = 35:00, the poster frame of the demo page and site
        picks = [int(x) for x in args.frames.split(',')]
    for i in picks:
        draw(i)
        fig.savefig(out / f'preview-{i:04d}.png', dpi=100, facecolor=BG)
        print('saved', i, frame_info(i)[:2], flush=True)
    print('preview done')
else:
    plt.rcParams['animation.ffmpeg_path'] = args.ffmpeg
    writer = animation.FFMpegWriter(fps=FPS, codec='libx264', bitrate=6000,
                                    extra_args=['-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20'])
    with writer.saving(fig, str(out / 'evolving-infra-vs-dynamo-cc126.mp4'), dpi=100):
        for i in range(TOTAL):
            draw(i)
            writer.grab_frame()
            if i % 300 == 0:
                print('frame', i, '/', TOTAL, flush=True)
    print('video done')
