# History20 v2 · private minute replay

Issue #705 extends the #616 managed listing wizard, existing draft store, preview renderer and server candle entry point. A verified private pack enables “Исторические режимы OHLCV” for new drafts. Choose a window explicitly or let the store pin its ID and SHA-256 using the insertion ordinal. Refreshes and later edits retain that assignment. A deployment with no pack keeps its existing behavior. Publication returns `HISTORICAL_RIGHTS_UNVERIFIED`. Trading and owner allocations are disallowed. Production does not mount the pack.

## Provenance and measured distributions

Binance Vision Spot monthly archives provide observed 1m candles and an independently archived reference interval. The builder verifies both ZIP digests, checks contiguous minute timestamps, and compares the aggregate with every native bar in the selected interval. R05 and R06 stop at the end of 19 April UTC. The originally proposed windows span a 150-minute archive gap on 20 April. Neither source series was filled.

UTC dates below use an exclusive end. N counts observed minutes. Body, upper and lower are separate median fractions of the high–low range at the reference interval. V90 is the 90th percentile of base volume divided by the window mean. Turnover sums the venue's reported quote volume, in billions of USDT. Returns describe the historical reference episode.

| ID | Spot pair | Start | End | Reference | N | Episode | Body | Upper | Lower | V90 | Return % | Turnover |
|---|---|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| R01 | BTCUSDT | 2020-03-09 | 2020-03-16 | 5m | 10080 | Капитуляция и отскок | 0.48 | 0.23 | 0.21 | 2.23 | -33.274 | 7.42 |
| R02 | ETHUSDT | 2020-03-12 | 2020-03-20 | 15m | 11520 | Распродажа с паузами | 0.44 | 0.25 | 0.24 | 2.20 | -29.962 | 2.22 |
| R03 | BTCUSDT | 2020-10-20 | 2020-11-11 | 4h | 31680 | Ступенчатый рост | 0.40 | 0.24 | 0.25 | 1.79 | 30.173 | 23.58 |
| R04 | BNBUSDT | 2021-02-15 | 2021-02-26 | 1h | 15840 | Импульс с откатами | 0.44 | 0.24 | 0.24 | 1.90 | 72.906 | 28.55 |
| R05 | DOGEUSDT | 2021-04-12 | 2021-04-20 | 5m | 11520 | Всплеск цены и объёма | 0.49 | 0.21 | 0.23 | 2.14 | 450.092 | 48.36 |
| R06 | BTCUSDT | 2021-04-10 | 2021-04-20 | 1h | 14400 | Разворот от максимума | 0.41 | 0.25 | 0.25 | 1.62 | -4.316 | 44.30 |
| R07 | ETHUSDT | 2021-05-10 | 2021-05-25 | 15m | 21600 | Каскадное снижение | 0.50 | 0.21 | 0.24 | 1.88 | -32.506 | 90.44 |
| R08 | ADAUSDT | 2021-08-20 | 2021-09-09 | 4h | 28800 | Прорыв диапазона и возврат | 0.40 | 0.26 | 0.27 | 1.78 | 1.184 | 21.29 |
| R09 | SOLUSDT | 2021-08-15 | 2021-09-16 | 4h | 46080 | Рост с глубокими откатами | 0.41 | 0.27 | 0.25 | 1.84 | 259.872 | 35.44 |
| R10 | AVAXUSDT | 2021-11-01 | 2021-12-03 | 1d | 46080 | Ускорение и коррекция | 0.49 | 0.22 | 0.23 | 1.40 | 67.101 | 13.41 |
| R11 | BTCUSDT | 2021-11-05 | 2021-11-26 | 1d | 30240 | Распределение у вершины | 0.48 | 0.18 | 0.32 | 1.45 | -3.966 | 55.22 |
| R12 | ETHUSDT | 2022-05-01 | 2022-05-21 | 4h | 28800 | Падение с контрдвижениями | 0.42 | 0.24 | 0.24 | 2.04 | -28.151 | 39.97 |
| R13 | BTCUSDT | 2022-06-09 | 2022-06-23 | 1h | 20160 | Кластеры волатильности | 0.47 | 0.27 | 0.21 | 1.99 | -33.825 | 39.11 |
| R14 | SOLUSDT | 2022-11-04 | 2022-11-16 | 1h | 17280 | Стрессовая распродажа | 0.45 | 0.25 | 0.24 | 2.42 | -53.597 | 3.50 |
| R15 | XRPUSDT | 2023-07-10 | 2023-07-20 | 5m | 14400 | Резкий импульс из боковика | 0.46 | 0.20 | 0.25 | 1.94 | 75.155 | 6.13 |
| R16 | BTCUSDT | 2023-10-19 | 2023-11-01 | 15m | 18720 | Выход из консолидации | 0.50 | 0.20 | 0.22 | 2.04 | 22.316 | 19.08 |
| R17 | SOLUSDT | 2023-10-10 | 2023-11-21 | 4h | 60480 | Серия повышающихся ступеней | 0.37 | 0.27 | 0.26 | 1.93 | 156.089 | 14.38 |
| R18 | BTCUSDT | 2024-02-25 | 2024-03-16 | 1h | 28800 | Ралли с волатильными откатами | 0.43 | 0.21 | 0.26 | 1.99 | 34.773 | 84.19 |
| R19 | ETHUSDT | 2024-03-12 | 2024-04-13 | 4h | 46080 | Двусторонний диапазон | 0.37 | 0.24 | 0.28 | 1.82 | -20.355 | 56.13 |
| R20 | BTCUSDT | 2024-08-01 | 2024-08-13 | 15m | 17280 | Быстрое восстановление после падения | 0.48 | 0.21 | 0.23 | 2.16 | -8.172 | 31.18 |

The [index](../src/shared/history20Regimes.json) contains archive URLs, raw and normalized digests, 10th/50th/90th percentiles for both minute and reference bars, exact single-wick counts, unequal two-sided wicks, doji (body ≤5% of range), inside bars, body engulfing, directional runs and failed breaks of the previous 12-bar range. Similar medians are possible even for series with very different successive bars. Quiet periods, reversals, volume and individual wick ratios are replayed in their measured order.

## Mapping and boundaries

Each completed bar preserves all four price ratios relative to the first source open and base volume relative to the window mean. Every timeframe uses the same UTC-bucketed observations including source open gaps. Base volume retains zero values. Only the path and accumulating volume of an unfinished minute are modeled. The seed, pinned digest and minute index determine which extremum is visited first. A closed window stops at its final candle. No bridge extends it into unobserved time.

## Reproduce in an isolated worktree

1. Install the repository's backend, frontend and market-edge dependencies. Build the backend and the frontend. Build the backend of a separate detached checkout at `0feb58bd856028dbc79cb8cc13bf68a9db907a61` for comparisons.
2. Run `node scripts/history20/prepare.cjs`. It downloads official archives on first use, verifies every checksum and compares the resulting index with the committed one. The `--write-index` maintenance option explicitly regenerates metadata.
3. Set `HISTORY20_PRIVATE_REGIME_DIR` to the absolute path of `output/history20-v2` and `HISTORY20_BASELINE` to the baseline checkout. Run `node scripts/history20/verify-source.cjs` and `node scripts/history20/legacy-parity.cjs`.
4. Set `QA_PLAYWRIGHT_MODULE` to the installed Playwright module and `QA_OUTPUT` to `output/history20-v2-browser`. Run `node scripts/qa-listing-history20.cjs` and `node scripts/history20/comparisons.cjs`. The browser exercises the admin UI over the existing isolated router and Durable Object SQLite harness. Separate comparison sheets overlay independently extracted CSV extrema on the new chart and show the pinned legacy generator beside it. Start, middle and end samples use the same selection rule across all episodes.
5. Run `node scripts/history20/benchmark.cjs` alone. There are 25 ticker clients, 25 chart clients and two clients crossing orders in an isolated in-memory matching engine. The benchmark compares identical loopback workloads with a fixed upstream ticker. It includes a second baseline control to measure host variance. Warmup, every round, matching counts, process CPU and RSS are recorded.

Raw archives, normalized packs, derived comparison images and screenshots remain in the ignored local output directory. Public or commercial use requires separate rights for datasets and derivatives. [Binance dataset terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md)

## Isolated acceptance results

The archive oracle verified 519,840 minute observations and 669,655 total closed candles over all six intervals. The pinned legacy checkout matched seven configs and 252 chart snapshots. Private Chromium produced 240 scenario/interval/viewport captures, two saved-draft screenshots, and 40 comparison sheets. Manual selection saved R20 and AUTO persisted all twenty IDs in sequence.

On Windows, the 50+2 trial produced 36,000 measured crypto requests per build. The pinned baseline p95 was 10.117 ms, its independent A/A control 10.038 ms, and the candidate 6.903 ms (−31.77%). A/A deviation was 0.77%. Each process completed 1,584 isolated matching fills including warmup. Candidate RSS at completion was 114.3 MiB. This measures the loopback router and simulation workload.

Short synchronized pulses initially failed the performance target. The final replay uses verified compact rollups for closed groups. Long sequential benchmark trials also saw substantial A/A host drift. The final harness interleaves six-request-round epochs across the two baselines and candidate after warmup, retaining all samples and all orders. The Windows run used the same four performance cores (logical CPUs 10–13) for all three processes. Neither public data distribution nor production capacity is established by this benchmark.
