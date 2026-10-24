# Venue fixtures: provenance

Every file is the body of one unauthenticated HTTPS GET made on 2026-10-20 from the review container (user agent `voltex-stocks-feed-check/0.1`). No value was generated or edited. Files marked *subset* keep only the rows for the watch list (AAPL, NVDA, TSLA, MSFT, SPY, QQQ) because the full responses are 0.7–17.8 MB; each kept row is byte-identical to the venue's row. Files named `http4xx` keep the venue's error body for the fail-closed tests.

| Fixture | HTTP | UTC | Bytes | Note | URL |
|---|---|---|---|---|---|
| `gate/currency_pairs_AAPLX_USDT.json` | 200 | 2026-10-20T17:40:20Z | 513 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/AAPLX_USDT` |
| `gate/currency_pairs_NVDAX_USDT.json` | 200 | 2026-10-20T17:40:21Z | 515 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/NVDAX_USDT` |
| `gate/currency_pairs_TSLAX_USDT.json` | 200 | 2026-10-20T17:40:22Z | 513 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/TSLAX_USDT` |
| `gate/currency_pairs_SPYX_USDT.json` | 200 | 2026-10-20T17:40:24Z | 513 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/SPYX_USDT` |
| `gate/currency_pairs_QQQX_USDT.json` | 200 | 2026-10-20T17:40:25Z | 514 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/QQQX_USDT` |
| `gate/currency_pairs_MSFTX_USDT.http400.json` | 400 | 2026-10-20T17:34:27Z | 63 | verbatim body | `https://api.gateio.ws/api/v4/spot/currency_pairs/MSFTX_USDT` |
| `gate/tickers_AAPLX_USDT.json` | 200 | 2026-10-20T17:34:15Z | 257 | verbatim body | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=AAPLX_USDT` |
| `gate/tickers_NVDAX_USDT.json` | 200 | 2026-10-20T17:34:16Z | 256 | verbatim body | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=NVDAX_USDT` |
| `gate/tickers_TSLAX_USDT.json` | 200 | 2026-10-20T17:34:17Z | 251 | verbatim body | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TSLAX_USDT` |
| `gate/tickers_SPYX_USDT.json` | 200 | 2026-10-20T17:34:18Z | 256 | verbatim body | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=SPYX_USDT` |
| `gate/tickers_QQQX_USDT.json` | 200 | 2026-10-20T17:34:20Z | 253 | verbatim body | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=QQQX_USDT` |
| `gate/order_book_AAPLX_USDT_limit1.json` | 200 | 2026-10-20T17:40:26Z | 119 | verbatim body | `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=AAPLX_USDT&limit=1&with_id=true` |
| `gate/trades_AAPLX_USDT_limit1.json` | 200 | 2026-10-20T17:34:23Z | 185 | verbatim body | `https://api.gateio.ws/api/v4/spot/trades?currency_pair=AAPLX_USDT&limit=1` |
| `gate/candlesticks_AAPLX_USDT_15m_limit600.json` | 200 | 2026-10-20T17:40:27Z | 50913 | verbatim body | `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=AAPLX_USDT&interval=15m&limit=600` |
| `gate/candlesticks_AAPLX_USDT_1d_limit600.json` | 200 | 2026-10-20T17:40:29Z | 42644 | verbatim body | `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=AAPLX_USDT&interval=1d&limit=600` |
| `gate/candlesticks_AAPLX_USDT_15m_limit5.json` | 200 | 2026-10-20T17:34:24Z | 413 | verbatim body | `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=AAPLX_USDT&interval=15m&limit=5` |
| `mexc/exchangeInfo_slice.json` | 200 | 2026-10-20T17:40:20Z | 3473 | verbatim body | `https://api.mexc.com/api/v3/exchangeInfo?symbols=AAPLXUSDT,NVDAXUSDT,TSLAXUSDT,SPYXUSDT` |
| `mexc/exchangeInfo_MSFTXUSDT.json` | 200 | 2026-10-20T17:40:21Z | 95 | verbatim body | `https://api.mexc.com/api/v3/exchangeInfo?symbol=MSFTXUSDT` |
| `mexc/ticker24hr_AAPLXUSDT.json` | 200 | 2026-10-20T17:34:14Z | 361 | verbatim body | `https://api.mexc.com/api/v3/ticker/24hr?symbol=AAPLXUSDT` |
| `mexc/ticker24hr_NVDAXUSDT.json` | 200 | 2026-10-20T17:34:15Z | 366 | verbatim body | `https://api.mexc.com/api/v3/ticker/24hr?symbol=NVDAXUSDT` |
| `mexc/ticker24hr_TSLAXUSDT.json` | 200 | 2026-10-20T17:34:16Z | 365 | verbatim body | `https://api.mexc.com/api/v3/ticker/24hr?symbol=TSLAXUSDT` |
| `mexc/ticker24hr_SPYXUSDT.json` | 200 | 2026-10-20T17:34:17Z | 360 | verbatim body | `https://api.mexc.com/api/v3/ticker/24hr?symbol=SPYXUSDT` |
| `mexc/depth_AAPLXUSDT_limit1.json` | 200 | 2026-10-20T17:40:22Z | 108 | verbatim body | `https://api.mexc.com/api/v3/depth?symbol=AAPLXUSDT&limit=1` |
| `mexc/trades_AAPLXUSDT_limit1.json` | 200 | 2026-10-20T17:34:18Z | 158 | verbatim body | `https://api.mexc.com/api/v3/trades?symbol=AAPLXUSDT&limit=1` |
| `mexc/klines_AAPLXUSDT_15m_limit500.json` | 200 | 2026-10-20T17:40:23Z | 41266 | verbatim body | `https://api.mexc.com/api/v3/klines?symbol=AAPLXUSDT&interval=15m&limit=500` |
| `mexc/klines_AAPLXUSDT_1d_limit500.json` | 200 | 2026-10-20T17:40:53Z | 40807 | verbatim body | `https://api.mexc.com/api/v3/klines?symbol=AAPLXUSDT&interval=1d&limit=500` |
| `mexc/klines_AAPLXUSDT_15m_limit5.json` | 200 | 2026-10-20T17:34:19Z | 412 | verbatim body | `https://api.mexc.com/api/v3/klines?symbol=AAPLXUSDT&interval=15m&limit=5` |
| `binance-vision/ticker24hr_slice.json` | 200 | 2026-10-20T17:34:15Z | 3174 | verbatim body | `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22AAPLBUSDT%22%2C%22NVDABUSDT%22%2C%22TSLABUSDT%22%2C%22MSFTBUSDT%22%2C%22SPYBUSDT%22%2C%22QQQBUSDT%22%5D` |
| `binance-vision/depth_AAPLBUSDT_limit5.json` | 200 | 2026-10-20T17:34:16Z | 348 | verbatim body | `https://data-api.binance.vision/api/v3/depth?symbol=AAPLBUSDT&limit=5` |
| `binance-vision/trades_AAPLBUSDT_limit1.json` | 200 | 2026-10-20T17:34:17Z | 142 | verbatim body | `https://data-api.binance.vision/api/v3/trades?symbol=AAPLBUSDT&limit=1` |
| `binance-vision/klines_AAPLBUSDT_15m_limit5.json` | 200 | 2026-10-20T17:34:18Z | 776 | verbatim body | `https://data-api.binance.vision/api/v3/klines?symbol=AAPLBUSDT&interval=15m&limit=5` |
| `binance-vision/klines_MSFTBUSDT_1d_limit3.json` | 200 | 2026-10-20T17:34:20Z | 492 | verbatim body | `https://data-api.binance.vision/api/v3/klines?symbol=MSFTBUSDT&interval=1d&limit=3` |
| `binance-vision/exchangeInfo_http451_api.binance.com.json` | 451 | 2026-10-20T17:25:35Z | 224 | verbatim body | `https://api.binance.com/api/v3/exchangeInfo` |
| `discovery/bybit_instruments_http403.html` | 403 | 2026-10-20T17:25:35Z | 96 | verbatim body (CloudFront HTML, not JSON) | `https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000` |
| `discovery/bingx_symbols_subset.json` | 200 | 2026-10-20T17:25:35Z | 1759 | subset: rows filtered to the watch list, each row unchanged | `https://open-api.bingx.com/openApi/spot/v1/common/symbols` |
| `discovery/okx_instruments_subset.json` | 200 | 2026-10-20T17:25:35Z | 6525 | subset: rows filtered to the watch list, each row unchanged | `https://www.okx.com/api/v5/public/instruments?instType=SPOT` |
| `discovery/bitget_symbols_subset.json` | 200 | 2026-10-20T17:25:35Z | 2901 | subset: rows filtered to the watch list, each row unchanged | `https://api.bitget.com/api/v2/spot/public/symbols` |
| `discovery/kucoin_symbols_subset.json` | 200 | 2026-10-20T17:25:35Z | 1498 | subset: rows filtered to the watch list, each row unchanged | `https://api.kucoin.com/api/v2/symbols` |
| `discovery/kraken_assetpairs_tokenized_subset.json` | 200 | 2026-10-20T17:34:14Z | 6189 | subset: rows filtered to the watch list, each row unchanged | `https://api.kraken.com/0/public/AssetPairs?aclass_base=tokenized_asset` |
| `discovery/binance_exchangeInfo_subset.json` | 200 | 2026-10-20T17:25:35Z | 28729 | subset: rows filtered to the watch list, each row unchanged | `https://data-api.binance.vision/api/v3/exchangeInfo` |
| `discovery/gate_currency_pairs_subset.json` | 200 | 2026-10-20T17:25:35Z | 2574 | subset: rows filtered to the watch list, each row unchanged | `https://api.gateio.ws/api/v4/spot/currency_pairs` |
| `discovery/mexc_exchangeInfo_subset.json` | 200 | 2026-10-20T17:25:35Z | 3473 | subset: rows filtered to the watch list, each row unchanged | `https://api.mexc.com/api/v3/exchangeInfo` |
| `discovery/bingx_ticker24hr_AAPLX-USDT.json` | 200 | 2026-10-20T17:34:14Z | 353 | verbatim body | `https://open-api.bingx.com/openApi/spot/v1/ticker/24hr?symbol=AAPLX-USDT` |
| `discovery/okx_ticker_XAAPL-USDT.json` | 200 | 2026-10-20T17:34:14Z | 342 | verbatim body | `https://www.okx.com/api/v5/market/ticker?instId=XAAPL-USDT` |
| `discovery/bitget_tickers_RAAPLUSDT.json` | 200 | 2026-10-20T17:34:14Z | 396 | verbatim body | `https://api.bitget.com/api/v2/spot/market/tickers?symbol=RAAPLUSDT` |
| `discovery/kucoin_stats_AAPLX-USDT.json` | 200 | 2026-10-20T17:34:14Z | 354 | verbatim body | `https://api.kucoin.com/api/v1/market/stats?symbol=AAPLX-USDT` |
| `discovery/kraken_ticker_AAPLxUSD.json` | 200 | 2026-10-20T17:37:39Z | 247 | verbatim body | `https://api.kraken.com/0/public/Ticker?pair=AAPLxUSD&asset_class=tokenized_asset` |
| `discovery/okx_candles_XAAPL-USDT_15m_limit5.json` | 200 | 2026-10-20T17:34:17Z | 453 | verbatim body | `https://www.okx.com/api/v5/market/candles?instId=XAAPL-USDT&bar=15m&limit=5` |
| `discovery/bingx_kline_AAPLX-USDT_15m_limit5.json` | 200 | 2026-10-20T17:34:17Z | 409 | verbatim body | `https://open-api.bingx.com/openApi/spot/v2/market/kline?symbol=AAPLX-USDT&interval=15m&limit=5` |
| `discovery/bitget_candles_RAAPLUSDT_15min_limit5.json` | 200 | 2026-10-20T17:34:17Z | 612 | verbatim body | `https://api.bitget.com/api/v2/spot/market/candles?symbol=RAAPLUSDT&granularity=15min&limit=5` |
| `discovery/bitget_orderbook_RAAPLUSDT_code40502.json` | 400 | 2026-10-20T17:34:15Z | 101 | verbatim body | `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=RAAPLUSDT&limit=5` |
| `discovery/bitget_fills_RAAPLUSDT_limit1.json` | 200 | 2026-10-20T17:34:16Z | 192 | verbatim body | `https://api.bitget.com/api/v2/spot/market/fills?symbol=RAAPLUSDT&limit=1` |
| `discovery/kucoin_candles_AAPLX-USDT_15min.json` | 200 | 2026-10-20T17:34:17Z | 566 | verbatim body | `https://api.kucoin.com/api/v1/market/candles?symbol=AAPLX-USDT&type=15min&startAt=1792510453&endAt=1792517653` |
| `discovery/kraken_ohlc_AAPLxUSD_15_subset.json` | 200 | 2026-10-20T17:37:29Z | 407 | subset: last 5 rows of the 721-row response | `https://api.kraken.com/0/public/OHLC?pair=AAPLxUSD&interval=15&asset_class=tokenized_asset` |
| `discovery/kraken_depth_AAPLxUSD_count5.json` | 200 | 2026-10-20T17:37:40Z | 387 | verbatim body | `https://api.kraken.com/0/public/Depth?pair=AAPLxUSD&count=5&asset_class=tokenized_asset` |
| `discovery/kraken_trades_AAPLxUSD_count1.json` | 200 | 2026-10-20T17:37:41Z | 123 | verbatim body | `https://api.kraken.com/0/public/Trades?pair=AAPLxUSD&count=1&asset_class=tokenized_asset` |
