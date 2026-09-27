# Staging research note — Bybit market-data dependencies

Planned: `Cloudflare preview → new backend → new PostgreSQL`, alongside the
current Render + Neon (which stay on). **Nothing is migrated or created by
this note.** It maps, from the code at `main` `14120a82`, every place VOLTEX
depends on Bybit public market data, and lists what a staging run has to
**measure** from the new host. No geographic conclusion is drawn here; the
answers come from network tests on that host. Bypassing geo-restrictions is
out of scope: the goal is to know what is actually reachable and to have a
fallback that really takes over.

The collector itself is covered by `docs/BYBIT_STAGING_VERIFICATION.md`
(Render Frankfurt settings, verifier script); this note is the wider map.

## 1. Who talks to Bybit

| Path | Where it runs | Bybit endpoint(s) | Fallback in code |
|---|---|---|---|
| Order book, trades, ticker, 1-min kline stream (`frontend/src/lib/futuresDepth.ts`) | **browser, direct** | `wss://stream.bybit.com/v5/public/linear` — topics `orderbook.{depth}.{SYM}`, `publicTrade.{SYM}`, `tickers.{SYM}`, `kline.{i}.{SYM}` | after 6 s with no first frame (`FALLBACK_AFTER_MS`), the book is read from `https://market.voltextech.net/market/display/futures-book/{SYM}` (production host) or `/api/v1` (other hosts); polled every `BOOK_REFRESH_MS` (30 s) while the socket is not live; shown as stale after 90 s and dropped as unavailable after 300 s |
| Futures ticker catalogue (`frontend/src/lib/directFuturesReference.ts`) | **browser, direct** | `https://api.bybit.com/v5/market/tickers?category=linear`, then `https://api.bytick.com/…` | `https://market.voltextech.net/market/display/futures-tickers`; refresh 5 min, retry 1 min |
| Futures candle history (`frontend/src/lib/futuresCandles.ts`) | **browser, direct** | `https://api.bybit.com/v5/market/kline`, then `api.bytick.com` | `https://market.voltextech.net/market/display/futures-candles/{SYM}` |
| Public market edge (`workers/market-edge`, route `market.voltextech.net`) | **Cloudflare Worker** | `api.bybit.com`, then `api.bytick.com`: `/v5/market/orderbook`, `/recent-trade`, `/tickers`, `/kline` | **OKX** public REST (`www.okx.com/api/v5/market/books`, `/trades`, tickers). No Render/Neon fallback by design |
| Live reference collector (`src/marketDataCollector.ts`, `BybitLiveTickerCollector.ts`) | **separate collector service** (documented as Frankfurt) | `wss://stream.bybit.com/v5/public/{spot,linear,inverse}` + REST `/v5/market/tickers` snapshots; 20 s ping, reconnect with an attempt budget | the API keeps the last good frame; consumers see stale/unavailable, not invented prices |
| API candles / display trades (`FuturesChartCandles.ts`, `FuturesDisplayTrades.ts`) | **backend API** | direct `api.bybit.com/v5/market/kline`, `/recent-trade` **only when no collector is configured** | with `MARKET_DATA_COLLECTOR_URL` set, the API calls the collector and never Bybit directly ("the API region must never fall back to direct venue requests") |
| Instrument universe (`BybitMarketDataService.ts`, `MarketUniverse`) | backend API when no collector; else via collector | `https://api.bybit.com` instruments/tickers | keeps the previous universe on failure (15-min cache with a long stale budget); an unloaded universe restricts nothing |
| Native/private demo pricing (`private-trading/marketData.ts`) | backend → collector (`/internal/v1/private-trading/*`); inside the collector `CollectorPrivateTradingSource` calls `api.bybit.com/v5/market/…` | kline, mark-price-kline, funding history, tickers, orderbook | commands refuse with a named error (`near_live_price_unavailable`, `quote_stale`, …) instead of pricing from nothing |

Known from existing docs (not re-tested here): the production API region had
no direct Bybit access, which is why the collector exists; this sandbox's
egress refuses `api.bybit.com` too, so none of the above was exercised live
in this session.

## 2. Staging checklist (measure, do not assume)

Run each item **from the new staging backend host** and record raw evidence
(status code, latency, a payload sample, timestamp, host region/IP ASN). A
"works from my laptop" result does not answer any of them.

1. **Bybit REST from the new backend region**
   - `GET https://api.bybit.com/v5/market/time`, `/v5/market/tickers?category=linear`, `/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&limit=5`, `/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=50`.
   - Same four against `https://api.bytick.com`.
   - Record HTTP status (200 / 403 / timeout), body shape (`retCode`), latency p50/p95 over ≥ 20 calls, and whether any response is a block page.
2. **Bybit public WebSocket from the new backend region**
   - Connect `wss://stream.bybit.com/v5/public/linear`; subscribe `orderbook.50.BTCUSDT` and `tickers.BTCUSDT`; keep it open ≥ 10 min with the 20 s ping.
   - Record: handshake result, first-frame latency, frames per minute, disconnect count and reason, reconnect success.
   - Repeat for `…/public/spot` if Spot live data is planned there.
3. **Browser-direct Bybit WebSocket from different networks**
   - Load the staging terminal (`/futures`) from several networks the audience actually uses, VPN exits included, as they are, without changing their routing.
   - In DevTools record for each: whether `wss://stream.bybit.com` opens, whether `api.bybit.com` / `api.bytick.com` REST return 200, and which source the book shows (`source: 'socket' | 'rest'`, status `live | sampled | stale | unavailable`).
   - Record the network/ASN and exit country as seen by an IP echo — as data, not as a judgment.
4. **The fallback really takes over when direct WS is unavailable**
   - Force the browser socket to fail (DevTools request blocking on `stream.bybit.com`, or an offline rule for that host) and confirm: after ≈ 6 s the book arrives from the market edge / staging API, keeps updating on its cadence, and the labels say so.
   - Same for direct REST (block `api.bybit.com` and `api.bytick.com`): tickers and candles must come from `market.voltextech.net` (or the staging equivalent).
   - Point the staging frontend at the staging edge/API explicitly; the production host rule in `setFuturesDepthFallbackBase` only applies on `*.voltextech.net`.
5. **A Bybit WS failure never blanks the terminal**
   - With the socket blocked from first load, and again with it dropped mid-session: chart, header, book and positions render; no blank panel, no error boundary, no recovery screen; stale data is labelled rather than removed until it is too old.
   - Run at desktop and 390 px.
6. **Worker and collector upstream health**
   - From the staging Worker (or a preview of `workers/market-edge`): confirm Bybit → bytick → OKX order is what actually answers, per endpoint.
   - From the collector host: confirm the WS stays connected and the API reads frames through `MARKET_DATA_COLLECTOR_URL` with no direct venue call from the API region.
7. **Record, then decide.** Keep every result in `docs/qa/staging-market-data/` with host, region and time. Only after these measurements, decide where market data should be fetched for the staging backend.

## 3. What this note does not do

No backend, database, Worker or DNS was created or changed. No routing,
proxy or VPN scheme is proposed. No geographic availability is asserted.
