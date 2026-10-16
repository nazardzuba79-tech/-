# PR 528: resumed Chart diagnosis and rejected serialization candidate

This evidence continues PR 528. No production, database, provider quota, financial rule, or deployment was changed.

## Fresh source and preserved main changes

Fetched `origin/main`, the review branch and PR 528 head on 2026-10-16. The latest owner comment was [6199634905](https://github.com/nazardzuba79-tech/-/pull/528#issuecomment-6199634905).

- Review baseline: `7865a873326dbf431df43f9fb1577b4fb1bf745f`.
- Main: `a2eca7a2ca2da33c0542d4805026e44d0262e969`.
- Local integration: `b0acc183bbadbb69d53cc376c7e5a325d3a14021`, preserving all six incoming main paths exactly. The five new CFD persistence paths were merged; the PG discovery path already matched. Other modules were not replaced by old versions.

## Retained Chart evidence

The original Linux run 38746533572 / job 116461546322 remains **220/222 PASS, 2 FAIL**. Both failures had 12 data rows, UTC and one candle call during hover. That run did not record the extra call's initiator; its historical cause cannot be reconstructed from those artifacts.

Corrected paired diagnostics used the same Playwright 1.63.0 Chromium executable, fixture epoch, harness and native advancing timers on main and review. Each completed **44/44 checks**, zero page errors, zero hover candle calls, with all other sections explicitly unselected. The review process exit was not retained after an interruption, although its completed report and log were retained; `RESUME-20261016.json` records that distinction. The invalid first diagnostic is not acceptance evidence.

CDP async initiators positively identify the last primary refresh in all four corrected cases as the existing 5-second interval. All four finished before hover, with no in-flight candle request. This proves a background request class, not the initiator of the missing historical Linux request.

| Corrected case | Timer fire → fetch start (page ms) | Fetch completion → hover | Hover duration | New candle calls |
|---|---:|---:|---:|---:|
| Main Futures | 16213.9 → 16214.2 | 866.4 ms | 725.8 ms | 0 |
| Main Spot | 14126.8 → 14127.0 | 967.9 ms | 743.2 ms | 0 |
| Review Futures | 13676.5 → 13676.8 | 983.7 ms | 731.2 ms | 0 |
| Review Spot | 14108.4 → 14108.7 | 998.2 ms | 734.8 ms | 0 |

The original comparison exported rewritten fixture URLs and scalar pre-rewrite counts, not complete original URL rows. The new QA observer retains both. Production polling, chart data and trading logic remain unchanged.

## Serialization experiment: REJECTED

The candidate was never connected to `services/stocks-global/server.mjs`. Its source and 10 passing unit tests are archived under `rejected-serializer/`, preserving the interrupted work without adding unused code to the runtime. The bounded array check avoids materializing every descriptor before rejecting a large ledger.

Both immutable benchmark scripts, raw results and execution receipts are retained. V2 used actual catalogue/engine snapshots and six alternating AB/BA rounds; **195,468 byte comparisons passed**. However, small nonempty response serialization regressed **94.7% for 20 instruments** and **9.7% for 40 instruments**, with larger regressions near the validation cutoff. Empty-state improvement does not establish a benefit for actual quote-bearing viewers. See `SERIALIZER-CANDIDATE-REVIEW.md` for every negative result.

These were uncapped Windows diagnostics while frontend Jest/build were also running. Wall timings, quantized process CPU, process-wide RSS, and deferred string flattening are not HTTP or capacity acceptance. There were no provider requests, SQLite access, or financial operations. The scripts' source path records refer to the candidate's original location; replay only in a disposable checkout by restoring the archived module to that path. Do not import the rejected module into the server.

## Release gates remain separate

- Original 50-user mixed: **FAIL**, 29 / 25 / 31 deadlines; retained p95 1697.982 / 1655.884 / 1795.966 ms.
- Crypto coexistence: **FAIL**, p95 +13.648569% / +13.811445%, exceeding the unchanged +5% limit.
- Original resource-constrained replays on this correctness branch: **NOT_RUN**. Consumed PR 512 plans and thresholds remain untouched. Windows has no usable local Linux Docker/cgroup environment; ordinary correctness CI does not run those heavy gates.
- Hetzner capacity: **INCONCLUSIVE**, not established by historical hardware specifications or these microbenchmarks. No new server sampling or production access was performed.
- Real PostgreSQL acceptance: **NOT_RUN**.
- MOEX/SBER remain blocked; commercial Binance/Bybit data rights remain **NOT CLEARED**.

Green correctness CI must not be reported as production readiness or capacity acceptance.

## Current-source CI follow-up

At `6d44e287`, complete Linux Chart QA passed **224/224**, including both repaired
hover checks with zero new candle requests. Chart pure/helper checks passed
190/22; frontend passed 274 suites / 4,386 assertions. Stocks public-host then
failed its bounded NSS package-owner prerequisite before its browser cases.
The failure and narrowly scoped follow-up are retained in
[NSS-PREFLIGHT.md](NSS-PREFLIGHT.md); they do not invalidate or replace the
earlier Windows screenshot failure or historical capacity failures.
