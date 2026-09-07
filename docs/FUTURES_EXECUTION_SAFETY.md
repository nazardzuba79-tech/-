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

## MARKET full-depth preflight

The previous MARKET estimate multiplied the entire quantity by the best opposing price. A 1 BTC buy sweeping 0.5 at 50,000 and 0.5 at 100,000 therefore reserved/tiered 50,000 instead of the actual 75,000 USDT.

`FuturesMarketExecution.ts` now makes a read-only plan inside the existing locked SERIALIZABLE transaction, using the authoritative SQL-rebuilt staged book. It walks opposite orders in price/FIFO order and records exact maker IDs, quantities and prices. Virtual positions track each user's symbol/margin-mode position through the sweep: sibling reduce-only makers share capacity, stale makers contribute none, self-matches fail, and exposure-increasing legacy leverage mismatches fail before writes. Neither staged/live orders nor database rows are changed by estimation.

A MARKET request, including reduce-only, must have sufficient executable liquidity for its **entire requested quantity**. Otherwise it throws `Insufficient market liquidity for requested quantity` before order creation, margin locking, matching or any cancellation. This intentionally replaces the former partially executable MARKET fill-and-cancel behavior. On a successful full sweep, stale reduce-only maker remainders are still cancelled by the existing transactional execution path.

All execution-price legs feed the unchanged aggregate exposure helper together with current position and active pending exposure. Separate legs preserve the conservative expensive flip remainder; a whole-sweep average could understate that remainder. Same-direction leverage compatibility, split-order counting, advisory locks and the 100x/50x/20x/10x/5x tiers remain unchanged.

For ordinary MARKET orders the reservation sums every executable leg's initial margin, rounding each reservation upward to the database's 18-decimal precision. Reduce-only still reserves zero. After settlement, exact trades must match the plan; otherwise the transaction aborts without publication. MARKET-only refund reconciliation uses the persisted position's incremental initial margin (zero for pure reductions, the new remainder for flips), guarding against accumulated per-fill storage rounding. No margin/liquidation formula is changed. LIMIT estimation, reservation, reconciliation and partial-resting behavior are unchanged.

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
- Jest: **14 suites / 230 tests PASS**. All Futures suites, Futures frontend preservation, matching engine, Spot OrderService/recovery/order-book, CFD position/liquidation. Includes 17 new MARKET cases: buy/sell × both margin modes, read-only estimation, FIFO, self-match/legacy leverage preflight, insufficient liquidity/collateral, full-notional tier rejection, exact existing-position boundary, pending exposure, expensive flip remainder and rollback. All prior leverage-consistency/aggregate tier regressions remain.
- Native PostgreSQL 18.4: **45 integration cases PASS**; PGlite PostgreSQL 18.3: **43 cases PASS** (the same suite without two native-only concurrent-backend cases). Matrix covers LONG/SHORT × ISOLATED/CROSS; maker/taker/both-side reduce-only, partial fills, stale/absent/flipped positions, sibling cancellation, exact quantities/statuses/margin, no phantom trades, legacy mismatches after an earlier valid fill, immediate and deferred SQL-trigger failures, cancellation rollback, lost commit acknowledgement, restart recovery, split-order protection and SQL-enforced read-only audit. Fourteen new full-depth MARKET cases cover BUY/SELL × both modes, 75k collateral/tier, insufficient full liquidity/collateral, existing 50k/50,000.01 boundary, flip remainder, shared reduce-only capacity, zero-new-margin close, real 18-decimal rounding, and SQL INSERT/deferred-COMMIT rollback followed by a successful retry against the original book.
- Native contention case uses two independent engines and real concurrent PostgreSQL backends, observes the second waiting in `pg_locks`, then verifies stale SERIALIZABLE execution aborts without book mutation and a subsequent request uses the committed book. A second native case changes the position in a concurrent SQL transaction between capacity read and execution and verifies rollback followed by a correctly capped fill.
- Byte-unchanged: shared MatchingEngine/OrderBook, Spot, CFD, Card, Wallet, Copy Trading, all frontend, Prisma schema/migrations, aggregate exposure helper, tier constants, margin/liquidation formulas and funding code.

Ready for owner review, not authorization to deploy. Production legacy-order audit and release approval remain separate owner steps.
