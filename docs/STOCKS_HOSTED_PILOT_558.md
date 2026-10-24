# Stocks same-app private pilot — source-only review

Base: PR #556, `59db30e27a9803a879ca1f714055b34093bbad2a`.
Fresh main inspected: `f81df788a8ddcc5d925b827b6e783f6e21dc39fa`.
The containing commit is the single integration candidate; delivery SHA and
bundle digest are in the accompanying local `output/issue558/delivery.json`.
No change to #556, production flags, real accounts, balances or infrastructure.

## Current owner policy (Issue #558, 23 Oct 2026) — Stocks orders are a silent NO-OP for everyone

Until a new explicit owner instruction, **no account executes a Stocks order**, including the owner, Ksenia
and team testers. The catalogue/terminal may be visible behind its own gate; BUY/SELL (Market/Limit, click or
Enter) stay clickable and do nothing: no request, no message, no draft change, no balance/position/history change.

How this candidate enforces it, server-first:
- `STOCKS_ORDER_EXECUTION_ENABLED` is OFF by default. With it off, the API's readiness proof reports
  `tradingEnabled: false` (it is `STOCKS_TEST_CASH_ENABLED && STOCKS_ORDER_EXECUTION_ENABLED`); the release gateway
  takes its trading switch from that proof alone, so it grants **nobody** `canTrade` and the terminal shows every
  account, the two bound traders included, as a silent viewer. Before this change the readiness reported only the
  test-cash gate, so a pilot with wallets on and execution off would have let the traders' clicks reach the API and
  show its refusal.
- Defense in depth from Codex's #611 patch (`d362fb80`), ported unchanged in intent:
  - the gateway's `createServer` defaults `financialEnabled` to **false** (only explicit isolated fixtures opt
    in; the local CLI only with exactly `STOCKS_ORDER_EXECUTION_ENABLED=true`); with it off every financial POST
    is refused with 403 `ACCOUNT_TRADING_DISABLED` before any body, token, account or authority work, and no
    financial GET observation or background matching runs;
  - `GlobalStocks` has its own build gate `VITE_STOCKS_ORDER_EXECUTION_ENABLED` (default OFF): account data the
    server permits may be shown (`mayReadAccount`), but no order, cancel, balance or refresh request is sent unless
    this gate is also on — so even a stale or forged `canTrade=true` stays silent.
- A forged order is refused at every layer: frontend (no request), gateway (403 `ACCOUNT_TRADING_DISABLED`) and the
  API's second gate (403 `ACCOUNT_TRADING_DISABLED`), also when sent with the gateway's own key.
- The two-trader PostgreSQL capability and its acceptance stay in the code, reachable only with both server gates
  explicitly ON in a disposable environment (`qa-stocks-hosted-browser.cjs` «gated acceptance» steps). Never set them
  in production without that new owner decision.

## Consolidated candidate (replaces the split #609 / #610 / #611)

| Was | Now |
| --- | --- |
| #609 PG authority, authenticated gateway, hosted browser acceptance | kept |
| #610 venue/market-data adapters, `DATA_RIGHTS_UNVERIFIED` | kept |
| #611 `VITE_STOCKS_HOSTED_PILOT=true` + `VITE_STOCKS_ENABLED=true` | **one** flag: `VITE_STOCKS_CATALOGUE_VISIBLE=true`. A build that still sets `VITE_STOCKS_HOSTED_PILOT` (any value) stops with a message naming the new flag. |
| #611 `RequireAuth` on `/stocks` routes | both routes always behind the ordinary VOLTEX login, as Spot/Futures |
| #611 build refusals (simulator / widget preview / custom `VITE_STOCKS_ORIGIN` with hosted) | all three refuse the hosted build; checked by the `hosted-build-contract` CI job |
| #611 `shouldMountGlobalStocks` + tests | ported (`stockHostPolicy.ts`, `stocksHostedPilot.test.ts`, `stocksOriginalRouting.test.ts`) |
| #611 runbook `STOCKS_HOSTED_PILOT_REVIEW.md` | folded into this document (gates, release order, rollback) |
| #611 execution patch `d362fb80` (gateway default OFF, early 403, OFF read/background guards, `VITE_STOCKS_ORDER_EXECUTION_ENABLED`, `execution-off.test.mjs`, PG OFF test, `qa-stocks-hosted-silent.cjs`) | ported; the visibility flag stays `VITE_STOCKS_CATALOGUE_VISIBLE` (owner coordination, #613); the Futures funding QA-clock fix stays out (different scope; `native` is green here) |

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
| Frontend execution (#611) | `VITE_STOCKS_ORDER_EXECUTION_ENABLED=true` | Build gate in `GlobalStocks`; without it no order/cancel/balance/refresh request is ever sent. Never set for a hosted build without a new owner decision. |
| Order execution (PR #593) | `STOCKS_ORDER_EXECUTION_ENABLED=true` | Second server gate on `/stocks-test-cash/command`, off unless exactly `true`; with it off both bound traders get 403 `ACCOUNT_TRADING_DISABLED` before the authority runs, and the readiness proof reports no trading, so the gateway grants nobody `canTrade` (silent viewers). Requires the financial gate as well. |
| Market data | `STOCKS_MARKET_DATA_ENABLED=true` | Explicit provider activation only after data rights/feed readiness. Default unavailable with no provider requests or prices/candles. |
| Extra venues (#561) | `STOCKS_VENUES_ENABLED=gate,mexc,…` **and** `STOCKS_VENUE_RIGHTS_CONFIRMED=<same list>` | Only with market data on. Each venue must also be in the operator's data-rights attestation, otherwise the API refuses to start (`DATA_RIGHTS_UNVERIFIED`). A venue left out gets no request; its rows stay hidden and its instruments answer `DATA_RIGHTS_UNVERIFIED`. The attestation records a confirmed licence; it is not one. |
| Binance host (#561) | `STOCKS_BINANCE_HOST=data-api.binance.vision` | Optional: Binance's documented public market-data host (same paths). Any other value refuses to start. |

Hosted frontend: keep the existing production `VITE_API_URL` exactly as it is (the public frontend and the
API are separate hosts; `frontend/src/lib/api.ts` needs the full API URL there). Do not switch it to the
relative `/api/v1` unless real same-origin API forwarding is proven. `GlobalStocks` calls the relative
`/__stocks_global/*`; routing that path from the public frontend host to the trusted-ingress adapter below
was only exercised in an emulated local edge and is **NOT_VERIFIED** on production hosting (release
blocker; topology owned by the separate Codex task on #613). Do not set
`VITE_STOCKS_GLOBAL_SIMULATOR`, `VITE_STOCKS_SIMULATOR`,
`VITE_STOCKS_WIDGET_PREVIEW` or `VITE_STOCKS_ORIGIN`; a mixed hosted/fixture or
cross-origin build is rejected.
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
