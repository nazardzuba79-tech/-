# Stocks local simulator

Owner-only, loopback preview built on the Stocks design from PRs #471/#481. This is an isolated paper ledger, not a broker integration or ownership of real securities. No Prisma, production database, real wallet, deposit, exchange order API or collector is used.

## Run locally (PowerShell, repository root)

Use an isolated checkout with dependencies installed. The simulator needs Node 20+; no new package dependencies are required.

```powershell
$env:VITE_STOCKS_ENABLED = 'true'
$env:VITE_STOCKS_WIDGET_PREVIEW = 'true'
$env:VITE_STOCKS_SIMULATOR = 'true'
$env:VITE_MARKET_EDGE_URL = 'http://127.0.0.1:4436'
Push-Location frontend
npm.cmd run build
Pop-Location
$env:STOCKS_SIM_DATA = Join-Path $env:LOCALAPPDATA 'VOLTEX-stocks-simulator/ledger.json'
$env:STOCKS_SIM_PORT = '4436'
node services/stocks-simulator/server.mjs
```

Open `http://127.0.0.1:4436/stocks/XNGS%3AAAPL`. Use this server rather than `vite preview`: it serves the build and isolated order endpoints together. The service requires an explicit local ledger path, binds only to `127.0.0.1`, and never loads `.env` automatically. Do not point it at existing financial storage. `VITE_STOCKS_SIMULATOR` defaults to false and additionally requires both Stocks flags. The UI also checks the loopback hostname. The normal flag-off build removes the simulator API code.

Without credentials the documented Twelve Data public trial supports AAPL. For other supported NASDAQ symbols, set `TWELVE_DATA_API_KEY` in the server environment to an appropriately entitled personal/internal-testing key before starting. Never use a `VITE_` variable for that key. No account, subscription or entitlement is created by this code. Provider credentials are neither returned nor logged. Only a GET to the hardcoded quote endpoint is available; no external order submission code exists.

## Prices and eligibility

- Official TradingView widgets remain responsible for charts. Chart data is never read by the simulator. Execution uses a separate Twelve Data `quote` request with `interval=1min`, `timezone=UTC`, `prepost=false`.
- Symbol, USD currency, NASDAQ exchange, positive decimal price, timestamp/datetime consistency and a boolean market-open flag are validated. The UI displays the source, UTC quote time and actual age separately from the chart's delay label.
- Execution requires quote age <=180 seconds, a receipt within 30 seconds, provider market-open=true, and a weekday in the 09:30–16:00 America/New_York regular session. This is an explicitly bounded minute-price paper model, not tick execution. Provider failures invalidate execution admission. Missing/stale data never becomes a made-up price or zero PnL.
- Provider requests are serialized and limited to 8/minute and 800/UTC day per process. Polling rotates across selected symbols, open orders and held positions every 10 seconds. These local counters are not an account-wide quota; provider limits still apply across restarts/processes. At six requests/minute, 800 requests cover about 133 minutes. Rate-limit exhaustion blocks execution; it does not switch to fabricated data.
- The public trial does not authorize publication or redistribution. This preview is internal/non-production only. A key alone does not establish commercial display rights. Twelve Data's default US feed is a subset of executions, not consolidated NBBO. TradingView and the execution source may differ.

Source review: [usage categories](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage), [trial and Basic limits](https://support.twelvedata.com/en/articles/5335783-trial), [US equities coverage](https://support.twelvedata.com/en/articles/9935903-us-equities-market-data), [official quote interval API](https://github.com/twelvedata/twelvedata-java/blob/main/docs/MarketDataApi.md). Review dated 2026-10-09; public rights and availability may change.

## Accounting rules

- Separate USDT/USDC test wallets initially contain 10,000 units each. The settings panel can explicitly set test capital. Later changes append a balance-adjustment audit record and preserve orders, fills, positions and realized PnL; capital cannot fall below reserved cash.
- Conversion is explicitly `fixed-test-rate`: `pair price = verified USD price / configured USD per test currency unit`. The initial value 1 is a simulation convention shown in the panel, **not** a claim that either stablecoin trades at one USD. Rates from 0.1 to 10 USD/unit and fee basis points can be set before the first order; both are then immutable for that ledger. Positions and cost bases are separate for each symbol/funding-currency pair. There is no cross-wallet conversion.
- Fee defaults to zero; allowed settings are 0–1000 basis points. Fees are included in buy cost and deducted from sell proceeds. Unrealized PnL excludes a hypothetical future exit fee.
- All quantities, cash and prices use 8-decimal integer accounting. Buy prices/notionals round upward, sell prices/notionals downward, and fees upward. Weighted average entry uses total remaining cost/quantity. A partial sale releases proportional cost; the final sale clears remaining cost dust.
- Market executes only with an eligible verified quote. A GTC Limit reserves cash plus fee or available shares and waits until an eligible quote crosses its price. It fills at that quote, including price improvement. Unobserved/offline crossings are not backfilled. Cancellation releases the reservation. Whole orders fill at once; partial position closes are separate fractional sell orders.
- Serialized, persisted transactions and canonical request IDs prevent double execution. Retrying an ID with different content is rejected. Cash and share reservations are checked, so there are no shorts, negative cash, leverage or liquidation.

## Persistence, isolation and limitations

The ledger is local JSON written through a temporary file, fsync and atomic replacement. A failed write does not publish a debit/fill in memory. A lock prevents a second writer. Normal Ctrl+C releases it. After a crash, verify that its recorded PID is no longer running before removing only the stale `.lock`; do not delete/reset the ledger. Reloading and restarting preserve orders, fills, balances and idempotency.

Host, Origin, Fetch-Site and mutation-token checks protect the loopback API from unrelated browser origins. There is no proxy to `/api`, `/v1`, `/v2` or admin/real financial routes, and no HTTP quote-injection/reset endpoint. Test fixtures are injected only directly in unit tests and are never presented as actual market evidence.

This remains a single-owner local review tool, not a multiuser service. It does not model spreads, liquidity, slippage, partial order fills, dividends, splits, tax lots or exchange calendars beyond the provider's session flag plus regular-session time checks. The order ledger is bounded at 10,000 orders and 1,000 capital adjustments. Personal keys and public trials can restrict symbols/coverage. New simulator labels support EN/RU/UK, with English fallback for other locales.

## Tests

```powershell
node --test services/stocks-simulator/engine.test.mjs services/stocks-simulator/server.test.mjs
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath frontend/src/lib/__tests__/stockOrderPanel.test.ts frontend/src/lib/__tests__/stockWidgetLifecycle.test.ts frontend/src/lib/__tests__/stocksPresentation.test.ts frontend/src/lib/__tests__/stockNavigation.test.ts
```

See `docs/qa/stocks-simulator-local-20261009.md` for actual quote-backed browser evidence and distinctions from fixture tests.
