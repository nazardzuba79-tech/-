# NRX post-listing wave structure — preview evidence (local, not production)

Production frontend + the actual NRX edge handler, at fixed simulated instants
after the 2026-10-03 13:00 UTC listing (`scripts/preview-nrx-market-structure.cjs`).
`before-*` = the base engine (NRX without `marketStructure`), `after-*` = this change.
File names: `<variant>-<timeframe>-<hours after listing>h.png`.

| View | What to look at |
|---|---|
| `15m-12h` | launch / price discovery with high volume → a range → breakout on volume → impulse with 15m pauses → top with wicks and a pullback |
| `15m-72h` | the third day in detail |
| `1h-30h`, `1h-72h` | impulse waves, pullbacks between them, consolidation before breakouts |
| `4h-72h`, `4h-168h` | green-led, but with red candles, pauses and long shadows instead of a staircase |

Both variants share every block/day anchor (price at 48h, 72h, 96h, …).
The base engine grows ×552 in the first 48h and ×8000 by 72h, so on a linear
scale the first hours look flat in the 1h/4h views; that growth is unchanged.

Metrics (first 72h; `metrics-before-72h.txt`, `metrics-after-72h.txt`):

| | before | after |
|---|---|---|
| 4h green / longest green run / ≥5% pullbacks | 95% / 18 / 0 | 74% / 7 / 2 (5 red candles, long wicks) |
| 1h longest green run / ≥5% pullbacks / deepest | 7 / 4 / 8% | 7 / 13 / 35% |
| 15m longest green run / ≥5% pullbacks / deepest | 11 / 7 / 11% | 6 / 25 / 35% |
| 15m green share in rising phases | — | 75% (corrections 25%, ranges 50%) |
