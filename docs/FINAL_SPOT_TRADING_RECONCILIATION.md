# Final Spot Trading reconciliation

## Provenance and scope

- Candidate branch: `codex/final-trading-production`.
- Starting production/main revision: `c398efa1d4d8f6b348e9ae1fc87dd72a06ebc337`.
- Historical approved Spot correction: `6f2e2bc518773e0cdca55aa947c31b840cf70762`.
- Reviewed comparison source: `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86` (`claude/review-ready` at task start).
- This is a semantic correction on the current production baseline, not a whole-branch merge or replacement with the older terminal. Final commit/promotion references must be recorded by the release owner after validation.

## Reconciled behavior

### Market list and order book

The existing split market-list/chart/book/order-form composition remains. Markets title, collapse/restore controls, slash search, shared Favorites, real supported quote filters, live icon data and volume-ranking snapshot remain. Sorting now has deterministic numeric ties and invalid values stay last; the change is opt-in in the shared pair-list helper. Native favorite and selection buttons are independent, with a real selection box preserving the five-column geometry. Market width supports pointer and keyboard resizing.

Spot prices below six decimal places no longer display as zero. Book grouping uses price-relative selectable steps, floors bid buckets and ceils ask buckets, preserves valid quantities and derives spread from the best valid ungrouped prices. Missing or crossed data does not manufacture a spread. Click, Enter and Space use the same displayed price string. Shared OrderBook defaults are retained for Futures.

Pair/generation/request/WebSocket guards prevent late data from another instrument or older source overwriting the book. Generation-aware singleflight allows slow REST requests to complete instead of being invalidated every polling tick. The recurring fallback detects later WebSocket interruptions as well as initial absence. The instrument ticker and order form are keyed by pair to avoid showing a previous instrument's values during loading.

Browser QA additionally caught BTC depth initializing MOG grouping during the first pair-change render, before React effects cleared the old state. Snapshots now carry pair provenance and the parent synchronously withholds mismatched depth. The first valid new-pair Spot render derives its own step immediately; later same-pair ticks preserve manual grouping. Actual stateful BTC → MOG → BTC tests assert these transitions before effects. Spot TickerBar explicitly opts into tiny-price formatting (default shared formatting unchanged); Spot Market Info uses the same formatter for last/high/low values.

### Order input and account tables

Normal authenticated order APIs remain the only submission path. Limit, Market, Stop, Take Profit and OCO retain server-side execution and funding validation. Duplicate submissions are guarded. Quantity percentages use exact decimal integer flooring at the existing eight input decimals, avoiding binary rounding above the selected available balance. The UI's 2% market reservation estimate no longer rounds below the unchanged backend decimal calculation. OCO BUY affordability uses the greater of its two execution prices; SELL uses available base quantity.

The form interprets the actual order response. An empty-book cancelled order does not produce a success message; partial cancellation reports the actual reconciled filled and remaining quantities. Unknown or inconsistent response states remain unconfirmed. This does not alter matching or invent execution liquidity.

Open Orders, Order History and opt-in compact Assets have legible decimal-preserving tables, count/empty/error/retry states and contained scrolling. Sequential cancel-all sends one cancellation per OCO group because the unchanged backend cancels both siblings transactionally; standalone IDs remain independent. Genuine failures still surface rather than being suppressed or reported as success. Read controllers serialize periodic requests and queue fresh reads after mutations, preventing slow-response starvation and stale post-cancellation results. Shared Futures Assets retains its existing rendering and polling branch.

### Chart tools and indicators

Spot opts into the refined drawing toolbar, bounded flyouts, keyboard navigation, in-app text/clear dialogs and cancellable gestures. Drawings keep real candle/time/price coordinates. Hide/Clear affect local drawings, not actual conditional orders. Text is rendered as React text, not HTML. Existing candle data, chart types, timeframes and conditional-order endpoint remain.

The independent indicator audit found that the old MACD signal initialized its EMA using artificial zero observations before MACD existed. On closes `1..48`, the first valid default MACD is `7`, but the old signal was `6.060475904` with a false initial histogram of `0.939524096`. The Spot-only `warmupFromValidMacd` option seeds from the first nine real MACD observations, yielding signal `7` and histogram `0` for that case. Existing default shared/Futures output is preserved. A direct comparison against the starting source passed 96 exact-output checks across lengths, price magnitudes and parameter sets.

SMA200, EMA, Bollinger population standard deviation and Wilder RSI formulas were not changed. New tests verify their warm-up and arithmetic, together with MACD bootstrap, recurrence and the explicit Spot-only invocation.

The final tiny-price chart check found the shared default two-decimal axis rounded MOG to zero. Spot now derives price-axis display precision from actual positive OHLC values for candles/line/area/MA/Bollinger, without rounding any input series or claiming this display resolution is an exchange tick. BTC keeps two decimals; MOG displayed a real `0.000000108600` price instead of `0.00`. The final narrow book-cell pass adds 6 px separation and full-value hover titles; only oversized secondary text ellipsizes inside its own cell, never colliding with the exact selected price.

## Preservation boundaries

The application diff does not change backend `src/`, matching, `OrderService`, `PriceWatcherService`, normal API clients, authentication, permissions, database schema/migrations, balances, deposits/withdrawals, dependency manifests/locks or Docker/Render configuration. Copy Trading, Nazar/Ksenia history/economics/verified badges, Homepage, Crypto Card, Wallet, Futures page, navigation and other product pages remain outside the implementation scope.

Shared components use explicit Spot options: `OrderBookPanel.spotPrecision`, `PriceChart.spotTools` and `AssetsPanel.compact`; Futures supplies none of them. The Spot correction does not convert the external market-depth display into internal matching liquidity. Market affordability is still an estimate from the available reference price; the unchanged server decides execution against its own book.

The previous Crypto Card release's whole-file TradePage/i18n hashes were replaced with Card-specific route isolation and exact Card-related translation assertions. The approved Card assets, product dictionaries and protected Copy/Home/Auth/navigation fingerprints remain intact; unrelated Spot changes are no longer required to replace an entire shared-file hash.

The pre-existing TradePage also subscribed to the Spot display feed while showing its CFD branch. This task does not add a new initial CFD subscription or change CFD execution.

## Verification record

- Frontend TypeScript passed after the source corrections.
- Focused market/book/entry/refresh tests passed, including slow requests, pair ABA transitions, WS precedence, tiny prices and exact funding boundaries.
- Indicator/drawing tests: 2 suites / 36 tests passed.
- Relevant backend order/auth/matching/recovery/PriceWatcher tests: 6 suites / 52 tests passed. The deliberate `PriceWatcherService` failed-trigger fixture logs an expected error, not a test failure.
- Full frontend/backend regression: **111 suites / 1,315 tests passed**, zero failures, in 311.484 seconds. Machine-readable evidence: `outputs/final-trading-qa/final-jest-results.json`. Any subsequent narrow follow-up must record its own targeted rerun.
- After the final OCO cancel-all deduplication and two added regressions, all frontend tests plus the six relevant backend order/auth/matching suites were rerun: **32 suites / 457 tests passed**, zero failures, in 27.005 seconds (frontend 26 suites / 405 tests; backend 6 suites / 52 tests). Evidence: `outputs/final-trading-qa/oco-followup-jest-results.json`.
- After the browser-discovered BTC → MOG provenance/grouping correction and Spot ticker/Market Info precision fix, the complete frontend was rerun: **27 suites / 409 tests passed**, zero failures, in 20.343 seconds. Frontend TypeScript and `git diff --check` also passed. Evidence: `outputs/final-trading-qa/pair-transition-frontend-results.json`. Backend sources remained unchanged.
- Final complete frontend after the axis/cell precision follow-ups: **28 suites / 422 tests passed**, zero failures, in 24.238 seconds. Evidence: `outputs/final-trading-qa/final-chart-precision-frontend-results.json`. The custom chart-test loader was updated to resolve the actual new helper; its assertions were not weakened.
- Backend TypeScript/production compilation passed. Final frontend TypeScript and Vite production compilation passed: 5,651 modules, 6.98 seconds, `index-DlXfUWv1.js` and `index-DZyZPoHa.css`. The existing >500 kB bundle warning remains, with no build error. These exact final assets were loaded in the browser for the closing checks.

### Built-app browser QA

The actual production frontend build was served at `http://127.0.0.1:4181/trade` and exercised in the Codex browser. This is LOCAL owner review, not staging or production. Screenshots and DOM/geometry measurements were inspected at **1920, 1440, 1280, 1024, 768, 390 and 375 px**. Every width had zero page-level horizontal overflow. Desktop retains separate Markets/chart/book/form panels; tablet and mobile stack them. A 44 px rail stays outside the canvas on desktop/tablet, and becomes a horizontally scrollable 44 px strip below 768 px. The compact orders panel is 172 px initially, with contained table scrolling. Mobile text/clear dialogs fit without clipping. A small-price MOG header was separately inspected at 375 px.

The final asset's seven-width geometry rerun again showed zero overflow and no alert at every width. Chart areas were respectively 1178×700, 698×620, 538×520, 1014×460, 758×460, 380×440 and 365×440 CSS pixels. Settled screenshots at 1440/1280/390/375 confirmed the corrected book spacing and both BTC and MOG price scales. Captures taken immediately during viewport transitions can contain an old compositor frame; settled captures, not those transition images, were used for visual acceptance.

- Markets: all four real quote filters, A–Z/price/change/volume sorting, search, `/`, Favorites and independent pair selection exercised. Keyboard resize changed the panel from 258 to 268 px; native-viewport pointer drag then changed it from 268 to 323 px. Collapsing both side panels expanded the 1920 px chart area to 1656 px, with restore controls in their own row rather than over candles. BTC → MOG → BTC was retested: MOG grouping used `0.0000000001`, its actual price was approximately `0.000000109`, and returning to BTC restored step `10` instead of retaining the MOG step.
- Order book: grouping 0.1/10 visibly aggregated the actual feed, both sides remained ordered, true ungrouped spread and percentage were displayed, and clicking a row filled the order price. No artificial financial values or internal matching liquidity were introduced.
- Chart: real BTC/ETH/MOG candles and volume rendered, with timeframe and pair switching. MA200, Bollinger, RSI and MACD controls rendered their real calculated series. Cursor pan and wheel zoom moved candle-anchored drawings; Fit restored the view. Trend, ray, horizontal/vertical line, rectangle, brush, Fibonacci, ruler and text were exercised. One ruler observation was +2.64%, +2062.9092 over 92 loaded bars; Fibonacci rendered all seven canonical retracement levels. Hide/show preserved drawings, Cancel preserved them, and confirmed Clear removed them without touching actual order lines.
- Order entry: actual authenticated local BUY/SELL Limit placement/cancellation, Stop Limit/Market, Take Profit Limit/Market and two-legged OCO were exercised through the normal router/service. The UI showed real persisted rows and statuses, quantity percentages used available fixture balances, and cancel/refund reconciled back to 100000 USDT plus 2 BTC. Cancel All was retested after its OCO fix: two linked rows became zero without a false error. Populated history and Assets were inspected.
- Conditional drag: the actual Stop BUY trigger changed from 82000 to 81642.00433401 through PATCH, preserving the execution-price offset (82010 → 81652.00433401). The refreshed table and line reflected the persisted values, not a cosmetic local-only movement.
- Negative cases: nonpositive price was blocked; insufficient balance and wrong-direction trigger returned the backend errors. With the deliberately empty internal matching book, market SELL returned CANCELLED/no fills with an explicit non-success message, and market BUY returned the real no-liquidity error. No fabricated fill or green success was shown. Matching fills are covered separately by the unchanged backend matching/order regression tests.
- Runtime/feed: final clean-page error log was empty. Expected 400 responses during negative order tests were checked separately from JavaScript runtime errors. Actual public market updates continued; no reconnect warning was hidden or faked. The local order engine is isolated and deliberately does not pretend that external Kraken depth supplies execution liquidity.

### Isolated actual-router QA

`scripts/qa-final-trading.cjs` serves the normal built frontend with actual compiled `requireAuth`, orders/balances/trades routers, `OrderService` and `MatchingEngine`. Persistence/account balances are explicitly local, isolated in-memory fixtures. No production credential or database is loaded. Actual public Kraken/CoinGecko services supply market data; there are no fabricated candles, WebSocket messages, fills or internal counterparties.

The self-test passed 15 checks at `2026-09-06T18:49:34.703Z`; public Kraken BTC/USDT was `79921.40000` at observation. Evidence is in the untracked local artifact directory `outputs/final-trading-qa/run-P66Ol2/`.

Checks include real auth rejection, cross-origin rejection, invalid inputs, insufficient funds, resting BUY/SELL Limit placement/cancellation, four conditional order types and trigger changes, OCO sibling cancellation, duplicate cancellation, transaction rollback, and precise refund to the initial **local fixture** balances. Empty internal-market SELL correctly returns CANCELLED with no fills. No production orders, account changes or database writes were used for these tests.

The request journal captures `originalUrl` before Express router mounting; its self-test verifies original API paths and actual GET/POST/PATCH/DELETE status codes. A previous browser-run journal lacking route entries must not be cited as request evidence; that run's exported local order state is separate evidence.

## Release record

Owner-review feature only. No main merge, Render action or production deployment is authorized by this task. The implementation commit and final documentation commit are recorded in the handoff/final response; only `codex/final-trading-production` is to be pushed. Keep the local built-app review server running for the owner. Production deployment remains a separate owner decision.
