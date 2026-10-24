# Stocks US/RU: isolated local simulator

Review branch only. No broker/order connector, API keys, production database, migrations or deployment. V1 (`services/stocks-simulator`) and its ledger are unchanged. V2 refuses a V1 ledger rather than migrating it. The current review target is **two explicitly bound test traders plus read-only viewers**, not fifty trading accounts. This remains a loopback review service; production integration and capacity are not approved.

The reproducible two-trader fixture preview, source-of-funds boundary, measurements and unresolved checks are documented in [the 2026-10-16 local review note](../../docs/stocks-two-trader-local-20261016.md). Its prices, identities and initial funds are explicitly synthetic; it does not connect or import the owner's existing balances.

## Run

From `frontend`, build into a separate directory (PowerShell):

```powershell
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
$env:VITE_STOCKS_SIMULATOR='false'
$env:VITE_STOCKS_GLOBAL_SIMULATOR='true'
$env:VITE_MARKET_EDGE_URL='http://127.0.0.1:4437'
npm.cmd run build -- --outDir dist-stocks-global
```

The widget flag keeps the existing preview configuration valid; V2 renders native lightweight-charts, not a widget or iframe. Existing Spot/Futures chart indicator functions are reused without modification.

The following ownerless JSON entry point is retained only for legacy isolated tests. It is **not** the current two-trader acceptance entry point. From the repository root, choose a **new, dedicated local ledger path**, not a V1/real ledger:

```powershell
$env:STOCKS_GLOBAL_DATA='C:/path/to/local-review/ledger-v2.json'
$env:STOCKS_LEGACY_SINGLE_OWNER_REVIEW='true' # old ownerless ledger only; never a multi-user server
$env:STOCKS_GLOBAL_PORT='4437'
node services/stocks-global/server.mjs
```

Open `http://127.0.0.1:4437/stocks/BYBIT%3AAAPLXUSDT`. The service binds only `127.0.0.1`. A lock rejects a second writer. After an unclean termination, only remove the exact stale `.lock` after proving that its PID and the listening process are absent; retain the ledger. Frontend global mode is default-off and restricted to loopback.

## Instruments, prices and identity

- Bybit: seven explicitly verified xStocks/USDT pairs. Execution uses timestamped best bid/ask from the public order book; chart candles and volume come from the public kline API. The last-trade display is separate from the executable bid/ask.
- Binance: thirteen explicitly verified bStocks/USDT pairs. Execution uses the last public trade, with its actual trade ID/time, subject to a 60-second freshness gate. This is a conservative paper model, not guaranteed exchange liquidity.
- AAPLX, AAPLB and MOEX shares have separate IDs and positions. There is no silent fallback between token brands or from a token to an underlying stock.
- Bybit's verified `xstockMultiplier` is shown as stock-equivalent quantity. The native token price is **not multiplied again**. Binance's multiplier endpoint requires credentials; native token units are used, and no 1:1 stock-equivalent claim is made.
- MOEX: twenty requested TQBR instruments are catalog candidates. **Live verification failed because `iss.moex.com` could not resolve in this environment.** Their existence/availability and OHLCV remain unverified. No generated prices or candles replace this failure.
- Native US candle intervals: 1m, 5m, 15m, 30m, 1h, 4h, 1D. Initial 300 bars, older pages on demand, frontend capped at 1,500 bars. Binance Apple currently has only 73 daily bars.
- MOEX adapter declares only native 1m, 1h and 1D; other intervals are not offered. Its current bounded date-window fetch is not a complete historical archive/paginator and requires live validation before claiming Russia support.

### Venue adapters and read-only discovery (2026-10-20)

`venues.mjs` holds one adapter per additional venue (Gate and MEXC xStocks for AAPL, NVDA, TSLA, SPY, QQQ; no MSFT xStocks/USDT pair exists on them). `catalog.mjs` carries the issuer family on every row (`xstocks`, `bstocks`, `moex`), the venue rows in `VENUE_CATALOG`, and `SOURCE_PRIORITY`, a per-underlying display order that never substitutes one source for another. A `MarketHub` lists and reads a venue only when constructed with `venues: ['gate', 'mexc']`; by default nothing changes and venue reads answer `DATA_RIGHTS_UNVERIFIED` without a request. `binanceHost: 'data-api.binance.vision'` selects Binance's documented public-market-data host for the existing Binance adapter (`api.binance.com` stays the default). `venuesFromEnv()` reads `STOCKS_VENUES_ENABLED` and refuses any venue not also in `STOCKS_VENUE_RIGHTS_CONFIRMED`; the runtime factories are not wired to it.

`node services/stocks-global/discover-venues.mjs <evidence-directory>` is the bounded, unauthenticated, read-only discovery of nine venues (Bybit, Binance, Bitget, BingX, Gate, MEXC, KuCoin, OKX, Kraken): one metadata read per venue, one ticker and one candle read per listed watch-list symbol, no retry, raw bodies kept. Its output is evidence of technical availability only. Fixtures for the tests are captured venue bodies listed in `testing/fixtures/venues/FIXTURES.md`. Findings, terms and the first-launch recommendation: `docs/STOCKS_MARKET_DATA_DISCOVERY_20261020.md`.

## Conversion and session rules

USDT is the native quote unit for the selected US tokens. There is no assumption that USDT equals USD. USDC uses an observed Binance USDC/USDT trade: `USDC price = USDT price / USDT per USDC`. Rate timestamp is checked independently (maximum 180 seconds). Buys round upward and sells downward to eight decimals.

For RUB, the adapter requires a dated CBR USD/RUB reference (at most 36 hours old) **and** an observed Kraken USDT/USD trade (at most 180 seconds old): `RUB per USDT = RUB per USD × USD per USDT`. USDC adds the independent USDC/USDT leg. The CBR leg is a daily official reference, not an executable FX quote. Missing/stale legs block execution. CBR timed out here; real RUB conversion is **not verified**. Deterministic FX arithmetic is tested with explicitly isolated fixtures only.

US tokens follow their source's instrument trading status, not an invented NASDAQ session. MOEX requires `TRADINGSTATUS=T` and explicitly displays a 15-minute delay. Quote timestamps must be no more than two seconds ahead of the local clock, age must not exceed declared delay plus 60 seconds, and receipt must be within 30 seconds. Failed refresh immediately blocks fills even if the last displayed value remains available. Provider timestamps, never poll receipt times, determine freshness.

## Ledger and execution

- Initial paper cash: 10,000 USDT and 10,000 USDC. Explicit fee setting: **0 bps**, currently the only supported setting. No leverage, shorts or liquidation.
- Eight-decimal BigInt accounting; buy debit rounds up, sell credit rounds down. Weighted entry cost, native chart entry, reservations, partial/full sales and realized/unrealized PnL are isolated by instrument **and settlement currency**.
- Model `observation-cap-1-v1`: at most one native instrument unit per unique provider observation, shared FIFO across orders. This intentionally demonstrates partial fills; it does **not** claim to reproduce venue depth or queue priority.
- Market is IOC: fill up to remaining observation capacity, cancel/release the remainder. Limit is GTC: reserve cash/shares, fill at a qualifying current price, retain the remaining reservation, allow cancellation.
- A limit cannot use an observation timestamp before its submission. Candle high/low never trigger fills. Consequently a delayed MOEX limit must wait for a delayed observation whose original timestamp is after placement; it cannot execute immediately against an already-known delayed candle.
- Idempotency binds a request ID to its full payload. Replayed observations cannot replenish fill capacity. Concurrent mutations serialize, validate and persist before publishing results. Disk failures cannot publish a debit/fill.
- Test capital changes append an audit record, preserve transactions and cannot consume reserved cash. There is no reset endpoint. The preview ledger is not a tamper-proof production accounting system.
- JSON writes use fsync, rename and an exclusive writer lock. Limits: 10,000 orders, 50,000 fills, 1,000 capital adjustments. Reject limits explicitly; no silent history pruning.

## Strict two-trader USDT review mode

Authenticated CLI startup uses `STOCKS_ACCOUNTS_DATA`, `STOCKS_IDENTITY_ENDPOINT`, `STOCKS_IDENTITY_ISSUER` and `STOCKS_TRADE_PRINCIPALS`. The last value is JSON containing **exactly two distinct full trusted `{issuer, subject}` pairs**. Missing, malformed or duplicate pairs fail closed. `STOCKS_TRADE_OWNER_SUBJECT` is not the current CLI authorization contract. Browser email, roles, localStorage flags and account selectors cannot grant trading access.

Each permitted principal must already resolve to its own durable test ledger (`existingOnly`); a missing binding returns `ACCOUNT_NOT_BOUND`. Login, reads and trade submission do not initialize a default balance, refill funds or reset history. Restricted users cannot call the balance-adjustment endpoint. New order submissions accept **USDT** only; historical USDC records are preserved. Build the existing review UI with `VITE_STOCKS_OWNER_USDT_ONLY=true`.

Authenticated viewer catalogue/history reads do not open a financial account. Viewer state and portfolio projections do not call account registration/read commands or run the matcher. Viewers receive no spendable balance; Buy/Sell submit is a client no-op before validation, while forged API mutations still fail backend authorization. The market quote DTO, source checks, freshness limits and cache TTLs are retained.

An existing SQLite test ledger is **not evidence** that its cash equals the real users' current Wallet test cash. Their private identity bindings and a single-authority transactional bridge to the existing test-cash source remain separate integration blockers. Do not seed or copy those balances into this service. The local fixture Wallet adapter is a same-ledger test seam only; it is not the production `DemoBalance` bridge. See the linked note for the required atomic bridge contract and the pending auth-to-commit review.

The dedicated fixture preview exposes **`/__stocks_fixture/wallet`** as a clearly labelled, read-only Fixture Wallet. It reads the existing `/api/v1/demo/vta` fixture response with the current `exchange_token`, showing that account's same-ledger cash, available amount and reserve. It creates no additional balance and does not alter the normal `/wallet` route. Shared real Funding/Wallet authorization remains admin-gated; synthetic users are not falsely promoted to admin to bypass it. Fixture landing/banner links lead to the fixture page, not an alleged real Wallet integration.

## Requests and isolation

Only allowlisted HTTPS **GET** requests to Bybit, Binance, MOEX, CBR and Kraken are implemented. Redirects are rejected; response cap 8 MiB; timeout 6 seconds; budget 100 requests per rolling minute per hostname; coalesced cache capped at 80 entries. Binance metadata requests explicitly name only the thirteen configured symbols. This is an application request budget, not Binance's weighted allowance. The current twenty-symbol polling pattern exceeds this application budget even under ideal same-symbol coalescing; see the measured admission failure and derived call counts in the linked review note.

Frontend state polls every three seconds, selected candle history every fifteen seconds; no twelve persistent sockets or collectors. Catalogue display quotes batch-refresh at most once per minute. Only selected/pending/held instruments enter execution polling. A visible-tab lease expires after twelve seconds; hidden pages stop polling and pending paper orders pause. There is no retrospective fill on resume. Source responses already in flight may finish after hiding.

Host, Origin, Fetch-Site and an ephemeral mutation token protect local routes. Mutation bodies are limited to 8 KiB. `/api`, `/admin`, `/v1`, `/v2`, V1 simulator mutations, quote injection and reset routes are rejected. No route submits external orders. No production credentials are read. Do not expose the local server publicly.

## Rights and remaining blockers

Public endpoint access is technical availability, not permission for public commercial redistribution. This local research preview does not establish redistribution rights. Bybit's API terms restrict competing/repackaged/commercial exploitation; obtain explicit applicable permission before a public product. No subscription, agreement or purchase was made. Russia requires a reachable and permitted MOEX feed, live board/session/candle validation and working FX sources. No SBER real-data trading cycle is claimed.

Primary references checked during research:

- [Bybit order book](https://bybit-exchange.github.io/docs/v5/market/orderbook), [instruments and multiplier](https://bybit-exchange.github.io/docs/v5/market/instrument), [rate limits](https://bybit-exchange.github.io/docs/v5/rate-limit), [API terms](https://www.bybit.com/common-static/compliance/legal/BYBIT/df1923006718fbba8ba70d7d762b9866.pdf).
- [Binance public market data](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market), [tokenized stock reference endpoint](https://developers.binance.com/zh-CN/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data). Binance historical dataset terms are not treated as a blanket license for all REST redistribution.
- [MOEX ISS](https://www.moex.com/a8531), [delayed data](https://www.moex.com/a8589), [ISS reference](https://iss.moex.com/iss/reference/), [information agreement](https://fs.moex.com/files/8553/32786).
- [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data): tokenized assets need `asset_class=tokenized_asset`; native history is capped at 720 bars. [xStocks metadata](https://docs.xstocks.fi/developers).

## Tests

```powershell
node --test services/stocks-global/engine.test.mjs services/stocks-global/server.test.mjs services/stocks-simulator/engine.test.mjs services/stocks-simulator/server.test.mjs
```

Tests use explicit fixtures and disposable local files. The dedicated `scripts/stocks-two-trader-preview.mjs` intentionally serves labelled local fixture prices behind loopback/CSP guards; the normal `MarketHub` adapter does not substitute fixtures for unavailable real sources. `node services/stocks-global/probe.mjs <evidence-directory>` is the separate finite, read-only source-verification command; do not confuse its output with fixture acceptance. See the QA report for actual browser cycles, screenshots, source matrix and blockers.

### Owner Wallet and visible chart lifecycle

With the simulator build enabled, Wallet makes one authenticated `GET /__stocks_global/portfolio` on entry, foreground return or explicit refresh. It is independent of VIP tier. This projection contains only positive USDT paper positions, matching quotes and instrument metadata; it omits paper cash, full order/fill history and all real wallet state. Historical USDC remains in the ledger. Quote marks expire after 30 seconds through a browser timer; this does not poll providers. Failed reads retain same-session quantities but remove valuations. Logout/account switch clears the projection.

The portfolio route reads only held instruments, uses the existing shared quote flights (maximum two), and stops admitting work at its 2.5-second request budget. It never observes quotes into the order matcher. Unavailable marks remain unavailable. SQL transactions, FULL durability, rounding and execution rules are unchanged.

In owner-only mode, visible chart requests renew a 12-second lease and observe only the selected instrument. There is no autonomous server timer for orders/holdings. A visit-specific authenticated DELETE releases the lease on hide, switch, unmount and logout. Disconnect cancels pending quote admission, including observations still waiting in the worker queue. A quote timestamp preceding the start of a resumed visit cannot fill pending limits; an expired/released lease blocks new orders. A transaction already dispatched before disconnect completes atomically; order idempotency remains authoritative. Nonowners receive response-only quotes through the shared cache without observing them into their account or matching orders.

`local-proxy.mjs` is an opt-in loopback review adapter, with strict origin, route, method, query and header allowlists. The browser journey uses this adapter and the actual `identityResolver` against a disposable local `/api/v1/me` fixture, with session revocation. This validates the integration boundary, not production login or entitlement configuration. No production reverse proxy or identity secret is installed.

### Acceptance limits

These owner/Wallet fixes do not resolve or replace Issue #505 capacity gates. Original 0.05-vCPU/256-MiB/disk-throttled and crypto-coexistence failures remain release blockers. Windows guarded functional tests and unthrottled browser results are not Linux capacity acceptance. No production capacity/headroom is confirmed. The catalogue remains 40 configured candidates (7 Bybit, 13 Binance, 20 MOEX), not 250 verified instruments; MOEX is blocked and commercial redistribution rights remain unconfirmed.

### Opt-in Binance WS for isolated Stocks review

The CLI in `services/stocks-global/server.mjs` uses the unchanged REST
`MarketHub` unless `STOCKS_BINANCE_WS_ENABLED=true` is explicitly set. Only
the strict, authority-backed two-trader gateway may opt in; a SQLite-only or
legacy local ledger run is refused with `AUTH_CONFIG_INVALID` rather than
silently starting a new market feed. This selects **one shared server socket**
for the already verified Binance token symbols; viewers do not get individual
connections. The socket opens only on demand and disconnects when unused.
Bybit/MOEX and the main cryptocurrency API are unchanged.

This is **code review / synthetic testing only**, not authorization to ingest
or redistribute live Binance data. Default-off controls and existing
`STOCKS_TEST_CASH_ENABLED`, `STOCKS_TRADE_PRINCIPALS`, and gateway
requirements remain separate. Do not set the flag for any publicly accessible
deployment until applicable provider rights, identities and capacity have been
verified. The flag does not configure a live public reverse proxy, grant
trading rights or change any balance.
