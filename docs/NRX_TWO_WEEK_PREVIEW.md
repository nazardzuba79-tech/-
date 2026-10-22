# NRX two-week offline review

This artifact is a simulation review, not a production activation or a forecast. It reads the real compiled NRX candle/ticker generator locally. It makes no production requests, opens no database and sends no financial writes. Publishing or activating a scenario still requires the separate release gate and a future cutoff; this preview does not satisfy those release conditions.

## Reproduce

```text
npm run build
node scripts/preview-nrx-two-week.cjs --screenshots
node scripts/preview-nrx-two-week.cjs --serve --port=4409
```

`QA_OUT` can override the default `output/nrx-two-week` artifact directory. `QA_PLAYWRIGHT_MODULE` can point to an installed Playwright module. The HTML embeds the installed Lightweight Charts distribution and canonical datasets, so it also works offline by opening `index.html` directly. The optional server binds only to `127.0.0.1` and accepts only GET/HEAD.

The preview has normal price scale with automatic fitting, 1m/5m/15m/1h controls, seven phase windows, a full fourteen-day overview, and a baseline variant with only the new `scheduledScenario` removed. Both variants derive their own candles, volumes and ticker snapshots from the same canonical engine; a baseline ticker is never borrowed from the candidate.

## Approved targets and dates

All percentage targets use the original listing price, **0.80 USDT**, as their reference. The schedule preserves the canonical price already reached at its start; it does not reset that price to 0.80 or rewrite prior ticks.

| Boundary | UTC | Europe/Kyiv | Target |
| --- | --- | --- | --- |
| Schedule start | 2026-10-03 18:00 | 2026-10-03 21:00 | Preserve previous canonical price; begin first impulse |
| First target | 2026-10-03 21:00 | 2026-10-04 00:00 | 7.52 USDT, +840% from listing |
| Second impulse starts | 2026-10-04 05:00 | 2026-10-04 08:00 | Leave night balance |
| Second target | 2026-10-04 09:00 | 2026-10-04 12:00 | 14.76 USDT, +1,745% from listing |
| Third target | 2026-10-04 13:00 | 2026-10-04 16:00 | 58.536 USDT, +7,217% from listing |
| Upper range ends | 2026-10-06 13:00 | 2026-10-06 16:00 | 58.536 USDT |
| Selloff ends | 2026-10-06 19:00 | 2026-10-06 22:00 | 23.4144 USDT, −60% from third target |
| Review ends | 2026-10-17 18:00 | 2026-10-17 21:00 | End of fourteen-day window |

The owner-corrected range is approximate, not a hard ±20% boundary. Volatility varies around 7–20%, the center drifts, and occasional actual tick-price excursions can carry candle bodies or wicks beyond that reference before recovering. OHLC values are not clipped to the reference. The preview axis is explicitly UTC; phase captions use Europe/Kyiv. Phase views use the canonical snapshot as of the phase endpoint, including a partial final candle where the endpoint does not align with the chosen interval.

## Verification

The current local run passed **100/100** mathematical checks:

- Complete closed-candle counts: 20,160 × 1m; 4,032 × 5m; 1,344 × 15m; 336 × 1h.
- Positive finite OHLCV, OHLC containment, continuous candle times/opens, no candle after the review window.
- Independent 1m reconstruction of canonical 5m, 15m and 1h OHLC.
- Base/quote-volume agreement within the mathematically derived rounding bound.
- Ticker, latest completed trade and canonical candle close agree at all phase boundaries.
- Rolling 24h high/low/base volume/quote volume agree with the canonical rolling candle window.
- Actual `nrxPublicResponse` ticker and four candle payloads agree with the same local generator.
- The three impulse targets pass; canonical 1m history before activation and the activation anchor remain unchanged.
- Each range has at least 95% of sampled canonical tick closes within the approximate ±20% reference, with actual overshoots across the ranges. Every excursion recovers within 20 minutes; no repeated closes pile up at an exact ±20% boundary.

The engine stores each candle's base volume at four decimals and quote volume at two decimals. Summing separately rounded 1m and 5m values therefore cannot be claimed to be byte-for-byte identical. The independent check derives the worst-case rounding bound from the number of rounded source components; it does not relax OHLC comparisons.

| Candidate reconstruction | Observed max base-volume difference | Observed max quote-volume difference | Derived bounds, base / quote |
| --- | ---: | ---: | ---: |
| 1m → 5m | 0.0002 NRX | 0.02 USDT | 0.0003 / 0.03 |
| 1m → 15m | 0.0004 NRX | 0.04 USDT | 0.0009 / 0.09 |
| 1m → 1h | 0.0007 NRX | 0.07 USDT | 0.0036 / 0.36 |

The browser run covers the full 1h overview and all seven phase windows at 1440px and 390px: **14 screenshots**, no horizontal overflow, uncaught browser errors or external requests. Screenshot fixtures perform no orders or balance changes.

## Observed approximate ranges

Body/wick deviations below are relative to the corresponding phase center. Time outside uses completed canonical 10-second tick closes, not the tick's internal high/low; it is explicitly a sampled-time estimate. A wick is not counted as ten whole seconds outside just because it touches an extreme.

| Phase | 1m body min / max | 1m wick min / max | Sampled time outside ±20% | Outside share | Recovered excursions | Longest sampled excursion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Night | −7.41% / +13.28% | −8.25% / +13.34% | 0 min | 0% | 0 | 0 min |
| Upper range | −29.09% / +29.37% | −30.04% / +29.98% | 21.83 min | 0.758% | 6 / 6 | 6.17 min |
| Final consolidation | −33.63% / +30.81% | −34.05% / +31.56% | 93.83 min | 0.596% | 31 / 31 | 10 min |

The upper range has 28 of 2,880 one-minute candles with wicks outside the reference; the final consolidation has 130 of 15,750. The night window has none. The checks deliberately do not require every range to cross ±20%; that would force an artificial excursion into each phase. All three windows have zero sampled tick closes on an exact ±20% boundary.

## Observed candle variation

After the adaptive minute-level counter-move adjustment, the first growth phase's maximum same-color 1m run fell from 73 to 9 candles; the second impulse's maximum is 7. With the owner-corrected variable ranges, the full-window maxima are 42/18/12/8 for 1m/5m/15m/1h respectively. The 42-candle 1m run occurs during the long final consolidation. The growth view visibly includes counter-moves, although the intentionally prescribed targets still determine its broad direction. These metrics do not prove that a simulated path reproduces a real market.

The metrics report includes bullish/bearish/zero-body counts, both-wick counts, wick-share and wick/body quantiles, color streaks, phase ranges and base/quote volumes. Wick/body statistics exclude zero-body candles explicitly.

## Evidence files

- `index.html`: self-contained interactive review.
- `metrics.json`: datasets, phase/volume/wick metrics and every mathematical check.
- `browser-report.json`: viewport/phase screenshots and browser/network guards.
- `all-1h-1440.png`, `growth-1m-1440.png`, `selloff-5m-1440.png` and corresponding mobile/other phase images.
- `preview.log`: generation result.

Provenance records the current Git HEAD, whether the working tree has local changes, hashes of the canonical source files and the embedded chart library. A dirty-tree preview must not be described as a deployed or exact committed production revision.
