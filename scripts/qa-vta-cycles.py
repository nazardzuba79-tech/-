#!/usr/bin/env python3
"""Render only OHLC emitted by qa-vta-cycles.mjs; never synthesize candles."""
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch, Rectangle
from matplotlib.ticker import FixedLocator, FuncFormatter, NullLocator
from PIL import Image

data_path = Path(sys.argv[1]).resolve()
data = json.loads(data_path.read_text())
out = data_path.parent
episodes = data["episodes"]
config = data["generation"]["configuration"]
colors = {"paper": "#FAF9F5", "ink": "#23302E", "muted": "#63706D",
          "grid": "#DEE3DF", "up": "#168575", "down": "#D34C59"}
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11,
    "figure.facecolor": colors["paper"], "axes.facecolor": colors["paper"],
    "text.color": colors["ink"], "axes.labelcolor": colors["muted"],
    "xtick.color": colors["muted"], "ytick.color": colors["muted"],
    "axes.edgecolor": colors["grid"], "savefig.facecolor": colors["paper"],
})
names = {
    "deep-flush": "Глибокий скид", "fast-rejection": "Швидкий відкуп",
    "double-dip": "Подвійне дно", "late-flush": "Пізній скид",
    "shallow-grind": "Плавне зниження", "capitulation-rebound": "Різкий розворот",
    "stepped-recovery": "Відкуп сходинками", "deep-retest": "Глибокий ретест",
    "brief-dislocation": "Короткий провал", "delayed-reclaim": "Відкладений відкуп",
}

def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def from_ms(value):
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)

def pct(value, decimals=1, signed=False):
    text = f"{value:+.{decimals}f}" if signed else f"{value:.{decimals}f}"
    return text.replace("-", "−") + "%"

def draw_candle(ax, x, candle, width=0.36, linewidth=2.4):
    opened, high, low, closed = (candle[k] for k in ("open", "high", "low", "close"))
    color = colors["up"] if closed >= opened else colors["down"]
    ax.vlines(x, low, high, color=color, linewidth=linewidth, zorder=4)
    if closed == opened:
        ax.hlines(opened, x - width / 2, x + width / 2, color=color, linewidth=linewidth, zorder=5)
    else:
        ax.add_patch(Rectangle((x - width / 2, min(opened, closed)), width,
                               abs(closed - opened), facecolor=color, edgecolor=color,
                               linewidth=0.5, zorder=5))

def clean_axis(ax):
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.tick_params(axis="both", length=0, pad=7)
    ax.grid(axis="y", color=colors["grid"], linewidth=0.6, zorder=0)

def save_compact(fig, path):
    fig.savefig(path, dpi=180)
    # Compact palette affects raster encoding only; the plotted geometry and
    # data remain unchanged. All evidence is also available as raw JSON.
    with Image.open(path) as source:
        compact = source.convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    compact.save(path, optimize=True, compress_level=9)

fig, axes = plt.subplots(2, 5, figsize=(17.5, 10.3))
fig.subplots_adjust(left=0.055, right=0.985, bottom=0.195, top=0.81, hspace=0.90, wspace=0.22)
fig.text(0.055, 0.958, "VTA · 10 варіантів імпульсу та відкупу", fontsize=25, weight="bold")
fig.text(0.055, 0.915, "ПРЕВ’Ю СИМУЛЯЦІЇ  ·  кожен епізод — дві 1h свічки  ·  початок кожні 6 годин  ·  UTC",
         fontsize=11.8, color=colors["muted"])
fig.text(0.055, 0.877, "Відкриття кожного епізоду = 100. Спільна шкала показує різницю тіл і тіней.", fontsize=11.4)
all_candles = [c for ep in episodes for c in ep["normalizedCandles1h"]]
ymin = 25 * math.floor(min(c["low"] for c in all_candles) / 25) - 5
ymax = 25 * math.ceil(max(c["high"] for c in all_candles) / 25) + 5
for ax, ep in zip(axes.flat, episodes):
    for i, candle in enumerate(ep["normalizedCandles1h"]):
        draw_candle(ax, i, candle)
    clean_axis(ax)
    ax.axhline(100, color="#869490", linewidth=0.9, linestyle=(0, (4, 4)), zorder=1)
    ax.set_ylim(ymin, ymax)
    ax.set_xlim(-0.67, 1.67)
    ax.set_yticks(list(range(math.ceil(ymin / 25) * 25, math.floor(ymax / 25) * 25 + 1, 25)))
    ax.tick_params(labelsize=9.8)
    ax.set_xticks([0, 1], ["Падіння", "Відновлення"])
    if (ep["number"] - 1) % 5:
        ax.tick_params(labelleft=False)
    label = names.get(ep["preset"]["name"], ep["preset"]["name"])
    ax.text(0.5, 1.20, f"{ep['number']:02d}  {label}", transform=ax.transAxes,
            ha="center", va="bottom", fontsize=11.6, weight="bold")
    ax.text(0.5, 1.07, moment(ep["startUtc"]).strftime("%d.%m · %H:%M UTC"), transform=ax.transAxes,
            ha="center", va="bottom", fontsize=10.2, color=colors["muted"])
    m = ep["metrics"]
    ax.text(0.5, -0.25, f"Мін. {pct(m['shockLowFromOpenPercent'])}  ·  закр. {pct(m['shockCloseFromOpenPercent'])}",
            transform=ax.transAxes, ha="center", fontsize=10.1)
    ax.text(0.5, -0.39, f"Ріст {pct(m['recoveryCloseFromItsOpenPercent'], signed=True)}  ·  тінь {pct(m['recoveryUpperWickBeyondBodyPercent'])}",
            transform=ax.transAxes, ha="center", fontsize=10.1, color=colors["muted"])

cutoff = from_ms(config["cyclicImpulse"]["notBefore"]).strftime("%d.%m %H:%M:%S UTC")
fig.text(0.055, 0.084, f"Перший епізод зберігає попередні тики до {cutoff}; новий рух починається після цієї межі.",
         fontsize=10.6, color=colors["muted"])
fig.text(0.055, 0.055, "«Ріст» — зміна другої свічки від її власного відкриття; «тінь» — максимум понад верх тіла другої свічки.",
         fontsize=10.6, color=colors["muted"])
fig.text(0.055, 0.026, "Джерело: фактичний TestMarketSimulation → канонічні 5m → 1h. Це офлайн симуляція, не спостереження живого ринку.",
         fontsize=10.6, color=colors["muted"])
ten_path = out / "vta-ten-scenarios.png"
save_compact(fig, ten_path)
plt.close(fig)

seq = data["sequence24h"]
fig, ax = plt.subplots(figsize=(17.5, 7.4))
fig.subplots_adjust(left=0.07, right=0.98, bottom=0.225, top=0.78)
fig.text(0.07, 0.941, "VTA · наступні 24 години у генераторі", fontsize=25, weight="bold")
date_range = f"{moment(seq['startUtc']).strftime('%d.%m.%Y %H:%M')} — {moment(seq['endUtc']).strftime('%d.%m.%Y %H:%M')} UTC"
fig.text(0.07, 0.882, f"ПРЕВ’Ю СИМУЛЯЦІЇ  ·  {date_range}  ·  1h", fontsize=12, color=colors["muted"])
for i, (candle, phase) in enumerate(zip(seq["normalizedCandles1h"], seq["phaseByHour"])):
    if phase["phase"] != "ordinary":
        shade = "#F9E8E7" if phase["phase"] == "shock" else "#E4F2EB"
        ax.axvspan(i - 0.49, i + 0.49, facecolor=shade, zorder=0)
    draw_candle(ax, i, candle, width=0.50, linewidth=1.9)
    if phase["phase"] == "shock":
        ax.text(i + 0.45, candle["low"] / 1.23, f"Епізод {phase['episodeNumber']:02d}",
                ha="center", fontsize=10.0, color=colors["muted"])
clean_axis(ax)
ax.set_yscale("log")
candles = seq["normalizedCandles1h"]
low = min(c["low"] for c in candles)
high = max(c["high"] for c in candles)
ax.set_ylim(low / 1.50, high * 1.17)
axis_ticks = [25 * 2 ** i for i in range(15) if low / 1.50 <= 25 * 2 ** i <= high * 1.17]
ax.yaxis.set_major_locator(FixedLocator(axis_ticks))
ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:,.0f}".replace(",", " ")))
ax.yaxis.set_minor_locator(NullLocator())
ax.axhline(100, color="#869490", linewidth=0.9, linestyle=(0, (4, 4)), zorder=1)
positions = list(range(0, len(candles), 2))
labels = []
previous_date = None
for i in positions:
    dt = from_ms(candles[i]["openTime"])
    labels.append(dt.strftime("%H:%M\n%d.%m") if dt.date() != previous_date else dt.strftime("%H:%M"))
    previous_date = dt.date()
ax.set_xticks(positions, labels)
ax.set_xlim(-0.75, len(candles) - 0.25)
ax.set_ylabel("Індекс ціни · логарифмічна шкала", labelpad=12)
ax.legend(handles=[Patch(facecolor="#F9E8E7", edgecolor="none", label="Година падіння й часткового відкупу"),
                   Patch(facecolor="#E4F2EB", edgecolor="none", label="Година росту з верхньою тінню")],
          loc="upper left", frameon=False, fontsize=10.5)
fig.text(0.07, 0.115, "24 закриті погодинні свічки з того самого потоку тиків. Між епізодами — звичайні свічки профілю з дещо більшими тінями.",
         fontsize=11.1, color=colors["muted"])
fig.text(0.07, 0.075, "Усі ціни поділено на відкриття першої свічки × 100; логарифмічна шкала зберігає читабельність відносних рухів.",
         fontsize=11.1, color=colors["muted"])
fig.text(0.07, 0.035, "Джерело: actual-generator-results.json. Майбутні інтервали обчислені офлайн; це не підтвердження production deploy.",
         fontsize=10.6, color=colors["muted"])
sequence_path = out / "vta-next-24h.png"
save_compact(fig, sequence_path)
plt.close(fig)

rows = []
for ep in episodes:
    m = ep["metrics"]
    rows.append(f"| {ep['number']} | {ep['preset']['name']} | {moment(ep['startUtc']).strftime('%Y-%m-%d %H:%M')} | "
                f"{m['shockLowFromOpenPercent']:.4f}% | {m['shockCloseFromOpenPercent']:.4f}% | "
                f"{m['dropRecoveredPercent']:.4f}% | {m['recoveryCloseFromItsOpenPercent']:.4f}% | "
                f"{m['recoveryUpperWickBeyondBodyPercent']:.4f}% |")
comparison = data["ordinaryWickComparison"]
readme = f"""# VTA cyclic impulse visual QA

This is an **offline deterministic simulated preview**, calculated from the generator and VTA configuration in this working tree. It is not live-market evidence or confirmation of a deployment. No candles, prices, volumes or balances were written to production.

## Reproduce

Requirements: Node.js 24 or newer with `node:module.stripTypeScriptTypes`, and Python 3 with matplotlib. Run from the repository root:

```sh
node scripts/qa-vta-cycles.mjs
```

Use `--json-only` to skip the PNG renderer. `QA_PYTHON` can select the Python executable. The exporter compiles the actual TypeScript modules with Node's transformer, then calls `TestMarketSimulation.candles5m` and `aggregateCandles(..., HOUR_MS)`. It makes no HTTP requests, uses no current-clock inputs, and never substitutes illustrative OHLC. Source hashes are checked before and after generation so concurrent source edits fail the run.

## Evidence

- `actual-generator-results.json`: raw 5m/1h OHLCV, normalized plotted values, actual configuration, source SHA-256 hashes, every metric formula and the ordinary-shadow comparison.
- `vta-ten-scenarios.png`: ten consecutive scheduled episodes, each normalized to its shock-hour open = 100, all on one common linear y-scale.
- `vta-next-24h.png`: 24 consecutive hourly candles starting at the configured anchor; one shared normalization, explicitly logarithmic y-scale.

Source fingerprint: `{data['generation']['sourceFingerprint']}`.

The configuration anchor is `{from_ms(config['cyclicImpulse']['anchorAt']).isoformat()}`. The first episode retains all ticks completed through `{from_ms(config['cyclicImpulse']['notBefore']).isoformat()}`. Its prescribed drop and rebound use only the remaining part of that hour. Other episodes begin {config['cyclicImpulse']['periodHours']} hours apart. The recovery hour rejoins the unmodified baseline at its close in all {len(episodes)} previews (absolute difference zero at the generator's 8-significant-figure precision).

## Measured episode results

Each percentage is computed from generated hourly OHLC, after the generator's price rounding. The low/close columns use the first hour's open. The recovery return uses the second hour's own open; its upper shadow is measured above `max(open, close)`. The very small difference from preset percentages is rounding, retained in full precision in JSON.

| # | Preset | Start UTC | First-hour low | First-hour close | Drop recovered | Recovery-hour return | Upper shadow beyond body |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Ordinary shadows

This comparison toggles only `wickBoostFrom`; the new realism profile and cyclic-impulse settings are identical. Among the {comparison['count']} completed **ordinary 5m candles** in the first 24-hour preview, mean `(upper shadow + lower shadow) / open × 100` is {comparison['enabledMeanPercentOfOpen']:.6f}% with the boost versus {comparison['withoutBoostMeanPercentOfOpen']:.6f}% without it, a relative increase of {comparison['relativeIncreasePercent']:.6f}%. All compared opens and closes are identical: `{str(comparison['allBodiesIdentical']).lower()}`. This is a bounded sample result, not a promise that every 1h shadow grows by the same percentage.

## Scope

The plots check actual generator output and visible wick/body variation. They do not prove browser rendering, network behavior, production deployment, or financial execution. The source remains a deterministic simulation; ten repeating scenarios are not evidence of organic market demand. Existing history before the configured cutoff is not regenerated by this QA script.
"""
(out / "README.md").write_text(readme)
print(f"Rendered {ten_path}")
print(f"Rendered {sequence_path}")
