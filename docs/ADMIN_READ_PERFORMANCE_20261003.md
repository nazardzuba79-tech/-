# Admin bounded-read performance — 2026-10-03

## Scope and evidence

This is a local review-only measurement. No production database, infrastructure, credentials, orders or balances were accessed or changed. Legacy endpoints remain compatible; the new UI must adopt the additive endpoints to receive these improvements.

- Baseline: `7d9ee6fc6bfe76badaac680313e9728e5abd3550`; unchanged legacy handlers run beside the candidate handlers against the same synthetic data.
- Environment: Windows x64, Node 24.21.0, Prisma 5.22, disposable PostgreSQL 18.4 bound to `127.0.0.1` on an allocated port.
- Runner: `scripts/bench-admin-reads.cjs`; actual Express HTTP, existing auth middleware, Prisma and all repository migrations. The runner rejects non-GET API requests and overrides database and auth configuration with local fixtures.
- [Complete machine-readable evidence](evidence/admin-read-performance-20261003.json): all four source runs, medians/p95/min/max, query counts, byte counts, fixture-integrity totals and measured-code SHA256 fingerprints.
- **3,600 measured HTTP requests**. **3,420 final distinct samples**: 19 scenarios × 2 modes × 3 dataset sizes × 30 repetitions. The first 180 summary samples predate the three alert-cursor queries and are explicitly superseded by the supplement. Both runs remain in the evidence.

Datasets contain 40 / 1,000 / 10,000 customers plus one fixture admin. Each customer has three balances, five sessions, three KYC submissions, 20 Spot orders, five deposits, five withdrawals and 20 audit entries. Extra deposits prove history paging beyond the former 100-row cap. Supplementary runs also contain three Futures orders, three Futures positions and three CFD positions per customer, including open positions. Prices are deterministic fixtures; no external market request runs.

“Cold” means the Prisma connection is disconnected before each measured request. It **does not** mean the PostgreSQL/OS cache was flushed or a cold browser load. “Warm” uses a reused Prisma connection and one unmeasured warm-up. HTTP includes authorization and JSON serialization. SQL milliseconds are the sum of Prisma query events at integer-millisecond resolution; a reported zero means below that resolution, not absence of SQL. Bytes are uncompressed JSON.

## Final warm results at 10,000 customers

Each row has 30 repetitions. Query count includes the existing auth checks. Full cold and warm results at every dataset size are in the evidence.

| Read | HTTP median ms | HTTP p95 ms | SQL median ms | SQL queries | JSON bytes | Returned rows |
|---|---:|---:|---:|---:|---:|---:|
| Legacy users | 821.80 | 1047.50 | 160 | 6 | 5,626,395 | 10,000 |
| Paged users | 16.70 | 19.75 | 7 | 7 | 11,305 | 20 |
| Paged users, last-login sort | 70.40 | 74.55 | 59 | 8 | 11,355 | 20 |
| Legacy eager profile/history | 11.27 | 13.23 | <1 | 11 | 22,828 | Mixed object |
| Profile without histories | 5.36 | 6.09 | <1 | 6 | 540 | One profile |
| Deposit history page | 5.67 | 8.44 | <1 | 5 | 3,429 | 20 |
| Legacy KYC clients | 832.71 | 926.68 | 124 | 4 | 4,634,059 | 10,001 |
| Paged KYC clients | 12.05 | 13.01 | 5 | 5 | 11,268 | 20 |
| KYC latest-submission date range | 61.97 | 66.13 | 52 | 6 | 11,600 | 20 |
| Legacy audit | 50.97 | 166.77 | 39 | 4 | 50,893 | 200 capped |
| Paged audit | 52.61 | 173.93 | 45 | 5 | 5,223 | 20 |
| Audit target-email search | 165.23 | 225.02 | 157 | 5 | 5,165 | 20 |
| Legacy user activity | 48.64 | 51.91 | 21 | 9 | 52,725 | Mixed object |
| Work summary, including alert cursors | 70.26 | 85.36 | 37 | 15 | 1,189 | Eight widgets |
| Legacy withdrawals | 27.32 | 32.25 | 15 | 4 | 65,493 | 200 capped |
| Paged withdrawals | 27.68 | 29.28 | 20 | 5 | 6,681 | 20 |
| Futures orders history | 5.58 | 7.01 | <1 | 5 | 831 | 3 |
| Futures positions history | 5.64 | 6.21 | <1 | 5 | 880 | 3 |
| CFD positions history | 5.16 | 7.48 | <1 | 5 | 799 | 3 |

User-list payload falls 99.80%; its local warm median falls from 821.80 to 16.70 ms. KYC payload falls 99.76%; local warm median falls from 832.71 to 12.05 ms. These are fixture measurements, not production latency promises.

Audit and withdrawal pagination do **not** demonstrate a latency improvement: exact totals add a count query. Their benefit is bounded payload plus access to records beyond the old cap. Audit email search scans matching metadata/user relations and is the slowest new read in this dataset. Candidate indexes are documented separately; no migration was applied.

The compact summary is **not cheaper in SQL** than the old activity endpoint: 15 queries versus 9, and 70.26 versus 48.64 ms median. It adds independently trustworthy counts and three item cursors; it replaces several separate reads in the UI. At one request every 30 seconds from one visible admin client it means approximately 30 SQL statements/minute, before foreground/action refreshes. There is no server cache that could hide a just-completed mutation. Multiple sessions multiply this cost. Client coalescing, hidden-tab cancellation and route lifecycle behavior must be validated separately; these backend measurements alone do not prove a lower total polling rate.

## Correctness and failure checks

- Six relevant typed route suites: **58 tests passed**. New failures were reproduced before fixes; legacy Admin/users/deposits/withdrawals tests also pass. Backend `tsc --noEmit` passes.
- All result pages are bounded (default 20, maximum 100); server validation rejects invalid paging, status, history kind and dates. Sorting has an ID tie-breaker. Empty pages retain an exact total.
- Users search matches email or ID literally, including `%` and `_`; only page IDs reach balance/session/vault lookups. Existing owner-only password access and decrypt behavior are preserved.
- KYC uses only the latest submission per user. Real PostgreSQL checks prove that an older submission inside a date range cannot include a user whose latest submission is outside it.
- Audit search matches the target or acting admin email without loading the directory. Real PostgreSQL assertions also verify literal `%` handling. Known credential fields/connection URLs are redacted from audit metadata; financial metadata is retained.
- Withdrawal paging includes legacy `COMPLETED` in the processed group and retains `balanceHeld` and all existing operator-action fields.
- Missing/failed summary widgets return `null`/`unavailable`, not zero. A truncated deposit package queue yields unknown package counts. Alert-cursor failures remain distinct from zero/new-empty results.
- A rejected database read returns an HTTP error; the test then makes a successful request to the same server. No mutation handler or execution calculation was changed.
- All four real-database runs compare pre/post exact decimal balance sums, locked amounts, deposit/withdrawal sums and history counts. Supplementary runs also compare derivatives counts and stored realized P&L. **All comparisons match without adjustment.**

## Reproduction

Install the normal repository dependencies and generate a client in an isolated worktree. Supply `QA_MODULES_DIR` pointing to a disposable QA dependency package containing `@embedded-postgres/windows-x64` and `pg`; do not use a production connection string.

```powershell
$env:QA_MODULES_DIR = 'C:\path\to\isolated-qa-dependencies'
node scripts/bench-admin-reads.cjs
```

The script creates and stops its own loopback cluster, writes results under `output/admin-practicality`, and enforces at least 30 repetitions. Optional `ADMIN_BENCH_SCENARIOS` selects named scenarios; `ADMIN_BENCH_REPORT` is restricted to a simple JSON filename under that output directory. Running the present complete script measures all 19 scenarios; historical runs in the evidence were split to validate additions without discarding earlier results.

## Remaining limits

This report does not measure browser FCP, React commits, DOM counts, user-perceived scrolling, WAN latency, production hardware, concurrent admins, pathological deeply paged offsets, production distribution/skew, or huge individual audit metadata blobs. Table rows are bounded, not every arbitrary field's byte length. KYC submissions remain private data under the existing admin authorization model. The legacy unbounded endpoints remain for compatibility; migrating a caller is required to remove its old full-list read. No index migration, merge or deployment is part of this measurement.
