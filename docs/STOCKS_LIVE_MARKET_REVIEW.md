# Tokenized-equity public market review — 2026-10-24

Base: Draft #613, `aeaf20f973e2ffa4c810ecee9e19d049b76d5de7`.
Integration: reviewed #614 `54bff04ea633200b39a81683af77f0cd9c786069` plus narrow fixes, fast-forward into existing Draft #613; never main.
Owner work order: https://github.com/nazardzuba79-tech/-/issues/561#issuecomment-6385057130

The existing Professional B terminal now reads shared public WebSocket quotes,
actual bid/ask and native candles alongside its existing REST history cache.
There is no second terminal, broker connection, order engine or account store.
PostgreSQL authority, normal VOLTEX authentication, DemoBalance, financial
rounding/conversions and listing code are unchanged. All financial controls
remain default OFF. Native USD display readiness never authorizes USDT orders.

## What was actually verified

| Venue | Exact admitted metadata identities | Live quote coverage captured |
|---|---|---|
| Binance | 13 bStocks: AAPLB, NVDAB, TSLAB, MSFTB, AMZNB, GOOGLB, METAB, NFLXB, AVGOB, COINB, MSTRB, AMDB, INTCB, each quoted in USDT | AAPLBUSDT, TSLABUSDT |
| Bybit | 7 xStocks: AAPLX, NVDAX, TSLAX, AMZNX, GOOGLX, METAX, COINX, each USDT | AAPLXUSDT, TSLAXUSDT |
| Gate | AAPLX_USDT, NVDAX_USDT, TSLAX_USDT, SPYX_USDT, QQQX_USDT | AAPLX_USDT and TSLAX_USDT complete ticker captured; sparse updates can still become stale |
| MEXC | AAPLXUSDT, NVDAXUSDT, TSLAXUSDT, SPYXUSDT; separately AAPLONUSDT, NVDAONUSDT, TSLAONUSDT, SPYONUSDT, QQQONUSDT | AAPLXUSDT, TSLAXUSDT; Ondo identities metadata-verified, not exercised live |
| OKX | XAAPL-USDT, XNVDA-USDT, XTSLA-USDT, XSPY-USDT, XQQQ-USDT, its distinct unified tokenized spot product | XAAPL-USDT, XTSLA-USDT |
| KuCoin | AAPLX-USDT, TSLAX-USDT | Both complete price/BBO; actual AAPLX snapshot volume 45.644, with bid/ask/sizes |
| Kraken | AAPLxUSD, NVDAxUSD, TSLAxUSD, SPYxUSD, QQQxUSD; v2 symbols AAPLx/USD etc. | AAPLx/USD, TSLAx/USD; USD stays USD, no assumed stablecoin peg |
| BingX | AAPLX-USDT, NVDAX-USDT, TSLAX-USDT, SPYX-USDT | AAPLX-USDT, TSLAX-USDT |
| Bitget | RAAPLUSDT, RNVDAUSDT, RTSLAUSDT, RSPYUSDT, RQQQUSDT; see exact machine-readable list below | RAAPLUSDT, RTSLAUSDT, UTA v3 public `spot` topic; distinct rToken share-equivalent, not xStocks |
| Backpack | PRODUCT_TYPE_DIFFERENT | `/markets` stock entries found were perpetuals; `/securities` is an underlying/reference list. Neither is admitted as spot or RFQ BBO. |

The authoritative exact ids are in
[catalogue-final.json](qa/stocks-live-feeds-20261024/catalogue-final.json):
**55 metadata-confirmed, online identities across nine venues**. Metadata
admission is not a claim that all 55 were simultaneously streamed.
**18 exact venue/symbol combinations have captured full WS last/bid/ask**;
18 requested combinations have genuine 300-row REST history after the explicit
KuCoin history-window correction. The capture never substitutes another venue.

The integration probe (16:23:52–16:24:29 UTC) recorded **11/18 fresh complete quotes** at individual sample times; others were QUOTE_STALE/QUOTE_UNAVAILABLE. All 18 REST paths returned 300 genuine bars; 13 had native WS bars in this window. Earlier public captures plus the gap capture establish 18 complete combinations, not 55 simultaneously fresh streams. ACKs are never prices. Bitget native rToken candle events remain unobserved. The confirmed UTA object-parser defect is fixed using the official schema; missing 1m volume is unavailable and fails OHLCV admission, never zero-filled. No missing market field is fabricated.

## Protocol and resource boundaries

- Binance public JSON ticker/native kline; Bybit spot snapshots; Gate spot
  ticker/book/candles; OKX public ticker plus separate business candle socket.
- MEXC binary Protobuf, public-only bounded decoder derived from pinned official
  schemas `0c9c4f35dd0fadc3a46a350e909a93379d81e811`, not JSON parsing binary.
- KuCoin official unauthenticated `POST /api/v1/bullet-public` connection token;
  token never logged/persisted. This is the only external POST and is not a
  financial request. Endpoint host is fixed/validated.
- Kraken tokenized-asset REST metadata plus actual v2 instrument confirmation
  before subscribing to quotes. USD is never passed through the RUB converter.
- BingX actual gzip wire bytes, decompression bound, Ping/Pong and correct spot
  `15min` interval grammar. Bitget UTA v3 public spot-category ticker/kline only;
  no restricted `reality-orderbook`, API key or private channel. Venue-reported
  volume and platform turnover are kept distinct, not invented token turnover.
- Confirmed expired-demand revival defect fixed with RED -> GREEN regression:
  catalogue refresh neither revives expired viewers nor extends active leases.
- Process-shared demand leases, at most 512 owners and 256 history interests;
  no per-viewer sockets. Bybit subscription requests are capped at ten arguments;
  MEXC connections are sharded at 30 requested channels, with finite catalog size.
- Confirmed Binance subscription burst fixed RED -> GREEN (13 simultaneous
  controls became one 26-topic batch). Controls are paced at 300ms with room
  for provider PONG; adding/removing symbols uses subscribe/unsubscribe on the
  existing socket and preserves other readers. No provider limit was raised.
- Fixed public endpoints, 256 KiB quote/wire/decompression bound, bounded retry
  with exponential backoff, heartbeat/connect deadlines, generation invalidation
  on disconnect/reset and strict source/symbol/time/BBO checks.
- Native WS candles merge only with same-instrument/timeframe REST data. No
  synthesized gaps or quote-derived OHLC. Existing bounded/coalesced history
  requests remain; at most 32 immutable merged pages also reuse HTTP JSON caches.
- Hidden tabs release demand and stop polling. Native WS bars ride the existing three-second quote response; historical
  REST reads keep their original 15-second cadence, with no extra provider
  polling per user. No 50+2 or p95 workload was run or declared passed.

## Verification

- Node **22.23.3**: 47 market-contract tests PASS plus 25 existing focused
  release/default-OFF/history/projection/forged-finance regressions PASS.
- Unchanged frontend plain-language suite: 12/12 PASS; transport implementation
  wording removed from the product UI without changing its assertions.
- Frontend TypeScript and production build PASS with the full existing
  `VITE_API_URL=https://api.voltextech.net/api/v1` and execution explicitly OFF.
  Existing large-bundle warning remains, not suppressed.
- Real public feed browser review: desktop 1440, mobile 390, chart/trade tabs,
  source selection, native USD identity, all four Market/Limit BUY/SELL buttons
  silent NO-OP, zero financial POST, zero page exceptions, no horizontal page
  overflow, hidden polling stopped, anonymous Stocks route still requires login.
- The visual harness uses a disposable non-account reader in a local-only,
  financial-OFF server. It is not a new normal-login/PG acceptance claim and
  never opens a ledger. Existing PG/auth checks remain separate and unchanged.
- Known unsupported legacy SQLite revocation FAIL is not removed or relabelled.
  Production remains PostgreSQL-only; production boundary tests reject fallbacks.

Screenshots and the unedited live-probe statuses are in
[qa/stocks-live-feeds-20261024](qa/stocks-live-feeds-20261024).

## Local reproduction / production boundaries

```powershell
$env:VITE_STOCKS_CATALOGUE_VISIBLE='true'
$env:VITE_STOCKS_ORDER_EXECUTION_ENABLED='false'
$env:VITE_API_URL='https://api.voltextech.net/api/v1'
npm ci --prefix frontend --no-audit --no-fund
npm run build --prefix frontend
node tools/stocks-live-review.mjs --public-read-only
```

The local tool refuses NODE_ENV=production and never opens financial storage.
The browser review script seeds only its disposable browser's local reader
token, blocks all remote browser requests and does not create a VOLTEX account.
Use `node tools/stocks-live-browser-review.cjs` for the visible screenshot proof;
it needs Playwright via STOCKS_TEST_PLAYWRIGHT_ROOT. Normal hosted login is not
replaced by this local reader.

For a future reviewed release, the existing global
`STOCKS_MARKET_DATA_ENABLED` must be literally true, each selected venue must be
in `STOCKS_LIVE_WS_VENUES` **and** `STOCKS_VENUE_RIGHTS_CONFIRMED`; all are unset/OFF
by default. Missing rights fail closed. Do not set these flags just because a
public endpoint worked. The older REST switch remains restricted to Gate/MEXC.
No production visibility, finance or provider flag was changed.

Commercial redistribution/display rights remain **UNCONFIRMED for all nine**.
Backpack product eligibility and Bitget native rToken candle capture,
deployment approval and existing 50 viewers + 2 traders / crypto p95 <= +5%
acceptance remain release blockers. This is a market-code review candidate,
not production activation or proof of real stock ownership.

Official protocol references: [Binance](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md),
[Bybit](https://bybit-exchange.github.io/docs/v5/ws/connect),
[Gate](https://www.gate.com/docs/developers/apiv4/ws/),
[MEXC](https://www.mexc.io/api-docs/spot-v3/websocket-market-streams/protocol-buffers-integration),
[OKX](https://www.okx.com/docs-v5/log_en/),
[KuCoin](https://www.kucoin.com/docs-new/api-3470294),
[Kraken](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/instrument),
[BingX](https://github.com/BingX-API/api-ai-skills/blob/main/skills/spot-ws-market/api-reference.md),
[Bitget](https://www.bitget.com/docs/uta/websocket/public/Tickers-Channel),
[Backpack](https://docs.backpack.exchange/).

## Integration findings and exact regression evidence

- Gate AAPLX: actual `spot.tickers` at source 1792858983602 contains last 346.77, bid 346.58 and ask 346.85. No parser change was justified. Sparse updates still become stale after the unchanged five-second deadline.
- KuCoin AAPLX: actual `/market/snapshot:AAPLX-USDT` at 1792858980847 includes vol 45.644, buy 347.93, sell 347.94 and sizes. The old parser discarded snapshot BBO, making fresh snapshots depend on a sparse ticker. The captured-frame test fails before the mapping and passes after it. Older statistics cannot retimestamp newer BBO/trades.
- Bitget: official UTA kline objects use start/open/high/low/close/volume, unlike REST arrays. The old decoder produced NaN. The official-schema RED→GREEN test preserves source fields. Official 1m rToken pushes omit volume; incomplete OHLCV stays unavailable. No actual rToken kline push was observed, so native acceptance is UNCONFIRMED.
- Authentic incremental evidence: `services/stocks-global/fixtures/live-public-20261024/integration-gap-wire.json`. Public-only, no credentials/accounts. The separate official-example test is schema evidence, never labelled a captured live price.
- Browser QA clicks the actual source menu for all nine venues, checks real 5m REST responses, and forces one upstream Bybit disconnect/reconnect with React mounted. Desktop 1440/mobile 390: no overflow, hidden polling stops, zero financial POST. Normal PostgreSQL login/revocation is separately checked in hosted CI; the local reader is not a production session.
- Future configuration and remaining gates: [STOCKS_WS_613_INTEGRATION.md](STOCKS_WS_613_INTEGRATION.md).
