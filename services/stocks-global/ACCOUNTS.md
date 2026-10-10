# Isolated authenticated Stocks paper accounts

This service remains a loopback review service. No production wiring, Prisma, real wallet table, broker credentials or external order adapter is added.

## Identity and ownership

Configure `STOCKS_ACCOUNTS_DATA` to a **new `.sqlite` file**, `STOCKS_IDENTITY_ENDPOINT` to the trusted authority's `/api/v1/me`, and a stable `STOCKS_IDENTITY_ISSUER`. The service forwards the existing bearer token only to that fixed authority. It does not decode JWTs or read signing secrets. Every account/history/order request rechecks identity; failures, revocation, expiry and blocked users fail closed. Redirects are forbidden, responses bounded and the timeout is 3 seconds. Review uses only the loopback fixture authority.

Ownership is the SHA-256 namespace of `[issuer, subject]` resolved by the server. Client `userId`/`accountId`/owner fields cannot select a ledger. POST CSRF tokens are also per-account, combined with strict loopback Host/Origin checks. The browser clears prior account state on login changes and fences late responses; pending idempotency keys are scoped to the server account ID.

Concurrent first requests for one authenticated account share one context-initialization promise and one CSRF token. The principal and command input are cloned at queue admission: changing a caller's object later cannot redirect queued work or alter an accepted order. Authentication tokens are not passed to the database worker.

## Accounting and durability

Each user gets 10,000 test USDT and 10,000 test USDC. All balances, reserves, positions, orders, fills, conversion evidence, PnL, adjustments and consumed quote observations live in that user's ledger. The same existing engine enforces arithmetic, freshness, FX, idempotency and oversell rules. Paper liquidity capacity is **per account**, one unit per distinct verified observation; users do not consume each other's test capacity.

SQLite uses `BEGIN IMMEDIATE`, `synchronous=FULL`, rollback journals and a 1-second lock timeout. Each transaction reloads authoritative state, validates it and commits before publishing the response. No in-memory ledger cache can overwrite another writer's newer state. Reads after restart recover both users and reservations. This is one-host durable storage, not a distributed production database or backup solution. SQLite ENOSPC/corruption/lock failures return an error, never a new blank account over an existing ledger.

Authenticated accounts now run the same SQLite repository and financial engine in **one Node Worker thread in the same service**. No additional server, external database or production service is provisioned. `journal_mode=DELETE`, FULL synchronization, schema, balances, PnL, conversions, execution prices, matching and rounding remain unchanged. The HTTP thread does not keep an authoritative ledger cache. Allowlisted commands call the existing engine functions inside the worker; no functions, SQL text or executable callbacks are accepted across the bridge.

The default admission budget is **128 total outstanding commands** (one dispatched command plus the waiting queue), **1 MiB of serialized input accounting**, and **2.5 seconds maximum waiting before dispatch**. These are service safety bounds, not proof that the budget can serve 128 users. Rejected/expired queued work receives `ACCOUNT_BUSY` (HTTP 503) and never executes later. The worker does not expire an already-dispatched financial operation or pretend that an HTTP timeout rolled it back. Production quote-freshness checks use the worker's clock at execution time; the explicit fixture clock is updated at dispatch, not enqueue.

`ACCOUNT_OUTCOME_UNKNOWN` means a commit may have happened without a reliable response, or rollback could not be confirmed. The worker connection fails closed, undispatched work is rejected and the service requires a controlled restart/reopen before further account commands. No financial command is replayed automatically. Reconcile durable history and retry the **same request ID and canonical order payload** when appropriate. The existing frontend retains its per-account pending order ID after a failed/unknown response, reuses it for the same form payload and clears it only after success. Changing that payload creates a new intent, so it must not be used as a substitute for reconciling an uncertain result. Cancel retries likewise reuse the existing order ID. `ACCOUNT_STORAGE_ERROR` denotes a storage failure without a successful acknowledgement; a mutation whose rollback cannot be proved is classified as unknown instead.

Normal shutdown stops admission and drains the bounded queue, including its undispatched expiry policy, then closes SQLite. It does not discard accepted in-flight mutations or change persistence to asynchronous acknowledgements. Worker failure is reflected in health as HTTP 503. Deterministic failure/block/crash hooks exist only as explicit module-constructor test inputs, never HTTP parameters or production environment flags.

The old ownerless V2 JSON remains byte-for-byte untouched. It is **not assigned to the first login**. Any ownership migration needs an explicit owner mapping reviewed separately. Direct CLI startup of the old mode requires `STOCKS_LEGACY_SINGLE_OWNER_REVIEW=true`; it is unsuitable for multi-user access.

## Shared market data and remaining limits

One MarketHub and one in-flight quote per instrument serve all active accounts. Quote jobs are limited to two; the 2-second observation cache does not renew source timestamps. Provider caches/rate limits remain shared. Polling continues only during each account's visible-tab lease (12 seconds); this is not an always-on offline matching service. At most 512 active context entries are retained; inactive contexts can be discarded, durable ledgers cannot. MOEX is explicitly blocked for quotes/history/order admission pending verified real data; no fallback prices are generated.

Once an account context exists, authenticated history requests use the shared MarketHub without waiting for account SQLite. **The first request for a new principal still waits for durable account initialization**; worker isolation does not remove that cold-start dependency. Background interest reads return only selected/held/active-order instrument IDs across the thread boundary. The existing 12-second visibility lease and financial matching rules remain in force.

The original 0.05 CPU / 256 MiB strict benchmark concerns the **read-only candle service**, not this authenticated paper ledger. A separate realistic fixture measures account reads/commits and history together. It compares the same CPU/RAM budget under the original block-I/O caps and, separately, the CI host disk without those synthetic caps. The latter is not Hetzner disk certification and does not replace the strict gate. Final worker performance/capacity results are pending exact-head measurements; see [SQLite isolation methodology](../../docs/qa/stocks/SQLITE-ISOLATION-20261010.md) and the preserved [previous investigation](../../docs/qa/stocks/OPTIMIZATION-20261010.md).

Optional diagnostics record SQL read/write/BEGIN/COMMIT/ROLLBACK counts, wall time and `process.threadCpuUsage()` inside the database worker. Parsing, validation and JSON encoding are outside the SQL timing. Whole-process CPU includes both HTTP and worker threads and is a different measure. Cached diagnostics expose update age and queue backlog; an in-flight commit may not yet appear in completed SQL counters. Where thread CPU accounting is unavailable, its availability flag is zero and the zero placeholder must not be interpreted as zero SQL CPU.

A production identity gateway, TLS/reverse proxy, quota/backup/restore design and measured authenticated workload remain launch work. Calling a real `/me` may update session last-seen under existing API behavior; this review never calls production auth. Neither green tests nor worker isolation grants market-data rights or guarantees production capacity.

## Reproduce locally with test identities

Build the frontend with `VITE_STOCKS_ENABLED=true`, `VITE_STOCKS_WIDGET_PREVIEW=true`, `VITE_STOCKS_GLOBAL_SIMULATOR=true`, `VITE_API_URL=http://127.0.0.1:4442/api/v1`, `VITE_MARKET_EDGE_ORIGIN=http://127.0.0.1:4441`, output directory `dist-stocks-accounts`.

Set `STOCKS_QA_IDENTITY=fixture-only` and `STOCKS_ACCOUNTS_DATA` to a new local `.sqlite` file, then run `node scripts/qa-stocks-account-preview.mjs`. It binds only ports 4441/4442 on 127.0.0.1. QA identities: `alice@stocks.test` and `bob@stocks.test`, password `Stocks-QA-only-2026`. These are disposable fixture credentials, not VOLTEX accounts. Sessions expire after one hour and are discarded on restart; log in again to recover the same persistent paper account. Do not expose this fixture authority publicly.

Automated tests use fixture quotes only; screenshots of the local preview use actual provider responses or explicit unavailable states. No synthetic quote is presented as real data. Publication also remains blocked on market-data permissions; see DATA-RIGHTS.md.
