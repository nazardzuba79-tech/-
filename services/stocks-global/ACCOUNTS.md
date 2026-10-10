# Isolated authenticated Stocks paper accounts

This service remains a loopback review service. No production wiring, Prisma, real wallet table, broker credentials or external order adapter is added.

## Identity and ownership

Configure `STOCKS_ACCOUNTS_DATA` to a **new `.sqlite` file**, `STOCKS_IDENTITY_ENDPOINT` to the trusted authority's `/api/v1/me`, and a stable `STOCKS_IDENTITY_ISSUER`. The service forwards the existing bearer token only to that fixed authority. It does not decode JWTs or read signing secrets. Every account/history/order request rechecks identity; failures, revocation, expiry and blocked users fail closed. Redirects are forbidden, responses bounded and the timeout is 3 seconds. Review uses only the loopback fixture authority.

Ownership is the SHA-256 namespace of `[issuer, subject]` resolved by the server. Client `userId`/`accountId`/owner fields cannot select a ledger. POST CSRF tokens are also per-account, combined with strict loopback Host/Origin checks. The browser clears prior account state on login changes and fences late responses; pending idempotency keys are scoped to the server account ID.

## Accounting and durability

Each user gets 10,000 test USDT and 10,000 test USDC. All balances, reserves, positions, orders, fills, conversion evidence, PnL, adjustments and consumed quote observations live in that user's ledger. The same existing engine enforces arithmetic, freshness, FX, idempotency and oversell rules. Paper liquidity capacity is **per account**, one unit per distinct verified observation; users do not consume each other's test capacity.

SQLite uses `BEGIN IMMEDIATE`, `synchronous=FULL`, rollback journals and a 1-second lock timeout. Each transaction reloads authoritative state, validates it and commits before publishing the response. No in-memory ledger cache can overwrite another writer's newer state. Reads after restart recover both users and reservations. This is one-host durable storage, not a distributed production database or backup solution. SQLite ENOSPC/corruption/lock failures return an error, never a new blank account over an existing ledger.

The old ownerless V2 JSON remains byte-for-byte untouched. It is **not assigned to the first login**. Any ownership migration needs an explicit owner mapping reviewed separately. Direct CLI startup of the old mode requires `STOCKS_LEGACY_SINGLE_OWNER_REVIEW=true`; it is unsuitable for multi-user access.

## Shared market data and remaining limits

One MarketHub and one in-flight quote per instrument serve all active accounts. Quote jobs are limited to two; the 2-second observation cache does not renew source timestamps. Provider caches/rate limits remain shared. Polling continues only during each account's visible-tab lease (12 seconds); this is not an always-on offline matching service. At most 512 active context entries are retained; inactive contexts can be discarded, durable ledgers cannot. MOEX is explicitly blocked for quotes/history/order admission pending verified real data; no fallback prices are generated.

The 0.05 CPU / 256 MiB resource benchmark concerns the **read-only candle service**, not this authenticated paper ledger. Its results must not be presented as a 100-user certification for authentication plus durable account writes. A production identity gateway, TLS/reverse proxy, quota/backup/restore design and measured authenticated workload remain launch work. Calling a real `/me` may update session last-seen under existing API behavior; this review never calls production auth.

## Reproduce locally with test identities

Build the frontend with `VITE_STOCKS_ENABLED=true`, `VITE_STOCKS_WIDGET_PREVIEW=true`, `VITE_STOCKS_GLOBAL_SIMULATOR=true`, `VITE_API_URL=http://127.0.0.1:4442/api/v1`, `VITE_MARKET_EDGE_ORIGIN=http://127.0.0.1:4441`, output directory `dist-stocks-accounts`.

Set `STOCKS_QA_IDENTITY=fixture-only` and `STOCKS_ACCOUNTS_DATA` to a new local `.sqlite` file, then run `node scripts/qa-stocks-account-preview.mjs`. It binds only ports 4441/4442 on 127.0.0.1. QA identities: `alice@stocks.test` and `bob@stocks.test`, password `Stocks-QA-only-2026`. These are disposable fixture credentials, not VOLTEX accounts. Sessions expire after one hour and are discarded on restart; log in again to recover the same persistent paper account. Do not expose this fixture authority publicly.

Automated tests use fixture quotes only; screenshots of the local preview use actual provider responses or explicit unavailable states. No synthetic quote is presented as real data. Publication also remains blocked on market-data permissions; see DATA-RIGHTS.md.
