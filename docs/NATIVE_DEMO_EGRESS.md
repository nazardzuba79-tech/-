# Native demo live-read egress

Base: freshly fetched `main` at `ff7c26b8363a0e9c543ff04afd9be918229fdcdc`.
Branch: `codex/native-demo-egress`. No production access, migration, merge or deployment was performed.

## Read and write contracts

`NativeDemoAccount` and immutable `NativeDemoRevision` remain authoritative. The additive `NativeDemoLiveProjection` table is derived display input, never execution/replay input. Initialization and successful command commits write it in the same transaction as the authoritative revision. A failed projection write rolls back the whole commit.

Ordinary `GET /api/v1/private-trading/native/live` selects the account revision and projection together in one MVCC statement. It does not select account payload or any immutable revision. Both projection revision fields and a JSONB-order-independent checksum must match. Missing, stale or corrupted projections are rebuilt exceptionally under the existing account row lock; recovery does not write financial state or create a revision. Unrecoverable errors fail closed.

Live valuation reuses `markDemoAccount`, collateral valuation, `demoAccount`, `crossAccount` and `demoPositionView`. It never calls replay, risk triggers, settlement or commit. The response contains open positions, active orders, aggregates and ledger totals, not journal, closed history, event history or ledger entries. Normal fixture response: 2,807 bytes. Regression tests enforce a normal-account target below 25 KB and a 50 KB ceiling; these are tests, not truncation of legitimate large active accounts.

The browser retains the 30-second live cadence while active. Hidden and idle accounts do not poll live state. Load, visibility return, explicit refresh and successful mutation still update the UI. ACCESS remains every 15 seconds with unchanged authorization checks. Mutation receipts remain backward compatible, but the terminal strips their history before caching.

`GET .../native/history` uses revision-pinned keyset pagination, descending timestamp plus ordinal, maximum 50 rows. PostgreSQL extracts just the requested page from an immutable revision; the full document does not cross the connection. History tabs request pages on demand. Chart tools request all pages for the selected symbol only, including original entry-candle and exit metadata. A missing revision or invalid cursor is an error, never an invented empty history.

## Server processing

With the owner's explicit approval, historical-only open positions now enter the existing server executor, using the unchanged REFRESH command/replay path. Its interval remains 10 seconds; all configured accounts are visited with four in flight. This removes dependence on a browser command for historical funding/protection processing. `POST .../native/execution-session` renews only scheduler session metadata after original authorization; GET live never renews or writes a session. Every executor read and commit still reauthorizes the persisted user session. Expired/revoked sessions fail closed.

An executor-only bounded cache retains at most four authoritative accounts, each at most 8 MiB serialized. Every use reads the actual authoritative revision, rechecks authorization, and returns a deep clone. A revision change reloads the full account; idempotency and commit CAS remain unchanged. Browser/live paths cannot access this cache as execution state.

## PostgreSQL measurements

Actual server-to-client PostgreSQL protocol bytes were counted by a loopback TCP proxy, including query/transaction responses. This is not an estimate from JSON length, disk reads, or a measurement of Neon billing. The disposable local database had the real schema and existing immutable-revision trigger. The synthetic account was created through the existing engine: 118 closed trades, one open position, 352,204-byte authoritative payload.

Each workload advances an injected clock through 120 observations at 30-second spacing (one simulated hour, not a wall-clock soak). The worker-inclusive workload additionally executes 360 existing 10-second REFRESH commands. Provider observations are deterministic and unchanged across comparisons. Baseline repository code is loaded directly from the fetched main SHA. Connection startup and the one-time missing-projection rebuild are excluded; executor cache misses and command writes inside the measured workload are included.

| Metric, 120 UI cycles | Before | After |
| --- | ---: | ---: |
| DB protocol bytes | 47,616,004 | 431,520 |
| SQL reads | 872 | 1,200 |
| SQL writes | 8 | 0 |
| Response bytes | 39,665,040 | 336,840 |
| UI latency p50 / p95 | 29.01 / 37.79 ms | 11.19 / 14.17 ms |
| DB bytes including 360 worker samples | 185,855,882 | 4,076,671 |
| SQL reads including worker | 3,394 | 3,758 |
| SQL writes including worker | 8 | 12 |
| UI latency with worker p50 / p95 | 61.38 / 69.41 ms | 11.00 / 14.22 ms |

Live-path reduction: **99.094%**. Worker-inclusive reduction: **97.807%**. SQL read count increases because the original authorization envelopes are retained. The four additional worker-inclusive writes are derived projection upserts, not extra financial revisions. Pure live reads leave the complete authoritative payload unchanged. All 120 visible account/PnL results match; worker-inclusive persisted financial outcomes match. Raw report: `docs/qa/native-egress/measurements.json`.

Reproduce against an isolated localhost database named `voltex_native_egress_test`, after applying the repository migrations and generating Prisma:

```powershell
$env:NATIVE_EGRESS_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55440/voltex_native_egress_test?sslmode=disable'
$env:NATIVE_EGRESS_BASE = 'ff7c26b8363a0e9c543ff04afd9be918229fdcdc'
npm run build
node scripts/measure-native-egress.cjs
```

The benchmark creates fresh synthetic identities and retains immutable revisions. It refuses non-loopback or differently named databases. Never supply a production connection.

## Validation

- Backend TypeScript build: PASS. Frontend TypeScript/Vite production build: PASS.
- 31 focused native suites: 446/446 passed together with PostgreSQL enabled. An additional chart-history hook regression passed afterward (four hook tests, 447 total focused tests).
- Existing OPEN/CLOSE, partial/reduce-only, TP/SL, Cross/Isolated, replay, immutable evidence, idempotency and access tests preserved. One existing test's Prisma fixture adds only a projection-upsert stub.
- New PostgreSQL checks: atomic rollback, matching revisions, missing/corrupt/stale recovery, complete ordered 123-row cursor traversal across a new commit, executor cache invalidation and revoked-session denial, historical-only executor admission.
- Real React/JSDOM hook tests exercise active/idle/hidden timers, visibility return, unchanged ACCESS cadence, lazy history, selected-symbol chart pages and entry metadata retention.
- Browser QA on the actual production bundle at `http://127.0.0.1:4397/futures`, using local synthetic market/account fixtures and real native routes plus PostgreSQL: account/PnL and open position visible; live requests 200; no browser REFRESH command; history lazy, next page adds 50 rows; order history and chart tools/position line load; no console errors. No production-market or production-session QA is claimed. Some public header fields remain unavailable in the pre-existing layout fixture, outside this change.
- `node --check` on both scripts and `git diff --check`: PASS.

For local visual reproduction, run the benchmark, build frontend, then `node scripts/qa-native-egress.cjs` with the same local database variable. It selects a synthetic benchmark identity and generates a local-only session token in memory.

## Preserved code and remaining risks

No engine, replay, account-model, collateral, ledger, margin, fees, PnL or liquidation formula implementation changed. `service.ts` adds a read-only caller of existing helpers; `store.ts` and `limitPass.ts` change persistence/scheduling only. Matching engine, real balances, financial permission guards, withdrawals, execution whitelist and CopyPerformance are unchanged. Current main's terminal presentation is retained; FuturesPage adds only history demand and a next-page control.

Before any future deployment, apply the additive migration and ensure the existing executor is enabled. Historical processing now follows its existing 10-second server sampling cadence rather than browser-driven 30-second samples, as authorized; identical calculations are proven for identical observations, not identical trigger wall-clock times across different observation schedules. Expired sessions continue to halt execution by design.

Local measurements do not prove production Neon latency or a universal 90% saving: more than four active accounts can churn the bounded executor cache; accounts over 8 MiB bypass it; frequent financial commits reload authority; cold rebuilds read authority once. History pagination reduces egress but still scans JSONB within PostgreSQL, so very large histories can remain CPU-intensive. Large numbers of active positions can legitimately exceed the normal-fixture payload budget. No history is truncated to meet a byte target.
