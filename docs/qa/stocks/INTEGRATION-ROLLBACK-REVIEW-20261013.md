# Stocks integration and rollback review — 2026-10-13

**Verdict: BLOCKED. The current implementation is a loopback review service.**

This is an evidence-grounded plan, not a deployment configuration or a record of production integration. No gateway, frontend fence, running service, existing account data, or production configuration was changed for this review. The subsequent local identity-contract correction below uses disposable fixtures only. Existing owner approval is conditional on **all** release gates passing; it does not permit publication while the gates below remain blocked. This document does not request the same approval again. New broker connectivity, a streaming architecture, paid infrastructure, or weakened security is outside this plan.

## Exact source baseline

- PR #512: `26e929f03793b8e5a96a5526ecabd31515946234`.
- Locally refreshed `origin/main`: `055f88a945c8253b2736877b52f32d028c895086`.
- PR #497 local remote branch: `2f6fa3f7ec152a1849fb12c3694854963694af14`.
- The read-only comparison `origin/main...HEAD` contained no changed paths under `prisma/`, `src/`, or the root `Dockerfile`, `docker-compose.yml`, and `Caddyfile`. This does not prove main is integrated, authorize a merge, or establish the deployed state.
- Source references below use this baseline. They must be rechecked against the eventual integration SHA and actual packaging before publication.

## Confirmed boundaries and gaps

| Area | Source evidence | Consequence |
| --- | --- | --- |
| Approved terminal | `frontend/src/pages/stocks/StocksPage.tsx:13–25` loads GlobalStocks only when its build flag is enabled **and** `window.location.hostname === '127.0.0.1'`. | A public build flag alone does not publish Professional B; public hosts fall back to widget/legacy Stocks. The hostname fence must be handled in a reviewed integration change, not silently removed during deployment. |
| Frontend flags | `frontend/vite.config.ts:31–36` defines `VITE_STOCKS_ENABLED` and `VITE_STOCKS_GLOBAL_SIMULATOR`; `frontend/src/pages/stocks/global/GlobalStocks.tsx:20` reads `VITE_STOCKS_OWNER_USDT_ONLY`. | These are build-time choices. The USDT flag changes presentation; it is not the server authorization control. Do not accidentally enable the older single-owner simulator as a substitute. |
| Wallet | `frontend/src/pages/wallet-v3/useStockPortfolio.ts:6–7,30–49` depends on the global-simulator flag and sends same-origin `/__stocks_global/portfolio` with bearer authorization and `credentials: 'omit'`. | Disabling **only** `VITE_STOCKS_ENABLED` does not stop Wallet reads. Rollback must also disable `VITE_STOCKS_GLOBAL_SIMULATOR`, and deny the Stocks route for already-cached clients. |
| HTTP service | `services/stocks-global/server.mjs:112,170` requires exact loopback Host/Origin and listens on `127.0.0.1`. | There is no public ingress contract here. Removing these checks without a replacement is not integration. |
| Existing proxy | `services/stocks-global/local-proxy.mjs:34–48` explicitly permits only distinct literal loopback origins and states that it does not authenticate users. | This is a local review gateway. A public proxy cannot be declared ready by merely rewriting Host/Origin to satisfy it. |
| Production packaging | Root `docker-compose.yml:3–68` defines db, API, frontend and Caddy, but no Stocks-global service or persistent Stocks account directory. `services/stocks/Dockerfile:1–6` starts `runtime.mjs`; `services/stocks/compose.review.yaml:1–27` is an isolated, network-disabled read-only review service. | The existing Stocks Dockerfile/Compose pair is a **different** service and cannot be reused as an authenticated simulator deployment without a reviewed package definition. No current host arrangement is inferred from these repository files. |
| API container | Root `Dockerfile:41–46` invokes `prisma migrate deploy` in its startup command. | Do not reuse this image/startup for Stocks. This plan does not require restarting or migrating the production API. |

## Identity and owner policy

At the baseline, `services/stocks-global/identity.mjs:6–24` forwards an existing Bearer token to one configured `/api/v1/me` endpoint. It permits HTTPS, or literal HTTP loopback for review; it disallows redirects, URL credentials/query/hash and has a three-second deadline. It resolves `user.id`, rejects blocked/deleted users, and rechecks identity on every request. It does not decode JWTs or read signing secrets.

**Confirmed contract defect and local candidate fix:** the baseline's 16 KiB response cap rejects valid authenticated profiles because `/me` includes `avatarUrl` (`src/api/routes/account.ts:97–113`). The API accepts 512 KiB decoded images, up to 1 MiB encoded strings, and preserves the original data URL (`:33,47–48,60–66,132–143`); the upload JSON limit is 1 MiB (`src/index.ts:216`). A whitespace-padded base64 image may therefore exceed the size of canonical base64 while still passing the existing API checks. The Stocks-only local candidate uses **1 MiB plus the existing 16 KiB metadata allowance**, early Content-Length rejection and authoritative streamed byte accounting, fatal UTF-8 decoding, a bounded growing buffer, the same three-second whole-request deadline and cancellation/release on error. It does not make the response unbounded or change the authority, owner policy, session validation or API. Fixture tests in `services/stocks-global/identity.test.mjs` cover the canonical maximum, accepted padded avatar, byte-limit/UTF-8 errors, revocation and stalled-body/header cleanup. This is a local contract correction, **not verified production authentication compatibility**; its final commit/test result must be recorded separately.

`services/stocks-global/accounts.mjs:8–12` derives the account namespace from SHA-256 of `[issuer, subject]`. Client account IDs cannot select another ledger. Changing the configured issuer or the authority's stable subject mapping would select a different namespace; it is not an account migration.

Authenticated CLI startup in `services/stocks-global/server.mjs:184–190` requires `STOCKS_ACCOUNTS_DATA`, a configured identity authority/issuer, and `STOCKS_TRADE_OWNER_SUBJECT`. It enables owner-only mode. The owner subject is the authority's user ID, not an email, browser-provided role, or UI flag. Existing USDC history remains in the ledger; new owner-review submissions are USDT-only. Preserve the server policy even if UI controls are hidden.

**Not verified by this review:** the live authority's response/session behavior, actual production token transport, logout/revocation propagation, gateway routing, TLS policy, stable production subject/issuer configuration, or measured impact of repeated `/me` calls on session storage. No live authentication request, private account query, cookie/token read, or authorization-secret inspection was performed. The independently reviewed API source resolves sessions and ContactEmailPolicy in `requireAuth`, may fire a `lastSeenAt` update when stale (`src/api/middleware/auth.ts:65–101`), and then reads the user profile for `/me`. Production-compatible authentication load is therefore a **separate release gate**: SQLite-only fixture workload does not model these Prisma/policy/profile operations. A real `/me` request must not be represented as a guaranteed mutation-free check.

The gateway integration must preserve method/path/query/header/body limits, per-request identity, account-scoped CSRF, safe error bodies, disconnect propagation and bounded waits. It must not cache identity or replay order/cancel requests. An HTTP timeout is not proof that a dispatched ledger transaction rolled back. Account/storage errors and unknown outcomes must remain distinguishable.

## Isolated runtime, persistence and migration

The intended unit is **one dedicated Stocks HTTP process with its existing single SQLite worker thread**, not a new exchange API or a second financial collector. `services/stocks-global/account-worker.mjs:21` creates the worker. The selected Node runtime must support the used `node:sqlite` and Worker APIs and pass the exact artifact's tests; no unmeasured CPU/RAM allocation or host capacity is prescribed here.

`services/stocks-global/accounts.mjs:15–36` opens only the configured `.sqlite` file and creates `paper_accounts(id TEXT PRIMARY KEY, ledger TEXT NOT NULL) STRICT`. It uses `journal_mode=DELETE`, `synchronous=FULL`, and `busy_timeout=1000`. `services/stocks-global/engine.mjs:14` creates ledger schema 2. There is no Prisma/PostgreSQL migration required by this isolated service. Unrelated release migrations are outside this conclusion.

Required packaging decisions before launch:

1. Pin the reviewed source/runtime artifact, explicit Stocks entrypoint, environment allowlist, working directory and resource/log bounds. Do not inherit real broker credentials, production database URLs or unrelated application startup commands.
2. Use a new, dedicated persistent account directory, a fixed absolute `STOCKS_ACCOUNTS_DATA` path, and a dedicated unprivileged service identity. Mount the **directory**, including SQLite's rollback journal, not just one database file. It must remain writable across atomic SQLite recovery; build/image replacement must not discard it.
3. Apply and verify private directory/file permissions operationally; `openAccounts` does not establish a production UID/volume permission policy. Keep one supervised service instance; do not introduce horizontal replicas or shared-network storage from this single-host design.
4. Preserve the issuer, owner subject and database path through restart. Do not assign the old ownerless V2 JSON to the first authenticated user. An explicit ownership migration would be separate work; no import is part of this plan.
5. Establish a consistent backup and restore procedure for this isolated SQLite directory. Reuse an approved applicable workflow if one exists; its existence is **not confirmed here**. A plain copy of a live database file alone is not accepted as backup proof. Prove a quiescent or SQLite-consistent backup, checksum, restore into a separate fixture directory, integrity and account reconciliation. Never exercise restore against production data during preparation.

The service's bounded queue, durable acknowledgements, quote freshness, accounting arithmetic, idempotency and owner policy must remain unchanged. A process restart is not permission to reset a ledger or replay uncertain mutations.

## Proposed integration sequence and release gates

These are reviewable prerequisites, not commands to deploy now.

1. **Source integration:** reconcile the exact PR stack with current main, retaining other modules. Record the final source and artifact hashes, actual changed paths, build flags and runtime entrypoint. Run the required exact-head CI, browser and regression suites on that result.
2. **Public transport/UI contract:** separately implement and review the public static-frontend route, the explicit approved-host replacement for the loopback terminal fence, and a TLS/authenticated gateway for only `/__stocks_global/`. Verify the gateway cannot reach unrelated API routes and retains all current security and cancellation properties. Current code supplies no production adapter to declare already complete.
3. **Disposable staging:** use test identities and a new isolated SQLite directory to exercise the real browser/gateway/service arrangement, including owner and non-owner requests, forged/expired/revoked identities, Origin/Host/CSRF rejection, body limits, logout/account switch and stale response fencing. No real funds, production account DB or external order endpoint is needed.
4. **Persistence and rollback rehearsal:** prove full/partial paper Buy/Sell, order cancellation, reserved balances, pending-limit and history persistence, graceful stop/reopen, failed commit, post-COMMIT lost acknowledgement, same-ID retry and Alice/Bob isolation. Verify the proposed rollback artifact against a **copy** of a new-format fixture ledger and its owner policy before relying on binary rollback.
5. **Data and capacity:** obtain documented rights for the specific Bybit/Binance uses described in `services/stocks-global/DATA-RIGHTS.md`; preserve blocked MOEX/SBER. Source availability and green CI do not confer redistribution permission. Resolve the original strict performance/coexistence gates using measured evidence. Existing fixture/model and real-host observation reports retain their stated scope; no completed production capacity or 24-hour acceptance is claimed here. A one-off successful metrics preflight is not a 24-hour run.
6. **Conditional publication decision:** publish only if every applicable integration, security, data-rights, resource, backup/restore and rollback gate passes under the owner's existing conditional authorization. Otherwise retain BLOCKED and state the failed gate. No additional server purchase, provider-limit increase or weaker safety criterion is assumed.

## Rollback sequence and preservation contract

Before publication, retain a known-off frontend artifact, the exact Stocks artifact/configuration, stable account namespace settings, the verified backup/restore evidence and a documented way to deny **only** the Stocks routes.

1. On a failed smoke or isolation check, stop new Stocks admission at the reviewed gateway, including requests from cached clients. Preserve other API, Spot, Futures and wallet routes. Keep the failure visible; do not return fictitious success or auto-retry mutations.
2. Restore the frontend artifact with **both** `VITE_STOCKS_ENABLED=false` and `VITE_STOCKS_GLOBAL_SIMULATOR=false`. This removes navigation and Wallet's Stocks reads for refreshed clients; the gateway denial remains necessary for old tabs and bundles.
3. Drain and stop only the Stocks process through its existing graceful path. `services/stocks-global/server.mjs:181,190` closes HTTP admission, waits for refresh/context/native/full-FX work, then closes the account worker. `services/stocks-global/account-worker.mjs:120–124` drains accepted work rather than declaring it rolled back. Do not kill API/DB/collectors as a Stocks rollback action.
4. Retain the current private SQLite database, journal/recovery evidence and audit history. A lost response may follow a committed operation: reconcile durable state using the same request ID/payload before any retry. Never delete/reset the database, drop tables, transfer data to real wallets, or overwrite post-backup accepted operations with an older snapshot.
5. Prefer **feature off with preserved data** until the cause is understood. Ledger schema 2 alone does not prove an old binary's compatibility: an older implementation may allow a different owner policy, account behavior or financial command set. An old ownerless JSON service or a less-restrictive authenticated service is not an automatic rollback target. Restore from backup only through a separately verified recovery procedure that accounts for later durable operations.

## Existing regression pointers and audit limits

The initial boundary audit was read-only. The subsequent local identity correction ran `identity.test.mjs`, `accounts.test.mjs` and `owner-usdt.test.mjs`: **19/19 PASS** (11 new identity fixtures, six existing account tests and two owner-policy tests; approximately 6.24 seconds). The two timeout fixtures each returned after approximately three seconds. This is local candidate evidence, not full CI or live-auth proof. The other regression pointers below still need inclusion in the exact integration/rollback rehearsal; listing them does not claim they were rerun in this audit:

- `services/stocks-global/accounts.test.mjs:20,36,49,55,66,75`: Alice/Bob namespaces, atomic cross-repository transactions, failed commit, restart/legacy-history preservation, identity failure modes and HTTP isolation/MOEX block.
- `services/stocks-global/owner-usdt.test.mjs:21,32`: missing/malformed owner configuration, non-owner mutation denial, USDC/manual-refresh bypass denial.
- `services/stocks-global/worker-http.test.mjs:49,69,85,108,123`: HTTP availability during commit, unknown outcomes/unhealthy worker, concurrent account initialization, overload and undispatched `ACCOUNT_BUSY` behavior.
- `services/stocks-global/account-worker.test.mjs:75,92,108,188`: no optimistic pre-COMMIT acknowledgement, crash/unknown post-COMMIT outcome, restart/idempotency and cancellation recovery.
- `services/stocks-global/local-proxy.test.mjs:35,59,79,90,101,108,117`: existing **loopback** route/header/origin/body/timeout/disconnect contract; these do not test a nonexistent public gateway.
- `services/stocks-global/demand-lifecycle.test.mjs:19,25,40`: no autonomous owner-review provider work, Wallet projection without order matching and lease-release admission fencing.
- `services/stocks-global/wallet-fx-scope.test.mjs` and `frontend/src/lib/__tests__/stockWalletDemand.test.ts`: Wallet FX capability/freshness and demand/session isolation.

Current unresolved release items are the reviewed public integration, verified production identity/session contract, durable operational packaging and recovery, data-use rights, and outstanding performance/coexistence/capacity acceptance. No production or private authentication data was accessed for this document.

## Reviewed implementation and local validation

The identity/projection/history fixes are committed as `f80d079221d23931ef979a14dd98f290f3d7550e` on the authorized PR #512 branch. The complete mandatory local Stocks runtime set passed **192/192**, no failures/skips/cancellations; backend/frontend TypeScript and the enabled owner frontend production build passed. The existing Vite chunk-size warning remains. [Local source/result provenance](../../evidence/stocks-boundaries-20261013/local-validation.json) and [CPU/deadline evidence, including negative controls](../../evidence/stocks-boundaries-20261013/view-projection/README.md) are retained. Final-head Linux CI is recorded in PR #512 after push, separately from the baseline runs. No production wiring, live identity compatibility, capacity or data-rights gate is closed by these local results.
