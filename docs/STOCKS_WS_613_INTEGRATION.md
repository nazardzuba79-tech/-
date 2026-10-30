# Stocks #613 — nine-venue integration and future configuration

Source: reviewed #614 54bff04ea633200b39a81683af77f0cd9c786069, atop canonical #613 aeaf20f973e2ffa4c810ecee9e19d049b76d5de7. This is code-only integration, not production activation. No financial engine, account store, PostgreSQL schema, JWT/session logic, DemoBalance, Spot/Futures, TYVN or ECLAVO change.

## Code and current evidence

- Nine venue adapters; 55 exact online metadata-confirmed identities: Binance13, Bybit7, Gate5, MEXC9, OKX5, KuCoin2, Kraken5, BingX4, Bitget5. MEXC xStocks/Ondo, Binance bStocks, Backed xStocks, OKX assets and Bitget rTokens stay distinct.
- Eighteen exact AAPL/TSLA venue identities have complete captured WS last/bid/ask across public observations. This does not mean all 55 have been live-verified. Latest bounded sequential probe: 11/18 fresh at sample, 18/18 real 300-bar REST histories, 13 native WS candle paths. Sparse/stale/unavailable responses remain visible; no freshness extension.
- Gate AAPLX complete ticker and KuCoin AAPLX snapshot volume now captured. KuCoin snapshot BBO mapping and Bitget UTA object candle mapping have RED→GREEN tests.
- Bitget native rToken events remain UNCONFIRMED; ACKs and REST bars do not prove WS OHLCV. Official 1m rToken candle messages omit volume. No volume or candle is invented. Other timeframes may also have no update in a bounded window.
- Browser uses actual React catalogue/Professional B components, nine source-menu selections, actual 5m REST responses, same-page upstream reconnect, desktop1440/mobile390 and zero financial POST. It is a disposable local public-data reader, not proof of production login. Hosted PostgreSQL login/logout/revocation tests are separate.
- Native USD (Kraken) stays USD. No automatic USD/USDT/USDC parity or unverified conversion. Backpack and MOEX/SBER remain excluded/blocked.

## Existing route is reused

Browser -> same-origin Pages Function /__stocks_global/* -> HTTPS api.voltextech.net -> host Nginx -> loopback signed ingress4438 -> loopback gateway4437 -> PostgreSQL authority. Existing API URL remains https://api.voltextech.net/api/v1 for Login/Spot/Futures/Wallet/Admin; no CEX endpoint or secret is forwarded to the browser.

services/stocks-global/release-entrypoint.mjs already calls createReleaseMarket(), and runtime-market.mjs admits the new shared WS hub only through explicit authority-backed configuration. JSON quote/native-bar fields pass through the existing authenticated read route. No second financial backend, order engine or new public WS port is needed. A future reviewed gateway image must actually contain this application SHA; old Stage A image success does not attest these new files. Current Docker recipe copies the Stocks service tree, including local public decoders and vendored schema provenance.

Existing deploy/stocks-pages-gateway.compose.yaml.example is source-only and remains unchanged: gateway/ingress bind127.0.0.1, ports4437/4438 unpublished, host network for host Nginx, no automatic restart/API/collector replacement. Existing API/collector/bootstrap is preserved. Do not run this example as an activation command.

## Exact future variables — remain OFF now

```dotenv
# Frontend reviewed build; visibility separately owner-approved
VITE_STOCKS_CATALOGUE_VISIBLE=false
VITE_STOCKS_ORDER_EXECUTION_ENABLED=false
VITE_API_URL=https://api.voltextech.net/api/v1
# Existing PostgreSQL-only gateway; secrets supplied privately only after approval
STOCKS_GLOBAL_PORT=4437
STOCKS_INGRESS_PORT=4438
STOCKS_PUBLIC_ORIGIN=https://voltextech.net
STOCKS_API_INGRESS_ORIGIN=https://api.voltextech.net
STOCKS_PAGES_INGRESS_ENABLED=false
STOCKS_ORDER_EXECUTION_ENABLED=false
STOCKS_MARKET_DATA_ENABLED=false
STOCKS_LIVE_WS_VENUES=
STOCKS_VENUE_RIGHTS_CONFIRMED=
STOCKS_BINANCE_WS_ENABLED=false
STOCKS_VENUES_ENABLED=
```

After documented rights and separate owner activation approval only: set STOCKS_MARKET_DATA_ENABLED=true and put only the approved subset of lowercase binance,bybit,gate,mexc,okx,kucoin,kraken,bingx,bitget in STOCKS_LIVE_WS_VENUES and STOCKS_VENUE_RIGHTS_CONFIRMED. Keep legacy STOCKS_BINANCE_WS_ENABLED=false and STOCKS_VENUES_ENABLED empty to prevent duplicate subscriptions. Neither rights variable nor public API availability constitutes a license. Do not populate this attestation speculatively. Catalogue visibility may later be enabled independently; both execution flags stay false for everyone.

Existing required private PostgreSQL authority/internal API and Pages HMAC credentials are reused under separate approval. No new venue API key, broker key, public ingress port or schema is required by these public adapters. KuCoin bullet-public creates only an ephemeral public connection token; do not log/store it.

## Deployment-trigger preflight (read-only, 2026-10-24)

- Cloudflare Pages voltex-exchange: production_deployments_enabled=false; preview_deployment_setting=none; production branch main, owner/repository match. Read at16:28 UTC; rechecked immediately before push.
- Both owner-selected Render workspaces: no canonical #613 branch service, all preview generation off. Active auto-deploy services target unrelated old review branches; auto-deploy main frontend is suspended.
- Northflank Work closure reused as explicitly authorized; no new app configuration/deploy trigger was introduced. GitHub deployment workflows remain main/manual-confirmation controlled; PG/Docker checks use disposable CI resources without production credentials. Stage A/load workflows remain label/manual controlled and are not invoked.
- The existing infra review guard permits normal PR source evolution while preserving all historical migration bytes and protected packagers. No allowlist/assertion/threshold relaxation is part of this change.

## Actual release blockers and rollback

NO-GO for production activation. Commercial public display/redistribution permission is NOT_CONFIRMED for all nine providers. Bitget native rToken OHLCV remains unobserved. Sparse sources cannot promise continuously fresh prices. Current production installation/routing, credential/config readiness and remaining 50 viewers+2 traders / crypto p95<=+5% criteria are not established by this task; the prior Stage A coexistence failures remain failures. No expensive workload was repeated.

Next: review this one canonical candidate and exact-head CI, resolve source rights and remaining native coverage, then seek separate approval for production routing/visibility and any explicitly bounded outstanding acceptance. No merge/deploy is authorized by this document.

Future rollback: leave catalogue/execution/data flags OFF; if a separately approved read-only rollout fails, restore the preceding immutable gateway image and Pages release/config, close only Stocks ingress, retain PostgreSQL data untouched. Do not restart/replace crypto API/collector or reverse historical SQL. Record actual current digests/config in the separately approved production preflight; none were changed here.

Official protocol references: [Gate](https://www.gate.com/docs/developers/apiv4/ws/), [KuCoin snapshot](https://www.kucoin.com/docs-new/3470065w0), [Bitget native candle objects](https://www.bitget.com/docs/uta/websocket/public/Candlesticks-Channel).
