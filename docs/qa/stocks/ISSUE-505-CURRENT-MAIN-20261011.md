# Stocks Issue #505 — current-main continuation (2026-10-11)

Review only; continue Draft #497 on `codex/stocks-integration-20261010`. This document describes the candidate, not release approval.

## Exact integration boundary

Fresh-fetched PR head: `86b4f412c8e9bff26fb6e7ab4a588e95fa26a9ce`.
Fresh-fetched main: `c205ca3ce64f087b490bae11b2a285791f11f052`.
Integration commit: `7fafc74d966eabf7f3108d8125957da940cd745c`.

The only merge conflict was the append-only handoff. Both histories were retained. All 27 other incoming paths matched current-main blobs after integration, including Futures #508/#511, Support/Telegram #506/#509 and Assistant #510. Professional B and the existing Mobile/Card/Auth/Admin work are preserved. No main merge, deployment or production access.

## Narrow runtime changes

- Reopening a funded account checks existence before attempting initialization. It no longer requests a SQLite writer lock for a redundant INSERT OR IGNORE. Already-queued consecutive account registrations can share one FULL durable transaction, at most 32 identities; the first unqueued registration keeps its individual path. No extra batching timer is introduced. Each acknowledgement follows COMMIT, and no balance/order/read command can be crossed or batched. Existing ledgers are never replaced.
- Concurrent background observations share pending work only for the same account context and instrument. This includes the interest scheduler. Explicit refreshes and financial commands are not coalesced. Completion/failure removes the pending entry; no extra quote TTL or retained old-price cache is introduced.
- Cached history avoids unnecessary query-parser allocations and promise suspension for already encoded immutable responses. Decoded query keys, duplicate rejection, numeric coercion, bounds, pagination, exact decimal strings and pending singleflight behavior remain tested.
- The historical-read HTTP server retains its established 2-second idle keep-alive. A 5-second candidate reduced connection churn but failed the original constrained latency gate and was withdrawn. Query/cache optimizations remain. The 128-socket cap and request/headers/acceptance deadlines are unchanged.

The engine, native-market adapter, prices, FX, rounding, fees, P&L, execution freshness, provider 100/rolling-60s budgets, 128-command/1-MiB/2.5s queue and DELETE/FULL/BEGIN IMMEDIATE remain unchanged. Queue limits and deadlines count each registration, not one batch. Failed rollback or post-COMMIT uncertainty returns ACCOUNT_OUTCOME_UNKNOWN and fences the worker before queued financial work can continue. Response identity mappings are validated for the whole batch before any acknowledgement. Worker occupancy and per-request execution time are recorded separately, so grouping does not hide latency.

## Measured local evidence, not capacity acceptance

Existing-account writer-lock probe: prior code failed after 1112.44 ms; candidate read succeeded in 1.52 ms. Five rotated 10,000-registration runs had median CPU 562 to 423 ms and wall 574.69 to 435.55 ms. This measures reopening, not first funding or concurrent HTTP capacity.

Registration-only grouping adds 15 regression cases: FULL commit-before-ACK; all-or-none rollback; rollback uncertainty; pre/post-COMMIT worker death; duplicate funding; simultaneous independent owner creation; FIFO barriers; per-member count/byte/deadline limits; delayed timer rejection; observation and execution-capacity preservation; graceful shutdown and restart. The full local Stocks suite passes 182/182. Its first run had one existing randomly allocated fetch `bad port` failure; the unchanged rerun passed and both logs are retained. A nine-run smaller-page experiment was not adopted: it reduced logical write bytes but increased read operations and CPU, without an original Linux capacity proof. Existing database page layouts remain unchanged.

An unthrottled local diagnostic of the subsequently rejected 5-second transport candidate used the unchanged strict fetch reader with 100 readers, 250 instruments and 8-second runs. Warm 2s-to-5s idle keep-alive changed TCP connections 3710 to 100, server CPU 1531 to 437 ms, RSS 127.35 to 113.74 MB, and successes 3710 to 3900. Cold: connections 3708 to 100, CPU 1625 to 1062 ms, RSS 126.99 to 112.05 MB, successes 3708 to 3860. Both sides had zero errors, 250 SQL reads and peak 100 sockets. These short Windows diagnostics establish the transport mechanism, not original Docker capacity acceptance. Earlier repeated fixed-port diagnostics hit Windows EADDRINUSE and are retained as invalid capacity measurements.

The fresh original paired run at `dad46478b376a9fcdf1ff72d88af8ddfd4047de3` supersedes that favorable local result: D50 successes rose 6425 to 10833 across three repetitions, but timeout errors rose 0 to 34. Stock CPU fell approximately 0.0485 to 0.0323 vCPU, while maximum event-loop delay rose 559–692 to 1018–1101 ms. The unchanged fixture's historical backfill clears the cache; history loads increased 411/412/411 to 500/500/500. Disk reads were zero in both sets. These data do not prove the exact timeout phase, but they reject the candidate under the required zero-error criterion. Restoring only the idle setting is a one-factor ablation, pending the next exact-head original tests. Neither the original workload nor any acceptance threshold was changed.

The background regression exercises 26 rapid owner/instrument selections plus two scheduled subscriptions: only four owner/instrument observations are processed, with 24 followers coalesced. Alice/Bob have different wallets; failures and subsequent recovery remain owner-local. Two explicit refreshes still execute separately.

Original 86b4 bounded measurements show first funding remains material: each 20-account case writes 667,648 bytes with 4.945–5.236 seconds of SQLite write wall; each 50-account case writes 1,667,072 bytes with 12.559–13.065 seconds. Quote commits were already zero. These are observations under the required 128 KiB/s write cap, not a universal per-ACK lower-bound proof. Grouping separate financial transactions or weakening fsync is not a permitted workaround.

## Real transport budget evidence

New tests exercise the actual native quote/FX/history adapters together, with network-denied fixtures. Previously the resource workload replaced quote() and could not establish the combined real transport budget. The new virtual-time model supplements, never replaces, that workload.

With unchanged 100 starts/host/rolling 60 seconds, three deterministic repetitions give:
- Shared 5/20/50: Bybit 35, Binance 6, MOEX metadata 1 starts; no model refusals.
- Mixed 5: Bybit 59, Binance 80, MOEX metadata 1; no model refusals.
- Mixed 20: Bybit 100, Binance 100; 250 RATE_LIMIT operations and 7 unavailable-USDC results.
- Mixed 50: Bybit 100, Binance 100; 605 RATE_LIMIT operations and 7 unavailable-USDC results.

A separate ideal-coalesced demand calculation needs 135 Binance execution-quote starts/minute before ticker, FX and history in the mixed 20/50 schedule. More server CPU cannot remove this upstream-budget constraint. Longer execution-price caching, raised limits, fabricated observations or treating refusals as successes are not acceptable fixes. A native streaming execution-source design would require separate provenance/reconnect/freshness/capacity validation and rights clearance.

Finite read-only public probes on 2026-10-11 returned real Bybit AAPLX and Binance AAPLB candles (1m/15m/1D) and fresh USDT/USDC execution observations. The tokens remain separate identities. MOEX DNS was unavailable; all MOEX instruments, including SBER, remain blocked. Public responses do not establish commercial redistribution rights.

## Final acceptance must be read from exact-head artifacts

The profile comparator now uses immediate previous head 86b4. Original 3c5/f81 paired crypto comparisons remain intact. All original scripts, cases, repetitions, resource caps, disk limits, deadlines and assertions are retained. Added tests are included in existing CI jobs, with the combined-budget JSON included in the performance artifact.

The dad464 profile artifact README incorrectly printed the reporter's f81 fallback despite the workflow actually archiving 86b4. Raw files are preserved with a provenance correction note; the workflow now supplies the exact baseline label explicitly. This correction changes reporting only.

Full exact-head CI and original resource results are pending for the commit carrying this note. The final PR review header and attached run artifacts must give the actual PASS/FAIL, including successful-only versus censored latency and same-core crypto p95 <= +5%. Green evidence-collection workflows alone are not capacity acceptance.

Current Hetzner capacity/headroom is unconfirmed: no server access or load was performed. MOEX validation and Binance/Bybit commercial data permission remain release blockers. Stocks must stay OFF outside the isolated review environment.

