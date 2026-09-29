# Candle realism and the four simulation profiles — evidence

`node scripts/preview-candle-profiles.cjs` runs one base scenario (VTA's seed, listing time and 0.01 price). It runs that scenario as the plain model and under each of the four profiles, then asserts that the mathematics is identical before drawing anything:

- the same regime and return for every hour;
- the same open and close for every hour over 7 days;
- P48 = 5.5234599 and the price after 7 days = 35171.298 in every row;
- the same closed hourly/4h/daily open and close;
- the same 24h change at every whole hour.

`metrics.json` holds the candle-character numbers per variant.

| File | What it shows |
|---|---|
| `5m-hours-20-24.png`, `5m-hours-37-41.png` | Same 4 hours, 5m, plain model vs each profile |
| `15m-first-48h.png` | First 48 h: every row ends on the same anchor, 5.5235 |
| `1h-first-7d.png` | First week: the same trend in every row |
| `terminal-before-*.png`, `terminal-after-*.png` | VTA in the real terminal (production bundle, real Render test-market route): plain model vs `IMPULSE_TREND` |

The two terminal pictures were taken seconds apart, in the middle of an hour. Their last price and 24h change differ slightly for that reason: inside an hour the path is intentionally different. At every whole hour the prices are identical.

Local only; nothing here is production evidence.
