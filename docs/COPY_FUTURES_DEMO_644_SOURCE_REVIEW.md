# Copy #644 — Native Futures demo fill source, read-only precondition

This is an incremental, **non-executing** review candidate stacked on #647 -> #646 -> #645 -> #643.

## Facts verified in code

- `FuturesPositionService` / `FuturesOrder` is the regular Futures ledger, **not** a safe demo-copy executor. No import or call to it is added.
- Existing isolated Native Demo records `NativeDemoAccount` (journal and snapshot events), executed book prices, individual positions, fees, and `NativeDemoService.command` for the authenticated owner/test account.
- The separate `NativeDemoService` already handles leverage, position margin, TP/SL, funding and liquidation, but its service entrypoint must revalidate the follower's own session and account, and its live book may be different from the leader's.
- A source command is NOT evidence of execution. `snapshot.events` with `OPEN`/`CLOSE` and a matching `actionId` is the minimum source evidence. `OBSERVED_BOOK` and `MAKER_MODEL` are accepted as distinct demo pricing modes, **never** represented as real exchange fills.

## Implementation

`src/services/copyTrading/FuturesDemoSource.ts` is a read-only candidate. It returns eligible executed fill receipts and explicit rejection reasons for other source events. An account with explicit `HISTORICAL_DEMO` is entirely excluded. A newly initialized NativeDemoAccount has no executionMode property, which NativeDemoService explicitly interprets as LIVE_EXECUTION; that default must be included for the normal live demo path. It checks source instruction/action/position identity, quantity, price, leverage and basic pair format. Synthetic profit histories, opening order intentions, selected historical candles, model liquidations, automated protection and funding are excluded.

The per-fill risk helper checks leverage and execution notional against explicit positive limits. It is **not sufficient** to authorize an order: leverage and margin exposure are distinct and the follower needs independent present-time portfolio checks, funding, margin, liquidation, slippage and available market depth.

The read-only helpers do not read from or mutate PostgreSQL, emit orders, create an API endpoint, start a worker, or activate production. They must **never** be exposed to untrusted client account snapshots. They expect server-fetched immutable Native Demo revisions.

## Next required implementation (not yet done)

1. Obtain an explicit owner-approved scope for a *test-only* Futures copy service; maintain a hard OFF gate requiring a disposable loopback test database, with no real Futures import.
2. Persist one source event per subscriber under a unique `(subscriberId, sourceEventId)` key with CAS/revision and a durable cursor. Bind leader and subscriber by internal User ID only; refuse stale or revoked sessions and owner-binding changes.
3. Define semantics for a source CLOSE, reduce-only LIMIT, fills from observed BOOK, automatic TP/SL, funding and liquidation. Never assume every leader CLOSE maps one-to-one to follower positions.
4. Use `NativeDemoService.command` on the follower's own authorized account, with deterministic idempotency keys and verified quantities/position IDs, never direct SQL writes to its private state. Correctly distinguish follower-market modeled fills from the leader's.
5. Re-check max position and total exposure, leveraged margin and isolated/cross equity, taker/maker fees, liquidation safety, freshness of quotes and demo depth at the follower's command commit.
6. Test two existing fixture accounts, replay/retry concurrency, mid-transaction failure, cancellation/stop, unsupported modeled events, and demo/real-table invariants on disposable PostgreSQL.
7. Only after further review: connect a deliberately opt-in test UI with truthful disclosures. Leave the main Copy Trading view unchanged.

Production, balances, migrations, credentials, real Futures, listing timers, and integration PRs are unchanged. **This is not functional automated Futures copy trading** and must not be described as such.
