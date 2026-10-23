# Stocks same-app private pilot — source-only review

Base: PR #556, `59db30e27a9803a879ca1f714055b34093bbad2a`.
Fresh main inspected: `f81df788a8ddcc5d925b827b6e783f6e21dc39fa`.
The containing commit is the single integration candidate; delivery SHA and
bundle digest are in the accompanying local `output/issue558/delivery.json`.
No change to #556, production flags, real accounts, balances or infrastructure.

## Owner path after separately approved release

Use the existing VOLTEX login, then **Trading → Stocks**. The menu and
authenticated routes open the existing GlobalStocksCatalogue and Professional
terminal, including mobile. `/login?next=...` uses the existing safe return
validator. The normal JWT/session reaches the API on every request. There is no
new login, owner account, toolbar, seed, account registration or wallet here.

The existing PostgreSQL authority reads and transacts the **same DemoBalance
USDT** as Demo Spot. Both allowlisted principals must already be privately
verified immutable User IDs, with existing authority bindings and balances.
Missing bindings/cash fail closed. Other signed-in users can read the catalogue,
but cannot trade or view another account: their Buy/Sell stays clickable and is a
silent no-op (no request, no message; owner policy 2026-10-23). Logout/revocation and existing
pre-COMMIT fences remain authoritative.

## Separate gates (all existing builds remain off)

| Gate | Future configuration | Effect / prerequisite |
| --- | --- | --- |
| Frontend visibility | `VITE_STOCKS_CATALOGUE_VISIBLE=true` | Same-app authenticated menu/catalogue/terminal. Does not authorize finance. |
| API catalogue identity | `STOCKS_CATALOGUE_ENABLED=true` | PG readiness and normal session identity only. |
| Financial authority | `STOCKS_TEST_CASH_ENABLED=true` | Existing two-principal PG authority operations; requires explicit separate approval. |
| Order execution (PR #593) | `STOCKS_ORDER_EXECUTION_ENABLED=true` | Second server gate on `/stocks-test-cash/command`, off unless exactly `true`; with it off both bound traders get 403 `ACCOUNT_TRADING_DISABLED` before the authority runs. Requires the financial gate as well. |
| Market data | `STOCKS_MARKET_DATA_ENABLED=true` | Explicit provider activation only after data rights/feed readiness. Default unavailable with no provider requests or prices/candles. |

Hosted frontend: use normal same-origin `VITE_API_URL=/api/v1`. Do not set
`VITE_STOCKS_GLOBAL_SIMULATOR`, `VITE_STOCKS_SIMULATOR` or
`VITE_STOCKS_WIDGET_PREVIEW`; a mixed hosted/fixture build is rejected.
`VITE_STOCKS_ENABLED` is the older information/preview flag and is unnecessary
for this hosted path. Hosted trading is USDT-only regardless of browser input.
No existing production env/build file is changed by this candidate.

API and gateway continue to require the existing private `JWT_SECRET`,
`STOCKS_IDENTITY_ISSUER`, `STOCKS_TRADE_PRINCIPALS` and
`STOCKS_TEST_CASH_GATEWAY_KEY` as applicable. Never put their values in browser
configuration, Git or screenshots. `STOCKS_TEST_CASH_AUTHORITY_URL` points to
the internal PG-only API. The readiness proof now explicitly reports the
financial capability; missing/false capability cannot enable gateway trading.

Use the existing Node **22.23.3** `release-entrypoint.mjs`. No SQLite/JSON
fallback is introduced. It still verifies the PG authority before listening.
`STOCKS_PUBLIC_ORIGIN` is the exact canonical HTTPS app origin (no trailing
slash/path/credentials). Gateway remains on `127.0.0.1:4437` by default;
the new trusted-ingress adapter uses `127.0.0.1:4438` (`STOCKS_INGRESS_PORT`).
The TLS reverse proxy must be in this same host/network namespace. A Docker
network layout that cannot satisfy loopback is **BLOCKED**, not grounds to
change either listener to 0.0.0.0. Do not publish either private port.

## Source-only ingress plan — not installed or verified on production

The existing same-origin TLS vhost should route only `/__stocks_global/*` to
the local adapter and preserve the exact public Host and browser Origin.
For this location, clear all client-supplied `Forwarded` and `X-Forwarded-*`
headers. Unexpected forwarded headers are rejected, never trusted. Restrict
the existing public `/api/v1/stocks-test-cash/*` surface at ingress: it is for
the private gateway, not browsers. Ordinary `/api/v1/auth/*` and `/api/v1/me`
continue using the current API routing.

The adapter validates peer/Host/Origin, exact allowlisted methods and paths,
rejects cross-site writes, and forwards only Authorization, Content-Type and
the existing per-view/CSRF headers. No browser-supplied authority key or Cookie
is forwarded. It translates Host/Origin to the unchanged internal gateway
contract only after validation. No user-access decision is cached.
Inflight requests are bounded at 80 with ACCOUNT_BUSY/Retry-After, not an
unbounded Agent queue. Both gateway and adapter preserve 5000 ms keep-alive.
This is a code contract, not a new capacity PASS.

## Focused evidence

- Node22 ingress/startup/boundary checks: exact Host/Origin/path, credential
  stripping, loopback-only binding, unavailable feed and PG-only rejection.
- Existing session-aware GlobalStocks and route regressions are retained.
  New hosted route and desktop/mobile menu cases use actual components.
- `hosted-pilot.pg.test.cjs`: normal password/session login for two **internal
  disposable fixtures**, existing DemoBalance BUY/SELL, exact retry, viewer
  denial, logout revocation and financial-OFF behavior. No owner identities.
- `scripts/stocks-hosted-browser.cjs`: compiled same-app App → normal login →
  actual catalogue → exact BYBIT:AAPLXUSDT → BUY/SELL/reload → normal account
  switch; also the same UI with unavailable data and financial gate OFF.
  TLS edge is emulated locally; API and financial responses use actual
  compiled PG router, gateway and ingress. The emulated TLS edge is **not**
  production topology evidence. External browser requests are blocked.
- TypeScript backend/frontend and hosted Vite build checked. Build retains
  the existing >500 kB chunk warning; it is not hidden or relaxed.

Reproduce only with an explicitly named disposable local PostgreSQL using
`STOCKS_DISPOSABLE_PG_URL`, matching `STOCKS_PG_DISPOSABLE_CONFIRM`, and
`STOCKS_PG_COMPILED_ROUTER=true`. Never provide DATABASE_URL or real credentials
to these acceptance fixtures. Browser artifacts explicitly identify the
internal synthetic test context; no synthetic hub enters the release launcher.

Initial harness issues were corrected without weakening assertions: compiled
authority needs its real wall clock (not the fixture's advanced clock), and
Apple selection must use the exact provider ID rather than the first matching
company name. Initial combined Jest invocation timed out; isolated rerun and
final targeted suite results are recorded separately.

## Future sequence and rollback — owner approval still required

1. Work verifies exact candidate/image, 44+2 migration bytes, backup/restore,
   existing private bindings, ingress topology, licensing and capacity receipts.
2. After separate approval, make only the catalogue visible with financial and
   provider flags OFF. Verify normal login/return, no-data UI and denied orders.
3. Only after independent trading go/no-go, approved licensed feed and 50+2 /
   crypto p95 ≤ +5% evidence, enable the financial path for the two existing
   bindings. Smoke shared DemoBalance, idempotency, cancellation and revocation.
4. Rollback: turn financial and provider gates OFF first, then catalogue
   visibility; restore the previous reviewed frontend/API/gateway images and
   ingress configuration. Keep all financial history. No balance reset,
   compensating order or migration rollback is part of this plan.

**Production readiness remains BLOCKED**: no actual hosted ingress/image test,
new deployment approval, live identity verification, migration/restore
execution, rights confirmation or 50+2 capacity run was performed in this task.
Existing #556 CI and known unsupported SQLite FAIL are neither rerun nor
reclassified as fixed. No new GitHub CI claim is made for an unpublished bundle.
