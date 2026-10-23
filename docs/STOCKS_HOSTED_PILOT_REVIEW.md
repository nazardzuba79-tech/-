# Stocks hosted private pilot — code-only route gate (Issue #558)

## Scope and exact flags

The existing /stocks production route previously rendered the **information-only** StocksTerminal on a hosted domain. The professional original GlobalStocks catalogue/terminal were compiled only with `VITE_STOCKS_GLOBAL_SIMULATOR=true` and limited to `127.0.0.1`.

This change introduces **one separate opt-in**: `VITE_STOCKS_HOSTED_PILOT=true` **together with** `VITE_STOCKS_ENABLED=true`. Both are **false by default**. A normal VOLTEX session now passes through the same `RequireAuth` gate as Spot and Futures; unauthenticated `/stocks` and `/stocks/:instrumentId` go to login with a safe return URL. The Trading → Stocks navigation still needs `VITE_STOCKS_ENABLED=true`.

With both flags enabled, `StocksPage` serves the existing professional **GlobalStocksCatalogue** at `/stocks` and **GlobalStocks** at `/stocks/:instrumentId` on the hosted site. This is the actual existing catalogue/chart/order UI and session-bound request code, not a new mockup.

**Cannot combine** hosted pilot with any of `VITE_STOCKS_GLOBAL_SIMULATOR`, `VITE_STOCKS_SIMULATOR`, `VITE_STOCKS_WIDGET_PREVIEW` or `VITE_STOCKS_ORIGIN`: Vite rejects those build settings. Existing local-only synthetic simulator remains restricted to 127.0.0.1 and its previous build settings.

## Separate real-data and finance gates — NOT implemented by changing the frontend flag

The professional page talks only to same-origin `/__stocks_global/*` and uses the **existing VOLTEX login bearer token**, original session fences and server account `canTrade`. There is no client-side account override, made-up user, synthetic fallback, new wallet or startup funds.

**Provider/gateway not yet released or verified**: the hosted same-origin route MUST be added only through a later reviewed ingress/gateway connecting an authenticated API to the loopback-only PG-based Stocks authority, with strict Host/Origin/session checks. No direct publicly accessible `127.0.0.1` or gateway port, no frontend-held gateway key, no loose reverse proxy, no cross-origin provider proxy. Where gateway is absent, or rights or instruments are unverified, the original page fails closed with unavailable/empty state. It must never fabricate Bybit/Binance/MOEX quotes.

Viewing Stocks and trading Stocks are distinct permissions:

- **Visibility**: only `VITE_STOCKS_ENABLED=true` + `VITE_STOCKS_HOSTED_PILOT=true`, explicit FUTURE frontend build, default OFF.
- **PG access**: `STOCKS_TEST_CASH_ENABLED=true` only after the two existing privately verified owner/Ksenia accounts, actual DemoBalance USDT, PostgreSQL, gateway/auth and valid data rights are confirmed; default OFF.
- **Order execution**: independent `VITE_STOCKS_ORDER_EXECUTION_ENABLED` (frontend) and `STOCKS_ORDER_EXECUTION_ENABLED` (API and gateway), all default OFF and strict literal `true` only. `GlobalStocks` separates read permission from execution; even stale `account.canTrade=true` cannot create intents, POST or a submit notice while OFF. The gateway's constructor `financialEnabled=false` rejects every financial POST with 403 before binding an account, observing a quote, parsing commands or checking CSRF. Its read/background paths cannot run matching while OFF. Isolated execution fixtures opt in explicitly; existing PostgreSQL authority tests remain intact.

No fake prices or external venue orders. Do not consider frontend route rendering as acceptance of 2-trader execution or market-data licensing.

## Acceptance and later release order — operator action only

1. Merge/review narrow default-off viewer safety patch #593, then review this stacked PR on the new exact base. Run focused route, catalogue/session, and viewer no-POST tests plus an OFF and hosted-pilot frontend build.
2. Before exposing the hosted page: validate an authorized same-origin `/__stocks_global/*` gateway, existing login and session lifetime, missing/invalid data fail closed, provider instrument existence and permission to redistribute quotes. No automatic publication from `main` or review branch.
3. Independently verify PostgreSQL-only authority on supported Node runtime, private bindings to **existing** two accounts, zero new money, migration/backups, wallet isolation, secure gateway and 50+2 resource/p95 acceptance. Old benchmark failures are NOT overcome by these UI changes. Keep execution OFF until evidence passes.
4. Use a separately approved frontend pilot deploy and no-cache asset validation. Test guest/login, logged-in viewer catalogue/terminal with no accepted order, forbidden direct POST (403), session change and two permitted traders in isolated staging. Production account trading needs a separate authorization.
5. Rollback frontend flags OFF to hide Stocks without touching balances or orders; independently leave both backend financial switches OFF. Never restore production DB over newer transactions.

This review branch changes route composition, frontend/gateway execution gates, isolated tests and QA-clock alignment. See [integration and acceptance evidence](STOCKS_611_FINAL_REVIEW.md) for exact scope and unresolved release blockers. **No production release, migrations, accounts, balances, orders, TYVN/ECLAVO timers, API/Worker changes or new paid resource.**
