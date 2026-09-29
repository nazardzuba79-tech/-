# Natural simulation wicks — actual-generator comparison

This is an **offline deterministic simulation preview**, computed directly from the baseline and candidate TypeScript generator. These PNGs are plots of raw generator data, not browser screenshots, venue BTC data, or proof of deployment. No candles, prices, trades, balances, or market state were written by this QA.

## Data revisions and fixed comparison

- Before: `d2e98bb083d11ba128b72abab7b1618a4b4c1399`; source fingerprint `b33b7682df69638d1afbee5d4db51cacc7ac511559dfe2d400c970c24b202b32`.
- After: `d74ec1c07d8e34c79f0b9dc8aecb68a82c582446`; source fingerprint `60c74f3ebbe33582ef6b4123ed878d75751a33a1ab175d3a0036775d06f204e0`.
- The source-file SHA-256 maps, exact configurations and raw 15m/5m OHLCV are in `before.json` and `after.json`.
- VTA history begins at **2026-09-28 15:00 UTC** and ends at the fixed request cutoff **2026-09-29 14:45 UTC**: **95 completed 15m candles**. A candle beginning at the cutoff is excluded from this historical comparison.
- The future VTA sample is the next 24 hours. Four new-listing fixtures use the actual `listingSimulationConfig` mapper, a shared seed/initial price, and listing time **2026-10-01 00:00 UTC**. The before fixtures omit a wick model; candidate fixtures explicitly carry **`wickModel: 'NATURAL_V1'`**, the persisted opt-in assigned to a newly created listing. Existing stored listings without that opt-in are a separate runtime regression case. Each profile sample contains 96 completed 15m candles.
- All figures retain **identical price and time axes for each before/after pair**. Wick height is not enlarged in the renderer; candle bodies, shadows and prices come directly from JSON.

## Measured changes

| Actual generator sample | Changed 15m candles | Upper only / lower only / both | Median total wick/body, before → after | 90th percentile, before → after |
|---|---:|---:|---:|---:|
| VTA entire closed history at request cutoff | 44/95 (46.3%) | 9 / 11 / 24 | 0.719 → 1.059 | 5.395 → 6.174 |
| VTA next 24 hours (fixed simulated clock) | 32/96 (33.3%) | 6 / 10 / 16 | 0.897 → 1.038 | 4.971 → 5.362 |
| New simulated listing · CALM_TREND | 48/96 (50.0%) | 11 / 9 / 28 | 0.527 → 0.751 | 4.071 → 4.490 |
| New simulated listing · IMPULSE_TREND | 48/96 (50.0%) | 11 / 9 / 28 | 1.892 → 2.050 | 7.344 → 7.906 |
| New simulated listing · PULLBACK_TREND | 48/96 (50.0%) | 11 / 9 / 28 | 2.108 → 2.455 | 10.613 → 11.224 |
| New simulated listing · COMPRESSION_BREAKOUT | 48/96 (50.0%) | 11 / 9 / 28 | 1.202 → 1.439 | 9.256 → 9.462 |

For VTA historical candles, lower-dominant / two-sided / upper-dominant counts changed from **29 / 33 / 33** to **31 / 29 / 35**. Dominant means one wick exceeds twice the other. These counts and the distribution plot distinguish variation in sides and lengths from a uniform multiplier.

The historical sample contains **88 ordinary candles** and **7 protected cyclic-episode candles**: the revision changes **44/88 ordinary candles**. In the future VTA sample, **32/64 ordinary candles** change; the other **32 candles** belong to protected shock/recovery episodes. The corresponding chart regions are lightly shaded.

`metrics.json` contains full quantiles, signed asymmetry, histogram bins, every changed opening timestamp, and separate upper/lower extensions or contractions. Total wick/body uses `abs(close − open)` as the denominator; zero-body candles are excluded from that ratio and counted separately. No clipping is applied to the recorded ratios.

## Preserved values checked during capture and comparison

- Every compared 15m **open, close, volume and quoteVolume** matches exactly.
- Full 1m and 5m open/close/volume fingerprints match for all six samples.
- The final price and last 500 canonical trades of each sample match exactly. This is explicitly a tape sample; full tick invariants are covered by the runtime regression suite.
- **All 10 six-hour shock/recovery episodes have exactly unchanged hourly OHLCV, schedules and presets.**
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
