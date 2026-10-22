# Historical entry — pick area and failed-wake recovery (2026-10-21)

Isolated fixture only (`scripts/serve-native-demo-review.cjs`, `NATIVE_PREVIEW_FIXTURE=1`, AKE/USDT:
flat 0.004 bars, a rise to 0.0538). Never production. Produced by `scripts/qa-historical-entry.cjs`
driving the real `/futures` terminal; the owner's trading numbers are unchanged (1 500 000 contracts at 3x).

## The regression, reproduced on `main` (f81df788) and fixed on this branch

`baseline-f81df788/` is the SAME script run against the unmodified `main` frontend
(`HISTORICAL_QA_OUT=…/baseline-f81df788`). With the rise in view the completed 0.004 bars are drawn
low on the price pane — at 93.7 % of its height on 1440 (y 344 of 367 px), 93.6 % on 390 (y 223.7
of 239 px) — exactly where the owner's IOST/USDT 1h bars sat. One click on such a bar, no scroll or
zoom after framing:

| build | 1440 | 390 |
| --- | --- | --- |
| `main` f81df788 (`baseline-f81df788/report.json`) | **refused** — «The chart refused the completed 0.004 bar drawn at 93.7 % of the price pane's height» | **refused** (93.6 %) |
| this branch (`report.json`) | accepted; LONG and SHORT opened at 0.004 | accepted; LONG and SHORT opened at 0.004 |

Two causes, both in the frontend hit-test:

1. `isCandleHit` (`frontend/src/lib/chartTrading.ts`) refused every click at `y ≥ 0.8 × paneHeight`
   (0.75 with band oscillators) — a band reserved for the volume histogram and the scales after the
   volume had already moved to its own pane (`e0bf1002`, 2026-09-30; the cut-off came with PR #454 on
   2026-10-06). The pick area is now the price pane itself, less only the band an overlay still drawn
   in that pane owns (`chartOverlayBottomFraction`: a visible volume histogram left in pane 0, or the
   Spot/CFD oscillator band). Volume, RSI/MACD panes arrive as `paneIndex ≠ 0` and never pick.
2. A price-pane overlay drawn through the bar took the click: the default SMA 200 runs exactly along a
   flat run of old candles, so the hovered series was the SMA, not the candle, and `indicatorHovered`
   refused. While picking, the candle's own geometry decides; only a series of another pane counts.

## What else the run checks (both widths unless noted)

* `pick-refusals-<w>.png` — with the picker armed and the bars framed, four clicks that must never
  select: empty price-pane space, the volume pane, the forming (incomplete) bar, a drag that starts on
  a completed bar. Each leaves the picker armed and the panel without an entry reference.
* `pick-accepted-<w>.png` — the bottom-zone bar accepted (`evidence.pick`: screen point, pane height,
  fraction).
* LONG and SHORT from the «Лимитный» tab: the ordinary form sends `type: LIMIT` with the bar attached,
  the engine opens a HISTORICAL_DEMO position at 0.004 against the 0.0538 mark, P&L ±74 700,
  journaled as a filled MARKET with `historicalPrice` 0.004; partial reduce-only limit close, market close,
  realized gross/net with both fees (unchanged assertions).
* `market-tab-armed-<w>.png` — the same bar through «Рыночный»: `type: MARKET`, no price, the bar
  attached; position entry 0.004, mark 0.0538; closed again. The selected price reaches the existing
  Long/Short on both tabs.
* `indicator-pane-control-1440.png` — RSI added (a third pane); a click inside it with the picker armed
  picks nothing. The phone keeps the indicator menus in the chart-workspace sheet, so this control runs
  on 1440 only; the rule is one code path (`paneIndex ≠ 0`), also in `chartTrading.test.ts`.

Failed-wake recovery (problem 2) is exercised by `scripts/qa-browser-sleep-native.cjs`
(`output/browser-sleep-native/`, see `docs/AI_HANDOFF.md`, 2026-10-21): a 503 on the display
reference read no longer fails the wake; a failing tracked native read shows the notice with
«Повторить попытку», refuses the double click, and the retry recovers without replaying a command.
