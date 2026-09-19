# Issue 146 — bounded native Futures work

Before: `d3510b2b4601bbd09476f03c5ac98fb72537a2b7`. Main checked after fetch: `03fc3e6c68fc926ae9eb11e85ba2d8046628cf72`. Same PR #149 / branch; no merge, deploy or production access.

Implemented:
- Live replay reads OHLC only at funding boundaries. Historical scenarios retain their paths and use a shared, validated closed-bar cache (4096 bars, 15-minute TTL); overlapping requests load only missing ranges. Adapter calls serialize, failed coverage is not cached.
- A sealed live checkpoint pins the entire processed instruction prefix, including same-millisecond sequence. Historical additions invalidate it. The still-forming funding minute retains the original minute checkpoint so later candle availability cannot erase funding owed before a close. Full replay remains available and tested.
- Collateral commands price only enabled nonzero holdings; Wallet still values disabled holdings. Collector frame marks reuse a maximum two-second cache, with all timestamps, identity and prices validated. MARKET always fetches its own book.
- Prisma commandContext groups receipt/account/holdings reads under one before/after authorization envelope. Commit still reauthorizes, checks idempotency and revision CAS. No account-state cache bypasses DB state or Wallet preferences.
- Stored live checkpoint can reference the identical snapshot instead of duplicating it; read inflation restores independent objects. Immutable revisions and full journal evidence remain.
- R9 server pass samples every 10 seconds, max four configured accounts per pass, round-robin and no overlap. It reads only pending metadata before entering the normal command lane. Restart recovery uses persisted submitting sessions, not a fabricated worker identity. Expired/revoked sessions and disabled configuration fail closed; an authenticated refresh renews scheduler admission. Legacy pending accounts enroll on their next authenticated command/refresh. Idle refreshes do not create revisions unless something changes or the 15-minute persistence interval expires.

Preserved: R11/R12 financial decisions/provenance, funding model, partial remainders, shared book consumption, margin/P&L formulas, Wallet switches, current UI and order-book UX #147, Copy Trading.

## Short local capacity comparison

Same script, Node 24.21, 120 operations per 1/10/30 contracts, fixture market + in-memory repository, collector frame enabled, 3 seconds simulated between operations. Runs sequentially without concurrent builds/tests. Before and after retain only eight revision/receipt fixtures: PostgreSQL keeps immutable evidence on disk, not forever in the API heap. No evicted receipt is retried in this workload. This fixes the benchmark's prior artificial unbounded heap retention; it does not claim history retention is bounded on disk.

| Contracts | OPEN p95 ms before → after | CLOSE p95 ms | REFRESH p95 ms | Persisted account + revision bytes |
|---|---:|---:|---:|---:|
| 1 | 10.50 → 10.95 | 11.50 → 12.29 | 4.49 → 4.75 | 420188 → 343488 |
| 10 | 50.80 → 21.01 | 46.99 → 21.10 | 22.04 → 7.54 | 905197 → 758328 |
| 30 | 145.13 → 130.64 | 136.91 → 116.65 | 71.29 → 61.94 | 2042040 → 1739660 |

| Contracts | Fresh-book calls | Frame calls before → after | History calls | Instrumented replay/engine calls | GC heap growth bytes |
|---|---:|---:|---:|---:|---:|
| 1 | 118 → 118 | 6 → 6 | 6 → 0 | 4870 → 495 | 6750152 → 6378264 |
| 10 | 118 → 118 | 130 → 119 | 60 → 0 | 5284 → 499 | 7696816 → 7491472 |
| 30 | 118 → 118 | 131 → 120 | 180 → 0 | 5946 → 499 | 11488392 → 11400648 |

The replay counter instruments `placeDemoOrder`, `markDemoAccount`, `executeDemoBook`, `executeObservedBook`, `settleDemoFunding`, including current execution and projection. It is work, not number of full replays. Request counts are adapter invocations, not invented venue HTTP counts. The production history adapter otherwise performs instrument + trade/mark candle reads per history request. Repository fixture calls stay 518 and commits 125 in each scenario; this fixture has no Prisma commandContext and is not a DB benchmark. All scenarios completed, all command failure maps empty; no rejected or partial MARKET fills. The one-contract timing did not improve and should not be described as an across-the-board latency win. Clock-driven fixtures do not yield enough to measure event-loop delay meaningfully.

Actual SQL reads/writes and PostgreSQL command time are measured separately in CI on disposable loopback PostgreSQL 16, using the same candidate harness against the exact pre-optimization checkout and candidate, 30 operations at 1/10 contracts, three-minute step timeout. Results are uploaded as `native-engine-capacity-146`.

Remaining release scope: full journal rows and immutable revisions still grow with trading history; no claim of unlimited-account capacity or tick-perfect matching. Larger multi-user/load-duration budgets are a separate release exercise. Session-gated server execution is intentional for the private demo, not an unattended production execution policy. CI results are to be appended after the pushed head finishes.
