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

Checkpoint digest uses canonical sorted object keys (array order preserved), so PostgreSQL JSONB and instrument inflation do not force full replay. Existing noncanonical checkpoints safely rebuild once. A direct replay regression and real PostgreSQL round-trip assertion verify this. The initial DB measurement exposed this gap and was superseded by the final results below.

## Final short PostgreSQL comparison

Exact baseline `d3510b2b4601bbd09476f03c5ac98fb72537a2b7`; code head `978f2cc9d3970982c67ee15cbad98386c9634824`. CI run [35448429765](https://github.com/nazardzuba79-tech/-/actions/runs/35448429765), artifact `native-engine-capacity-146` / `10586637025`. Same candidate benchmark harness; Node 22.23.2, disposable loopback PostgreSQL 16, 30 operations at 1/10 contracts, fixture market, collector frame enabled. Before/after run sequentially in a three-minute bounded step; completed within seconds. Actual repository and SQL query events, not a DB mock. Market HTTP and browser latency are not included.

| Contracts | OPEN p95 ms before → after | CLOSE p95 ms | REFRESH p95 ms | Persisted bytes |
|---|---:|---:|---:|---:|
| 1 | 40.46 → 43.44 | 38.73 → 42.1 | 10.96 → 6.82 | 128047 → 102948 |
| 10 | 106.28 → 95.43 | 104.07 → 84.04 | 21.47 → 14.98 | 462268 → 367048 |

| Contracts | Fresh-book calls | Frame calls | History calls | Replay/engine calls | GC heap growth bytes |
|---|---:|---:|---:|---:|---:|
| 1 | 29 → 29 | 2 → 2 | 2 → 0 | 1052 → 122 | 1331824 → 1252296 |
| 10 | 29 → 29 | 32 → 29 | 20 → 0 | 1317 → 123 | 627752 → 715576 |

SQL reads **677 → 479**, writes **62 → 62**, transaction/control statements **62 → 62** in both scenarios, excluding initialization/warm-up. No financial or audit writes were dropped. One-contract OPEN/CLOSE slightly regressed; ten-contract confirmation and refresh improved. Two REFRESH samples are too few for a reliable tail distribution. Heap change is a short-run delta, not a proven long-run bound; ten-contract DB delta increased. No command failures, rejected or partial MARKET fills.

## Final local compute comparison

Node 24.21, same 120-operation workload at 1/10/30 contracts, fixture market and in-memory repository, 3 simulated seconds per operation, explicit GC. Final candidate and exact baseline ran sequentially without concurrent tests/builds (candidate first). Eight revision/receipt fixtures retained; no evicted keys retried. This removes the old fixture-only unbounded heap retention; production immutable history still grows on disk.

| Contracts | OPEN p95 ms before → after | CLOSE p95 ms | REFRESH p95 ms | Persisted bytes |
|---|---:|---:|---:|---:|
| 1 | 10.81 → 26.91 | 11.04 → 22.81 | 3.96 → 13.4 | 420188 → 343488 |
| 10 | 20.2 → 66.17 | 19.72 → 72.33 | 8.71 → 29.33 | 905197 → 758328 |
| 30 | 114.49 → 158.61 | 131.63 → 163.02 | 74.52 → 89.97 | 2042040 → 1739660 |

| Contracts | Fresh-book calls | Frame calls | History calls | Replay/engine calls | GC heap growth bytes |
|---|---:|---:|---:|---:|---:|
| 1 | 118 → 118 | 6 → 6 | 6 → 0 | 4870 → 495 | 6726424 → 6369696 |
| 10 | 118 → 118 | 130 → 119 | 60 → 0 | 5284 → 499 | 7624256 → 7564600 |
| 30 | 118 → 118 | 131 → 120 | 180 → 0 | 5946 → 499 | 11429824 → 11266896 |

The replay counter instruments placeDemoOrder, markDemoAccount, executeDemoBook, executeObservedBook and settleDemoFunding, including current execution/projection. It is work, not number of full replays. Market counts are adapter invocations, not fabricated venue HTTP counts. Local repository fixture calls remain 518 and commits 125 per scenario; it has no Prisma commandContext. Local timing includes canonical full-prefix digest work and does not imply every workload got faster.

## Validation and remaining scope

- All nine CI workflows succeeded on code head `978f2cc9d3970982c67ee15cbad98386c9634824`. PostgreSQL/replay workflow: **27 suites / 679 tests passed, zero failed/skipped**, backend and collector builds, frontend TypeScript/production build, actual P&L dialog/PNG browser QA passed.
- Local focused before digest follow-up: 720 passed / 0 failed / 21 DB skips. Final native-only rerun: **344 passed / 0 failed / 9 DB skips**; DB tests separately covered by CI.
- Full suite at `ec4fc9cbad523c0bc7599374ca2413f753a65de0`: **4347 passed / 130 failed / 38 skipped**. Pristine pre-optimization `d3510b2`: **4334 passed / 130 failed / 37 skipped**. Exact new assertion and suite-load failures: **0**, see optimization-146-failure-comparison.json. Full run predates the canonical digest follow-up; final changes reran native focused and PostgreSQL CI instead of claiming a final full-suite green. Existing full-suite failures remain outside this task.
- The DB race guard checks contiguous journal sequencing, both pre-execution mark/collateral contexts, exactly two fills, one revision conflict and same-key execution once. Placement of post-projection OBSERVE depends on observation time and is not hardcoded.
- Issue #146 bounded optimization and simplified R9 are complete for review. Full journal/revision storage and digest cost still scale with history; sustained multi-user release capacity remains unproven. Session-gated R9 stops when the submitting session expires/is revoked; next authenticated refresh renews admission. This is the private demo policy, not an unattended production policy.
- PR #149 can leave draft for review on this scope; this is not production release approval. No merge, deployment, production access, terminal design, Copy Trading or order-book UX changes.
