#!/usr/bin/env python3
"""Plot unmodified before/after generator candles with identical axes.

Every visual is an offline simulation chart, never a browser screenshot.
Usage: python3 scripts/qa-simulation-natural-wicks.py [evidence-directory]
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'docs/qa/simulation-natural-wicks'
BEFORE = json.loads((OUT / 'before.json').read_text())
AFTER = json.loads((OUT / 'after.json').read_text())
cycle_windows = [(int(datetime.fromisoformat(episode['startUtc'].replace('Z', '+00:00')).timestamp() * 1000),
                  int(datetime.fromisoformat(episode['endUtc'].replace('Z', '+00:00')).timestamp() * 1000))
                 for episode in AFTER['cycleEpisodes']]
BACKGROUND, GRID, TEXT = '#080b10', '#28313d', '#dce6ef'
UP, DOWN, CHANGED = '#e7edf2', '#efa925', '#5ac8e8'
plt.rcParams.update({
    'font.family': 'DejaVu Sans', 'font.size': 10,
    'figure.facecolor': BACKGROUND, 'axes.facecolor': BACKGROUND,
    'savefig.facecolor': BACKGROUND, 'text.color': TEXT,
    'axes.labelcolor': TEXT, 'xtick.color': '#9aaabd', 'ytick.color': '#9aaabd',
    'axes.edgecolor': GRID, 'axes.titlecolor': TEXT,
})


def shadows(candle):
    body = abs(candle['close'] - candle['open'])
    upper = candle['high'] - max(candle['open'], candle['close'])
    lower = min(candle['open'], candle['close']) - candle['low']
    return body, max(0.0, upper), max(0.0, lower)


def quantiles(values):
    if not values:
        return None
    return dict(zip(['min', 'p10', 'p25', 'median', 'p75', 'p90', 'max'],
                    [float(v) for v in np.quantile(values, [0, .1, .25, .5, .75, .9, 1])]))


def statistics(candles):
    ratios, percentages, shares, asymmetry = [], [], [], []
    dominance = {'lowerDominant': 0, 'twoSided': 0, 'upperDominant': 0, 'noWick': 0}
    ratio_bins = [0, 0, 0, 0, 0, 0]
    zero_bodies = 0
    for candle in candles:
        body, upper, lower = shadows(candle)
        total = upper + lower
        percentages.append(total / candle['open'] * 100)
        if body > max(1e-14, candle['open'] * 1e-10):
            ratio = total / body
            ratios.append(ratio)
            ratio_bins[sum(ratio > limit for limit in [.25, .5, 1, 2, 5])] += 1
        else:
            zero_bodies += 1
        if total > 0:
            share = upper / total
            shares.append(share)
            asymmetry.append((upper - lower) / total)
            dominance['lowerDominant' if share < 1 / 3 else 'upperDominant' if share > 2 / 3 else 'twoSided'] += 1
        else:
            dominance['noWick'] += 1
    return {
        'candles': len(candles), 'zeroBodyExcludedFromRatio': zero_bodies,
        'totalWickToBody': quantiles(ratios), 'totalWickPercentOfOpen': quantiles(percentages),
        'upperShareOfTotalWick': quantiles(shares), 'signedWickAsymmetry': quantiles(asymmetry),
        'wickDominance': dominance,
        'wickToBodyHistogram': dict(zip(['0–0.25', '0.25–0.5', '0.5–1', '1–2', '2–5', '>5'], ratio_bins)),
    }


def compare(old, new):
    a, b = old['candles15m'], new['candles15m']
    assert len(a) == len(b), f"Candle count changed: {old['id']}"
    changed, upper_only, lower_only, both = [], 0, 0, 0
    extended_upper = extended_lower = contracted_upper = contracted_lower = 0
    for before, after in zip(a, b):
        for key in ['openTime', 'open', 'close', 'volume', 'quoteVolume']:
            assert before[key] == after[key], f"Unexpected {key} change: {old['id']} {before['openTime']}"
        upper = before['high'] != after['high']
        lower = before['low'] != after['low']
        if upper or lower:
            changed.append(before['openTime'])
            upper_only += upper and not lower
            lower_only += lower and not upper
            both += upper and lower
        extended_upper += after['high'] > before['high']
        extended_lower += after['low'] < before['low']
        contracted_upper += after['high'] < before['high']
        contracted_lower += after['low'] > before['low']
    for key in ['canonical5mOpenCloseVolumeSha256', 'canonical1mOpenCloseVolumeSha256', 'last500CanonicalTradesSha256', 'finalPrice']:
        assert old['invariantEvidence'][key] == new['invariantEvidence'][key], f"Invariant changed: {old['id']} {key}"
    protected = sum(any(start <= candle['openTime'] < end for start, end in cycle_windows) for candle in a) if old['configuration'].get('cyclicImpulse') else 0
    return {
        'id': old['id'], 'label': old['label'], 'count': len(a),
        'startUtc': old['startUtc'], 'endExclusiveUtc': old['endExclusiveUtc'],
        'changedCandles': len(changed), 'changedPercent': len(changed) / len(a) * 100,
        'changedOpenTimes': changed, 'upperOnly': upper_only, 'lowerOnly': lower_only, 'bothSides': both,
        'protectedCycleCandles': protected, 'ordinaryCandles': len(a) - protected,
        'extendedUpper': extended_upper, 'extendedLower': extended_lower,
        'contractedUpper': contracted_upper, 'contractedLower': contracted_lower,
        'openCloseVolumeInvariant': True,
        'oneMinuteOpenCloseVolumeInvariant': True, 'last500CanonicalTradesInvariant': True,
        'before': statistics(a), 'after': statistics(b),
    }


old_cases = {case['id']: case for case in BEFORE['cases']}
new_cases = {case['id']: case for case in AFTER['cases']}
assert old_cases.keys() == new_cases.keys(), 'Before/after fixture matrix differs'
comparisons = {key: compare(old_cases[key], new_cases[key]) for key in old_cases}
assert BEFORE['cycleEpisodes'] == AFTER['cycleEpisodes'], 'An exact cyclic episode changed'
cycle_count = len(AFTER['cycleEpisodes'])
fingerprint_before = BEFORE['generation']['sourceFingerprint']
fingerprint_after = AFTER['generation']['sourceFingerprint']


def stamp(ms, long=False):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%d %b %H:%M' if long else '%d %b\n%H:%M')


def panel(ax, candles, title, limits, changed_times=(), protect_cycles=False):
    changed_times = set(changed_times)
    low, high = limits
    if protect_cycles:
        for start, end in cycle_windows:
            indices = [index for index, candle in enumerate(candles) if start <= candle['openTime'] < end]
            if indices:
                ax.axvspan(min(indices) - .5, max(indices) + .5, color='#aa885c', alpha=.075, zorder=0)
    for index, candle in enumerate(candles):
        color = UP if candle['close'] >= candle['open'] else DOWN
        ax.vlines(index, candle['low'], candle['high'], color=color, linewidth=1.1, zorder=2)
        body_low = min(candle['open'], candle['close'])
        body_size = abs(candle['close'] - candle['open'])
        if body_size:
            ax.add_patch(Rectangle((index - .29, body_low), .58, body_size,
                                   facecolor=color, edgecolor=color, linewidth=.65, zorder=3))
        else:
            ax.hlines(body_low, index - .29, index + .29, color=color, linewidth=1, zorder=3)
        if candle['openTime'] in changed_times:
            ax.plot(index, .016, marker='|', markersize=5, color=CHANGED,
                    transform=ax.get_xaxis_transform(), clip_on=True)
    ax.set_xlim(-1, len(candles))
    ax.set_ylim(low, high)
    ticks = np.unique(np.linspace(0, len(candles) - 1, min(8, len(candles)), dtype=int))
    ax.set_xticks(ticks, [stamp(candles[index]['openTime']) for index in ticks])
    ax.yaxis.tick_right()
    ax.yaxis.set_label_position('right')
    ax.set_ylabel('Price · USDT', labelpad=13)
    ax.ticklabel_format(axis='y', style='plain', useOffset=False)
    ax.grid(axis='y', color=GRID, alpha=.42, linewidth=.55)
    ax.set_axisbelow(True)
    ax.set_title(title, loc='left', fontsize=11, pad=12)
    ax.spines[['top', 'left']].set_visible(False)


def common_limits(before, after):
    low = min(c['low'] for c in [*before, *after])
    high = max(c['high'] for c in [*before, *after])
    padding = max((high - low) * .075, high * .003)
    return max(0, low - padding), high + padding


def footer(fig):
    fig.text(.04, .018,
             f"OFFLINE SIMULATION  ·  Before {fingerprint_before[:10]}  →  After {fingerprint_after[:10]}  ·  Source fingerprints identify data revisions",
             fontsize=8, color='#96a9bd')


def pair_figure(case_id, filename, title, start=0, end=None):
    old = old_cases[case_id]['candles15m'][start:end]
    new = new_cases[case_id]['candles15m'][start:end]
    changed = set(comparisons[case_id]['changedOpenTimes'])
    visible_changed = sum(c['openTime'] in changed for c in old)
    limits = common_limits(old, new)
    fig, axes = plt.subplots(2, 1, figsize=(18, 10.5), dpi=130)
    fig.subplots_adjust(top=.865, bottom=.1, left=.045, right=.925, hspace=.32)
    fig.suptitle(title, x=.045, y=.965, ha='left', fontsize=21, fontweight='bold')
    fig.text(.045, .925,
             f"15-minute candles · {stamp(old[0]['openTime'], True)} — {stamp(old[-1]['openTime'] + 900000, True)} UTC · {len(old)} closed candles",
             fontsize=11, color='#a9b9c8')
    fig.text(.045, .893,
             f"Identical axes · Exact OHLC · {visible_changed}/{len(old)} ranges revised · Cyan marks revisions · Shading: protected cyclic episode",
             fontsize=10, color=CHANGED)
    panel(axes[0], old, 'BEFORE · Released generator at d2e98bb', limits, protect_cycles=case_id.startswith('vta-'))
    panel(axes[1], new, 'AFTER · Candidate generator; open, close and volume preserved', limits, changed, protect_cycles=case_id.startswith('vta-'))
    footer(fig)
    fig.savefig(OUT / filename)
    plt.close(fig)


pair_figure('vta-history', 'history-full-15m.png', 'VTA · entire closed history since listing')
history_count = comparisons['vta-history']['count']
pair_figure('vta-history', 'history-zoom-early-15m.png', 'VTA · early history detail', 0, 24)
middle = (history_count - 24) // 2
pair_figure('vta-history', 'history-zoom-middle-15m.png', 'VTA · middle history detail', middle, middle + 24)
pair_figure('vta-history', 'history-zoom-recent-15m.png', 'VTA · most recent closed history', -24)
pair_figure('vta-future', 'future-vta-15m.png', 'VTA · fixed 24-hour future simulation')

profile_ids = [key for key in old_cases if key.startswith('profile-')]
for limit, filename, title, hours in [
    (None, 'future-profiles-15m.png', 'New simulated listings · four profile variants', 24),
    (24, 'future-profiles-detail-15m.png', 'New simulated listings · wick detail in all four profiles', 6),
]:
    fig, axes = plt.subplots(len(profile_ids), 2, figsize=(21, 15), dpi=125)
    fig.subplots_adjust(top=.9, bottom=.075, left=.025, right=.955, hspace=.6, wspace=.14)
    fig.suptitle(title, x=.025, y=.975, ha='left', fontsize=22, fontweight='bold')
    fig.text(.025, .945, f'15m · First {hours} hours from 1 Oct 2026 00:00 UTC · Same seed and price · Before: legacy; after: new-listing NATURAL_V1', fontsize=11, color='#a9b9c8')
    fig.text(.025, .921, 'Each before/after pair uses identical axes; each profile keeps its original candle bodies. Cyan marks revised ranges.', fontsize=10, color=CHANGED)
    for row, key in enumerate(profile_ids):
        old, new = old_cases[key]['candles15m'][:limit], new_cases[key]['candles15m'][:limit]
        profile = old_cases[key]['configuration']['simulationProfile']
        count = sum(candle['openTime'] in comparisons[key]['changedOpenTimes'] for candle in old)
        limits = common_limits(old, new)
        panel(axes[row, 0], old, f'{profile} · BEFORE', limits)
        panel(axes[row, 1], new, f'{profile} · AFTER · {count}/{len(new)} revised', limits, comparisons[key]['changedOpenTimes'])
    footer(fig)
    fig.savefig(OUT / filename)
    plt.close(fig)

history = comparisons['vta-history']
fig, axes = plt.subplots(1, 2, figsize=(17, 6.3), dpi=135)
fig.subplots_adjust(top=.75, bottom=.17, left=.06, right=.97, wspace=.23)
fig.suptitle('VTA · measured wick variation in 95 closed 15m candles', x=.06, y=.94, ha='left', fontsize=20, fontweight='bold')
fig.text(.06, .87, 'Ratios use actual OHLC. Wick = high − max(open, close) + min(open, close) − low. Body = |close − open|.', fontsize=10, color='#a9b9c8')
for ax, field, labels, keys, subtitle in [
    (axes[0], 'wickToBodyHistogram', ['≤0.25', '0.25–0.5', '0.5–1', '1–2', '2–5', '>5'], list(history['before']['wickToBodyHistogram']), 'Total wick / body'),
    (axes[1], 'wickDominance', ['Lower dominant', 'Two-sided', 'Upper dominant', 'No wick'], ['lowerDominant', 'twoSided', 'upperDominant', 'noWick'], 'Dominance: one side exceeds twice the other'),
]:
    positions = np.arange(len(labels))
    for shift, stage, color in [(-.19, 'before', '#71849a'), (.19, 'after', CHANGED)]:
        values = [history[stage][field][key] for key in keys]
        bars = ax.bar(positions + shift, values, .36, label=stage.title(), color=color)
        ax.bar_label(bars, color=TEXT, padding=3, fontsize=9)
    ax.set_xticks(positions, labels)
    ax.set_title(subtitle, loc='left', fontsize=12, pad=16)
    ax.set_ylabel('Candle count')
    ax.grid(axis='y', color=GRID, alpha=.5)
    ax.set_axisbelow(True)
    ax.margins(y=.17)
    ax.spines[['top', 'right']].set_visible(False)
axes[0].legend(frameon=False)
footer(fig)
fig.savefig(OUT / 'wick-distribution-15m.png')
plt.close(fig)

metrics = {
    'schema': 'voltex-natural-wicks-comparison-v1',
    'evidenceKind': BEFORE['evidenceKind'],
    'beforeSourceFingerprint': fingerprint_before, 'afterSourceFingerprint': fingerprint_after,
    'requestCutoffUtc': BEFORE['requestCutoffUtc'], 'cases': list(comparisons.values()),
    'cycleEpisodesCompared': cycle_count, 'cycleEpisodesExactlyUnchanged': True,
    'formulas': {
        'totalWickToBody': '(high − max(open,close) + min(open,close) − low) / abs(close − open); zero bodies excluded',
        'upperShareOfTotalWick': 'upper / (upper + lower)',
        'signedWickAsymmetry': '(upper − lower) / (upper + lower); −1 lower-only, +1 upper-only',
        'dominance': 'upper/lower dominant only when that side exceeds twice the other; otherwise two-sided',
        'changed': 'The actual 15m high or low differs. Open, close, volume and quoteVolume must remain exactly equal.',
    },
}
(OUT / 'metrics.json').write_text(json.dumps(metrics, indent=2) + '\n')

def number(value):
    return f'{value:.3f}'

rows = []
for case in comparisons.values():
    before, after = case['before'], case['after']
    rows.append(f"| {case['label']} | {case['changedCandles']}/{case['count']} ({case['changedPercent']:.1f}%) | {case['upperOnly']} / {case['lowerOnly']} / {case['bothSides']} | {number(before['totalWickToBody']['median'])} → {number(after['totalWickToBody']['median'])} | {number(before['totalWickToBody']['p90'])} → {number(after['totalWickToBody']['p90'])} |")

readme = f'''# Natural simulation wicks — actual-generator comparison

This is an **offline deterministic simulation preview**, computed directly from the baseline and candidate TypeScript generator. These PNGs are plots of raw generator data, not browser screenshots, venue BTC data, or proof of deployment. No candles, prices, trades, balances, or market state were written by this QA.

## Data revisions and fixed comparison

- Before: `{BEFORE['generation']['revision']}`; source fingerprint `{fingerprint_before}`.
- After: `{AFTER['generation']['revision']}`; source fingerprint `{fingerprint_after}`.
- The source-file SHA-256 maps, exact configurations and raw 15m/5m OHLCV are in `before.json` and `after.json`.
- VTA history begins at **2026-09-28 15:00 UTC** and ends at the fixed request cutoff **2026-09-29 14:45 UTC**: **95 completed 15m candles**. A candle beginning at the cutoff is excluded from this historical comparison.
- The future VTA sample is the next 24 hours. Four new-listing fixtures use the actual `listingSimulationConfig` mapper, a shared seed/initial price, and listing time **2026-10-01 00:00 UTC**. The before fixtures omit a wick model; candidate fixtures explicitly carry **`wickModel: 'NATURAL_V1'`**, the persisted opt-in assigned to a newly created listing. Existing stored listings without that opt-in are a separate runtime regression case. Each profile sample contains 96 completed 15m candles.
- All figures retain **identical price and time axes for each before/after pair**. Wick height is not enlarged in the renderer; candle bodies, shadows and prices come directly from JSON.

## Measured changes

| Actual generator sample | Changed 15m candles | Upper only / lower only / both | Median total wick/body, before → after | 90th percentile, before → after |
|---|---:|---:|---:|---:|
{chr(10).join(rows)}

For VTA historical candles, lower-dominant / two-sided / upper-dominant counts changed from **{history['before']['wickDominance']['lowerDominant']} / {history['before']['wickDominance']['twoSided']} / {history['before']['wickDominance']['upperDominant']}** to **{history['after']['wickDominance']['lowerDominant']} / {history['after']['wickDominance']['twoSided']} / {history['after']['wickDominance']['upperDominant']}**. Dominant means one wick exceeds twice the other. These counts and the distribution plot distinguish variation in sides and lengths from a uniform multiplier.

The historical sample contains **{history['ordinaryCandles']} ordinary candles** and **{history['protectedCycleCandles']} protected cyclic-episode candles**: the revision changes **{history['changedCandles']}/{history['ordinaryCandles']} ordinary candles**. In the future VTA sample, **{comparisons['vta-future']['changedCandles']}/{comparisons['vta-future']['ordinaryCandles']} ordinary candles** change; the other **{comparisons['vta-future']['protectedCycleCandles']} candles** belong to protected shock/recovery episodes. The corresponding chart regions are lightly shaded.

`metrics.json` contains full quantiles, signed asymmetry, histogram bins, every changed opening timestamp, and separate upper/lower extensions or contractions. Total wick/body uses `abs(close − open)` as the denominator; zero-body candles are excluded from that ratio and counted separately. No clipping is applied to the recorded ratios.

## Preserved values checked during capture and comparison

- Every compared 15m **open, close, volume and quoteVolume** matches exactly.
- Full 1m and 5m open/close/volume fingerprints match for all six samples.
- The final price and last 500 canonical trades of each sample match exactly. This is explicitly a tape sample; full tick invariants are covered by the runtime regression suite.
- **All {cycle_count} six-hour shock/recovery episodes have exactly unchanged hourly OHLCV, schedules and presets.**
- Every captured 1m, 5m and 15m candle is finite, positive and encloses its open/close within low/high.

## Visual files

| File | Scope |
|---|---|
| `history-full-15m.png` | All 95 historical VTA candles, identical before/after axes |
| `history-zoom-early-15m.png` | First 24 candles |
| `history-zoom-middle-15m.png` | Mechanically centered 24-candle segment |
| `history-zoom-recent-15m.png` | Last 24 completed candles, including the existing shock/recovery |
| `future-vta-15m.png` | Fixed next 24-hour VTA simulation |
| `future-profiles-15m.png` | All four future listing profiles, 24 hours each |
| `future-profiles-detail-15m.png` | First six hours of each profile on closer identical before/after axes |
| `wick-distribution-15m.png` | Wick/body histogram and upper/lower dominance counts |

The two owner-supplied BTC 15m images were inspected as **qualitative morphology references**: mixed body sizes, varied upper/lower shadows, occasional rejection wicks, and many short-wick candles. Their OHLC data is unavailable here, so this report does not invent a statistical BTC benchmark or claim a numerical match to those screenshots. VTA's price path is intentionally preserved; its full-history vertical range remains different from the reference market.

## Reproduce

Use Node 24+, Python 3, NumPy and Matplotlib. Start with a separate checkout of the before revision so capture runs against its actual source files, with the same installed Node dependencies available there.

```bash
node scripts/qa-simulation-natural-wicks.mjs --stage before --source-root /path/to/d2e98bb-checkout --revision d2e98bb083d11ba128b72abab7b1618a4b4c1399
node scripts/qa-simulation-natural-wicks.mjs --stage after --revision candidate-working-tree
python3 scripts/qa-simulation-natural-wicks.py
```

The capture aborts if any loaded generator source changes while producing its output. The comparison aborts on a changed body/volume fingerprint, tape sample, final price, invalid candle, or changed cyclic episode. Browser rendering, request budgets and deployment verification are separate checks.
'''
(OUT / 'README.md').write_text(readme)
print(json.dumps({'output': str(OUT), 'figures': 8,
                  'historyChanged': history['changedCandles'], 'historyCount': history['count'],
                  'cycleEpisodesUnchanged': cycle_count,
                  'cases': [{'id': c['id'], 'changed': c['changedCandles'], 'count': c['count']} for c in comparisons.values()]}, indent=2))
