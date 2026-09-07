# Futures execution safety — owner review only

Branch: `codex/futures-aggregate-tier-fix`, reviewed starting tip `692f635bcf8b1797bd6afb60a78e0c47059974dc`.
No main merge, deployment, production database access, or real orders.

## Root causes

1. `reduceOnly` was checked only at admission and dropped between settlement and `applyFill`. A resting order could outlive/shrink past its opposing position and enter the ordinary open/increase/flip paths.
2. `engine.submitOrder` changed live maker quantities before asynchronous settlement/COMMIT. A later leverage rejection rolled back SQL but not the book. Maker statuses were not persisted, trade insert errors were swallowed, and mark-price prints were emitted before commit.

## Execution invariant

For each individual match, both counterparties are checked against their current transactional position, scoped by user/symbol/margin mode. A reduce-only side has capacity zero without an OPEN opposing position; otherwise capacity is that position's remaining size. The trade quantity is the minimum of maker remainder, taker remainder, maker capacity and taker capacity. The unchanged matching algorithm runs on isolated fragments of exactly that quantity: excess never becomes a Trade.

Settlement carries both orders' `reduceOnly` flags and independently rejects any opening, increasing or flipping effect. Partial reductions retain existing leverage and proportional margin. Self-matches are rejected atomically to prevent one side invalidating the other within the same trade.

Non-executable reduce-only remainders are CANCELLED, with unfilled `remainingQuantity` retained for audit and no live-book entry. After matching, stale sibling remainders exceeding the remaining capacity are cancelled conservatively, not resized/reinterpreted. Reduce-only orders reserve no new margin and cancellation refunds none. Maker status/remaining quantity are persisted after each fill. For ordinary makers, unused order-margin reservation is refunded separately from released position margin; the initial-margin and liquidation formulas themselves are unchanged.

## Transaction/book boundary

- A per-engine async queue covers placement/cancellation through commit verification and synchronous publication.
- A PostgreSQL transaction-scoped global Futures advisory lock serializes placements/cancellations across counterparties/symbols; the original user/symbol/mode aggregate-risk lock remains. Both locks cast the `void` result to text because real Prisma rejects deserializing `void`.
- Each SERIALIZABLE transaction rebuilds an isolated book from authoritative active database rows. No live Order reference is used for matching or mutated during database awaits. Conflicting concurrent position writes abort the stale transaction; they do not make a stale capacity executable.
- Orders, both counterparties' positions/balances, maker statuses, cancellations and Trade rows commit together. Trade insertion errors are no longer swallowed.
- Native PostgreSQL testing found Prisma 5.22 can resolve its transaction promise even when a deferred trigger aborts COMMIT. The wrapper therefore captures `pg_current_xact_id()` and verifies `pg_xact_status()` on the database before publication. A confirmed abort discards staging. A confirmed commit after lost acknowledgement publishes once without replaying fills. An unavailable/unknown outcome fails closed; no staged book or mark-price prints are published and no automatic order retry occurs.
- Live-book publication is synchronous, after confirmed commit; mark-price prints follow. Startup recovery and staging use the same deterministic timestamp/id ordering; new admissions get strictly increasing timestamps relative to resting rows, preserving FIFO across reloads.

The database is the execution authority, not a distributed in-memory cache. Other processes' display caches are not broadcast by this patch, and a disconnected process cannot promise an instantaneous book display refresh. Every new placement/cancellation reconstructs from SQL before execution. A process crash is recovered using the existing database-book recovery path. Do not blindly retry a request whose commit outcome could not be determined; reconcile its order state first. This patch introduces neither a distributed WAL nor request idempotency.

PostgreSQL transaction-status functions are documented for resolving uncertain COMMIT outcomes in the [PostgreSQL documentation](https://www.postgresql.org/docs/14/functions-info.html#FUNCTIONS-TXID-SNAPSHOT). The target database must support these functions (PostgreSQL 13+) and the application connection must read from the primary.

## Pre-release legacy audit

After compiling the backend, an owner/operator may explicitly configure `FUTURES_AUDIT_DATABASE_URL` and run:

```text
node dist/futures/auditActiveOrders.js
```

The script does not fall back to `DATABASE_URL`. It runs a SQL-enforced READ ONLY, REPEATABLE READ transaction, returning order IDs/reasons for incompatible position leverage, incompatible same-side pending leverage, invalid active order shape and stale reduce-only quantities. Exit 0 means no listed issues; 1 means issues; 2 means audit failure. It never repairs, cancels or re-margins anything. Legacy incompatible orders need owner-authorized cancellation/reconciliation before release; no production audit or remediation was performed here.

## Reproducible isolated SQL regression

Build the backend, create `node_modules/.cache/futures-sql`, then install test tools there only:

```text
pnpm --dir node_modules/.cache/futures-sql add @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11 --ignore-scripts
node scripts/qa-futures-execution.cjs
```

For the stronger native Windows run, also install `@embedded-postgres/windows-x64@18.4.0-beta.17` and `pg@8.23.0` into the same ignored directory, then run:

```text
node scripts/qa-futures-execution.cjs --native
```

The harness accepts no database URL. It creates a fresh isolated database, applies the repository's unchanged migrations, uses the actual generated Prisma client/compiled service/MatchingEngine, seeds only `*.futures.invalid` fixture users, binds loopback only, and stops the test server afterward. Native test clusters are retained under ignored `node_modules/.cache/futures-sql`; no application dependencies/lockfiles or schema were changed.

## Validation

- Backend TypeScript/build: PASS.
- Frontend TypeScript and production Vite build: PASS. Existing large-chunk warning only; frontend assets unchanged (`index-BMeggfXu.js`, `index-QXhDhbLy.css`).
- Jest: **14 suites / 213 tests PASS**. All Futures suites, Futures frontend preservation, matching engine, Spot OrderService/recovery/order-book, CFD position/liquidation. Includes nine new execution/rollback tests and all prior leverage-consistency/aggregate tier regressions.
- Native PostgreSQL 18.4: **31 integration cases PASS**. Matrix covers LONG/SHORT × ISOLATED/CROSS; maker/taker/both-side reduce-only, partial fills, stale/absent/flipped positions, sibling cancellation, exact quantities/statuses/margin, MARKET remainder, no phantom trades, legacy mismatches after an earlier valid fill, immediate and deferred SQL-trigger failures, cancellation rollback, lost commit acknowledgement, restart recovery, split-order protection and SQL-enforced read-only audit.
- Native contention case uses two independent engines and real concurrent PostgreSQL backends, observes the second waiting in `pg_locks`, then verifies stale SERIALIZABLE execution aborts without book mutation and a subsequent request uses the committed book. A second native case changes the position in a concurrent SQL transaction between capacity read and execution and verifies rollback followed by a correctly capped fill.
- Byte-unchanged: shared MatchingEngine/OrderBook, Spot, CFD, Card, Wallet, Copy Trading, all frontend, Prisma schema/migrations, aggregate exposure helper, tier constants, margin/liquidation formulas and funding code.

Ready for owner review, not authorization to deploy. Production legacy-order audit and release approval remain separate owner steps.
