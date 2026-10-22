# Admin built-browser measurements — 2026-10-03

Actual Vite bundles, Microsoft Edge headless, Windows, localhost synthetic APIs. No production requests. 1,080 final samples: 3 routes × 3 dataset sizes × before/after × cold/warm × 30 repetitions. Each user has balances; selected profile has 150 synthetic history entries in the legacy response. Audit fixtures contain 3 rows/user; legacy endpoint caps its response to 100, candidate pages 20.

Cold means a fresh browser context. Warm means repeated full navigation in one primed context. Network isolation disables HTTP cache in both modes; this is not a warm HTTP-cache benchmark. CPU was not exclusively reserved from other local development; small timing differences should not be interpreted as improvements. Timings measure navigation until actual data is rendered, not React profiler CPU. HTTP and bytes include API responses (not static bundle bytes) around initial render. SQL is NOT measured by this browser fixture; see ADMIN_READ_PERFORMANCE_20261003.md for actual PostgreSQL measurements.

| Users | Route | Mode | Before median / p95 ms | After median / p95 ms | API HTTP before → after | API bytes before → after | DOM rows before → after |
|---:|---|---|---:|---:|---:|---:|---:|
| 40 | users | cold | 288.2 / 311.5 | 293.5 / 340.2 | 5 → 3 | 25103 → 13060 | 20 → 20 |
| 40 | users | warm | 251.0 / 283.3 | 299.2 / 344.1 | 5 → 3 | 25103 → 13060 | 20 → 20 |
| 40 | profile | cold | 296.7 / 319.1 | 316.6 / 342.5 | 4 → 3 | 46400 → 2220 | 154 → 1 |
| 40 | profile | warm | 265.4 / 292.8 | 263.5 / 291.0 | 4 → 3 | 46400 → 2220 | 154 → 1 |
| 40 | audit | cold | 254.5 / 272.4 | 284.3 / 308.7 | 3 → 3 | 33393 → 8024 | 100 → 20 |
| 40 | audit | warm | 224.5 / 260.2 | 274.2 / 305.5 | 3 → 3 | 33393 → 8024 | 100 → 20 |
| 1000 | users | cold | 301.9 / 321.4 | 289.1 / 331.9 | 5 → 3 | 538655 → 13065 | 20 → 20 |
| 1000 | users | warm | 259.9 / 308.7 | 303.1 / 330.4 | 5 → 3 | 538655 → 13065 | 20 → 20 |
| 1000 | profile | cold | 293.0 / 330.9 | 316.7 / 331.7 | 4 → 3 | 46400 → 2222 | 154 → 1 |
| 1000 | profile | warm | 259.1 / 298.5 | 265.5 / 293.2 | 4 → 3 | 46400 → 2222 | 154 → 1 |
| 1000 | audit | cold | 256.1 / 286.1 | 279.1 / 296.5 | 3 → 3 | 33413 → 8029 | 100 → 20 |
| 1000 | audit | warm | 256.5 / 297.9 | 258.7 / 298.7 | 3 → 3 | 33413 → 8029 | 100 → 20 |
| 10000 | users | cold | 647.9 / 692.2 | 311.7 / 345.2 | 5 → 3 | 5400671 → 13068 | 20 → 20 |
| 10000 | users | warm | 719.0 / 821.7 | 281.3 / 325.8 | 5 → 3 | 5400671 → 13068 | 20 → 20 |
| 10000 | profile | cold | 291.6 / 317.8 | 309.8 / 334.9 | 4 → 3 | 46400 → 2223 | 154 → 1 |
| 10000 | profile | warm | 287.1 / 333.8 | 253.9 / 302.3 | 4 → 3 | 46400 → 2223 | 154 → 1 |
| 10000 | audit | cold | 266.0 / 293.0 | 285.1 / 314.2 | 3 → 3 | 33413 → 8032 | 100 → 20 |
| 10000 | audit | warm | 265.9 / 308.5 | 247.2 / 289.3 | 3 → 3 | 33413 → 8032 | 100 → 20 |

DOM metric: Users desktop data rows; Audit record rows/articles; Profile visible monospaced value nodes (including history values in baseline), not equivalent table rows. The candidate intentionally has no history rows until opening a tab. Static before/after UI capture uses the same 40-user fixture; historical rows are added only in benchmark mode.

Interpretation: bounded user payloads remove growth proportional to all users. At 10,000 users the warm first Users view falls from ~719 ms to ~281 ms and API bytes from 5.40 MB to 13 KB. At 40 users some candidate first-render timings are slower; no universal speedup claimed. Audit is primarily clearer and bounded, not consistently faster. Profile avoids eager histories. Shared summary still costs actual DB queries every 30 seconds while visible, documented separately; do not claim all SQL decreased.

Reproduce: build frontend with VITE_API_URL=/api/v1 and the manual catalogue fixture flag. For each bundle set QA_FRONTEND_DIST, QA_VARIANT, QA_USERS=40|1000|10000, QA_BENCH=1; run node scripts/qa-admin-practicality.cjs. QA_PLAYWRIGHT_MODULE may point to installed Playwright. Raw final samples: docs/evidence/admin-browser-performance-20261003.csv.
