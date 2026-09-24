# Native Futures OPEN command profile (2026-09-24)

Measured base: freshly fetched `main` at `c5fa3fb52f9f0720b7b6bf7652b6a26979f9e8e7`. The candidate branch was advanced to current `main` at `67db712cb4e2a3449475ba8599373f48b461c91f` before publication; those two intervening commits touch Copy Trading only, and the five-OPEN structural guard plus four PostgreSQL suites passed again on that base. Candidate: `codex/native-open-command-performance`. No production trades, database/config changes, deploy, migration, UI change, or financial formula change.

## Method

`scripts/measure-native-open.cjs` starts disposable loopback PostgreSQL, applies the committed migrations, creates a synthetic ADMIN/session/demo account, and builds a 350,110-byte stored account from 118 real fixture OPEN/CLOSE pairs. It then records five subsequent successful MARKET LONG OPENs via the compiled `NativeDemoService` and `PrismaNativeRepository`. A local TCP proxy counts PostgreSQL protocol bytes in each direction; Prisma query events count statements; existing command traces time stages. The base and candidate were built in separate exact-SHA worktrees and run with the same script. `--assert-optimized` enforces the candidate's query structure. `--tests` runs the four disposable-PostgreSQL suites directly against the local server.

Application-level **sequential DB waits** count authorization checks, the parallel context read group, lock, receipt, three writes, and final authorization. They exclude the transaction `BEGIN` and `COMMIT`; including those gives 13 → 12. The User and Session facts are still checked before/after context reads and before/after financial writes. The removed pre-transaction authorization was redundant with the transaction check before any financial write. The request deadline check remains before the transaction.

| Metric for successful OPEN | Current main | Candidate |
| --- | ---: | ---: |
| Sequential DB waits, excluding BEGIN/COMMIT | 11 | 10 |
| SQL statements, including BEGIN/COMMIT | 20 | 14 |
| Authorization SQL reads | 5 User + 5 Session | 4 joined User/Session |
| Account reads / revision receipt reads / balance reads | 2 / 2 / 1 | 2 / 2 / 1 |
| Account CAS / immutable revision / projection writes | 1 / 1 / 1 | 1 / 1 / 1 |
| Account payload at measured middle OPEN | 387,651 B | 387,651 B |
| Immutable revision payload | 387,306 B | 387,306 B |
| Projection payload | 2,725 B | 2,725 B |
| HTTP response JSON | 332,947 B | 332,947 B |
| PostgreSQL wire, client → DB, median | 720,744 B | 721,115 B |
| PostgreSQL wire, DB → client, median | 387,441 B | 387,174 B |
| Account write, median local stage | 38–120 ms across two runs | 90–95 ms across two runs |
| Revision insert, median local stage | 40–102 ms across two runs | 90–94 ms across two runs |
| Full OPEN p50, two five-sample local runs | 121 ms; 290 ms | 285 ms; 251 ms |
| Full OPEN p95, two five-sample local runs | 125 ms; 346 ms | 332 ms; 345 ms |
| Stored-payload preparation, same-process p50 | 7.5 ms (old algorithm) | 4.3–4.5 ms (new algorithm) |
| Sampled process peak RSS, two runs | 358–370 MB | 384–385 MB |

The stable result is **six fewer SQL statements and one fewer sequential wait**. The profiler derives phases from the observed authorization reads plus the known parallel context group, lock, receipt and three writes, and `--assert-optimized` fails if the 10-phase/14-statement structure or the expected read/write counts change. The payload-preparation microbenchmark compares both algorithms on the *same* stored account and asserts that their account and revision JSON values are equal. It removes one repeated journal compaction and serialization. The large JSON writes and account read remain; PostgreSQL wire volume is effectively unchanged. Absolute local OPEN latency and RSS vary enough between runs that this sample **does not prove an end-to-end speedup or a memory saving**. There is no latency threshold in CI.

The account and immutable revision each rewrite the full state although a later OPEN increased the account's serialized length by about 1.8 KB. PostgreSQL's local stage timings and the prior production trace both point to these large writes as the dominant remaining cost. That does **not** prove a single cause for the old ≈9.2 s production OPEN: collector waits, cross-region RTT, Render CPU, Prisma JSON conversion, and DB transport cannot be separated without a matched production trace. A versioned lossless compressed storage envelope or a normalized append-only schema could cut wire volume, but would need a separate compatibility/rollback design and audit tests. No such storage change or migration was made here.

Read-only Render inventory currently lists `exchange-api` in **Oregon** and suspended; its CPU/memory metrics query returned no points. Therefore the earlier “Render API Frankfurt vs Neon Oregon” description cannot be used as a current root-cause finding, and no production CPU/RAM peak is claimed. The local RSS figures are sampled process peaks, not Render metrics.

## Safety and validation

- The joined authorization read returns the same role, blocked, session-owner, and revoked facts in one MVCC statement. Config/allowlist and session-expiry checks before and after the awaited DB read remain. The legacy `assertOwner` path retains its original two-query behavior; only native repository calls select the joined path.
- The transaction still locks the account, checks authorization before writing, checks the idempotency receipt, CAS-updates the account, inserts immutable revision evidence, writes the live projection, rechecks authorization, and commits atomically. `beforeWrite` freshness guards still run at all three call sites.
- PostgreSQL regression includes revocation after projection write via a disposable trigger, which forces final authorization to roll back account, receipt, and projection; blocked/wrong-role/revoked actors create no receipt. Existing concurrent-tab CAS, idempotency/conflict, append-only revision, freshness rollback, projection recovery, historical/live, MARKET/LIMIT, long/short, partial/reduce-only, TP/SL, P&L/liquidation, and replay tests remain in the full private-trading suite.
- Backend and collector TypeScript builds, frontend production build, four PostgreSQL suites (38 tests), full private-trading suite, focused Copy Trading payload/isolation guard (6 tests), native browser (43 checks), large-values browser, and LIMIT-close LONG/SHORT at 1440/390 passed locally. The initial broad Copy Trading run exceeded its 240-second harness limit after ten passing suites; it is **not** counted as a full pass.

Reproduce on the candidate with `npm run build` and `node scripts/measure-native-open.cjs output/native-open.json --large --assert-optimized --tests`. The script has no production URL input and always creates a disposable loopback database. To reproduce the base, check out the exact base SHA in an isolated worktree, copy this script there, build, and omit `--assert-optimized`.
