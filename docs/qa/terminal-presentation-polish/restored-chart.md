# Restore only the integrated VOLTEX chart — 2026-09-13

Owner approved restoring the older owned chart, explicitly preserving the newer order forms and features. Base PR #66 head: 17db7fa90589cb688b961b91fcf4fd6cda268eaa. Fresh origin/main remains e2f22451e75b29baba4e3f2c4ec667886b688a90.

- Reused the existing PriceChart (history: 97a1fd3), including drawing tools, saved drawings, MA200/Bollinger/RSI/MACD, candle/line/area modes and original white/amber candle-volume palette. Matched canvas/rail/toolbar surfaces and typography. On-plot label shows the actual ticker and selected timeframe.
- New TerminalChart wrapper defaults to VOLTEX on Spot/Futures and offers the existing native TradingView as an alternative. It switches only the chart subtree. CFD's existing own chart remains unchanged.
- Exact Futures history uses a new public read-only VOLTEX endpoint, /market/futures/candles/:pair. Fixed linear provider URL, strict request bounds, timeout, coalesced requests, 4-second cache with no stale fallback, 128-key/16-inflight limits. Client validates exact symbol/product and OHLC before display. No Spot substitute, fabricated history or browser-to-venue HTTP request. Existing Spot candle source remains.
- Chart requests do not overlap, pause while the tab is hidden, abort on context disposal where supported, clear prior data on timeframe changes, and clear the chart after failed loads. Tiny-price precision also applies to explicit contract loaders.
- OrderForm/FuturesOrderForm/CfdOrderForm/OrderFamilyPresentation, order book, discovery and financial handlers are unchanged from the prior PR head. Page changes are chart-import substitutions only.

## Verification

- Frontend TypeScript/production build PASS; backend TypeScript build PASS.
- Six focused chart/form suites: 134 PASS. Added public-candle adapter suite: 7 PASS. Full frontend plus that adapter suite: 1253 pass / 71 fail / 1324 tests. The frontend-only portion is 1246 pass / 71 fail. Exact new failure names versus the prior PR/current-main baseline: none. Existing 71 failures remain.
- Browser 1440: own charts render real candles in Spot and Futures, including candidate backend adapter. No page horizontal overflow. Header padding verified. Native TradingView switch preserves the selected OCO family and its entered TP value; returning to VOLTEX preserves it too. 1h selection changes on-chart label to BTC/USDT · 1h. No orders submitted.
- Browser 390: own chart and five order-family tabs present, no page horizontal overflow. Drawing rail scrolls locally. Screenshots: restored-chart-futures-1440.png, restored-chart-spot-1440.png, restored-chart-futures-390.png.
- Local harness now loads the compiled candidate candle adapter; run backend and frontend builds before starting it. It continues blocking private account reads and ALL financial writes, so local account errors remain expected.
- No merge/deployment. A future release must deploy the new read-only candle endpoint with the frontend; frontend-only production deployment would leave own Futures candle history unavailable. TradingView remains available separately.
