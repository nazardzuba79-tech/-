# Stocks US/RU: isolated local simulator

Review branch only. No broker/order connector, API keys, production database, migrations or deployment. V1 (`services/stocks-simulator`) and its ledger are unchanged. V2 refuses a V1 ledger rather than migrating it. This is a single-owner loopback prototype, not a multi-user service.

## Run

From `frontend`, build into a separate directory (PowerShell):

```powershell
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
$env:VITE_STOCKS_SIMULATOR='false'
$env:VITE_STOCKS_GLOBAL_SIMULATOR='true'
$env:VITE_MARKET_EDGE_ORIGIN='http://127.0.0.1:4437'
npm.cmd run build -- --outDir dist-stocks-global
```

The widget flag keeps the existing preview configuration valid; V2 renders native lightweight-charts, not a widget or iframe. Existing Spot/Futures chart indicator functions are reused without modification.

From the repository root, choose a **new, dedicated local ledger path**, not a V1/real ledger:

```powershell
$env:STOCKS_GLOBAL_DATA='C:/path/to/local-review/ledger-v2.json'
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

## Requests and isolation

Only allowlisted HTTPS **GET** requests to Bybit, Binance, MOEX, CBR and Kraken are implemented. Redirects are rejected; response cap 8 MiB; timeout 6 seconds; budget 100 requests/minute/provider; coalesced cache capped at 80 entries. Binance metadata requests explicitly name only the thirteen configured symbols. The provider budget counts requests, not Binance weights; current adapters remain below the observed 6,000-weight/minute limit.

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

Tests use explicit fixtures and disposable local files. Fixture prices are never served by the live preview. Run `node services/stocks-global/probe.mjs <evidence-directory>` for finite, read-only source verification; source availability can change. See the QA report for actual browser cycles, screenshots, source matrix and blockers.
