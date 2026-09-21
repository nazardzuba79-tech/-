# Futures mobile — final browser QA

**READY FOR OWNER REVIEW — keep PR #159 draft. NO MERGE. NO DEPLOY.**

Tested runtime: `974a5e68ae9b484431b3279c6215ed155c4a3f24` (2026-09-21).
Fresh main: `2bc51d54a60a86778d9c50164291dd2f282c9239`; 0 behind, open/draft/mergeable at the final code check. The evidence commit changes documentation/images only.

## Environment and evidence scope

Actual production React bundle, rendered in Chromium through the Codex browser, against the isolated local NativeDemo review server at localhost:4243. Public market quotes/candles, disposable simulation capital; no production account, database, merge or deployment. CI uses the same terminal and actual isolated native engine with deterministic market data. Large-number and failed-command fixtures are explicitly synthetic.

Manual screenshots below were recaptured after the last runtime change. The `before-*` images and `keyboard-reduced-calculator.png` deliberately document defects before repair; `keyboard-reduced-calculator-final.png` shows the corrected focus behavior. The earlier local preview restriction was resolved by using the permitted localhost review server; no browser security bypass was used.

## Viewport matrix

PASS means rendered workspace/layout and interactions passed in the available Chromium environment; it does **not** mean physical iPhone/Safari keyboard certification.

| Viewport | Chart | Trade | Positions | Calculator | Order Book | Overflow | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 320 x 700 | PASS | PASS | PASS | 4 tabs PASS | Book / Trades PASS | 0 px | PASS |
| 390 x 844 | PASS | PASS | PASS | 4 tabs PASS | Book / Trades PASS | 0 px | PASS |
| 393 x 852 | PASS | PASS | PASS | 4 tabs PASS | Book / Trades PASS | 0 px | PASS |
| 430 x 932 | PASS | PASS | PASS | 4 tabs PASS | Book / Trades PASS | 0 px | PASS |
| 768 x 1024 | PASS | PASS | PASS | 4 tabs PASS | Book / Trades PASS | 0 px | PASS |
| 1366 x 768 | PASS | PASS | PASS | PASS | PASS | 0 px | PASS |
| 1440 x 900 | PASS | PASS | PASS | PASS | PASS | 0 px | PASS |
| 1920 x 1080 | PASS | PASS | PASS | PASS | PASS | 0 px | PASS |

Measurements: [browser-measurements.json](browser-measurements.json), [desktop-geometry.json](desktop-geometry.json). Desktop uses its normal simultaneous panels rather than mobile workspace tabs. Extra short-viewport check: 320 x 420.

## Proven bugs and minimal repairs

| Reproduction / evidence | Root cause | Repair / regression |
| --- | --- | --- |
| 320px brand hidden by Deposit, [before](screenshots/before-320-header.png) | Header actions could not fit beside the brand | Hide the duplicated header language control only below 360px; language remains in the menu. Browser asserts brand/deposit separation at all five widths. |
| Footer calculator text leaves 320px viewport, [before](screenshots/before-320-calculator.png) | 44px icon-button width also applied to the text launcher | Limit fixed width to the heading icon; retain minimum touch height. Browser asserts bounds and opens/closes footer calculator. |
| Cross/leverage covers Price; order summary appears after account, [before](screenshots/before-393-trade-overlap.png) | Desktop absolute positioning, margin and flex order leaked into mobile grid | Reset those properties only under the existing mobile media query. Browser asserts margin -> tabs -> Price and summary -> calculator ordering. |
| Calculator focus moves from input to dialog during live updates, [before](screenshots/keyboard-reduced-calculator.png), [after](screenshots/keyboard-reduced-calculator-final.png) | Focus effect depended on the parent's newly created onClose callback | Separate focus-on-open from Escape handler registration. Browser fills the input, crosses a 5.2s live refresh, verifies activeElement, then appends a character. |

All affected widths rerun after fixes. Desktop geometry remeasured after the focus repair. No redesign, financial calculations, backend, execution adapters or data architecture changed in these repairs.

## Chart and order ticket

- BTC/USDT, current price and 24h change readable; market-stat disclosure opened and closed at every mobile width; no page horizontal overflow.
- Timeframes switched 1h -> 4h -> 1h. Indicators opened, Bollinger/RSI toggled and restored; drawing line/cursor and toolbar collapse used. TradingView iframe switch and return to VOLTEX exercised. Chart and volume remain bounded.
- Disposable historical Long entry at **80,870.40**, 2026-09-18 23:00 UTC 1h close; reload retained its anchor. Entry line and historical arrow/text rendered. TP **87,000** and SL **79,000** saved in the position editor and rendered on the chart/cards.
- Cross server liquidation was null: dash, no LIQ line. Separate Isolated Short at **76,294.60**, 5x had server liquidation **91,202.30**. Its LIQ label appeared when the price scale was expanded; it was initially above the visible price range, not invented or clamped. [LIQ screenshot](screenshots/393-chart-server-liq.png).
- Four ticket families only: Limit, Market, Stop, Take Profit; no OCO tab. Cross/Isolated, leverage, price/quantity, all percentage presets, collapsible TP/SL, reduce-only and order summary exercised.
- Historical account refuses an unselected LIVE entry; selecting a valid historical candle restored the allowed flow. No freshness or mode guard was weakened.
- Book/Trades navigation and aggregation selector used. Clicking an observed Ask populated the exact draft price and opened Trade without submitting. CI retains command/request guards.

## Positions and Close All

- Cards show side/margin/leverage, quantity, notional, Entry/Mark/LIQ, unrealized/realized PnL, ROI and server TP/SL. All actions accessible by vertical scrolling, including at 320px.
- Position leverage changed 10x -> 5x through the normal editor; entry and quantity stayed unchanged. Limit Close opened the correctly sized reduce-only draft without submitting.
- Close All confirmation/cancel checked at every mobile width. Real local confirmation closed both disposable historical positions, **2 / 2**, at the current server market, leaving zero positions/orders. [Success](screenshots/393-close-all-success.png). Existing financial CI verifies the historical-entry/current-close contract.
- Rendered CI injected a timeout for the second close at all five widths: **1 / 2**, remaining position retained, no automatic retry, dialog fully within viewport and dismiss button usable. [320px partial failure](screenshots/mobile-close-all-partial-320.png).
- Large-value rendered fixtures cover 320/390/1440px: positive/negative millions, zero, ROI 128450.75% and -99999.99%, position value above 2.5bn, plus history and PnL cards. No clipped cells, intersecting cells, NaN, Infinity or scientific notation. [CI report](ci-large-values-report.json).

## Calculator

All four tabs rendered at every mobile width. Long/Short, Entry, Exit/Mark, Quantity, Leverage, Maker/Taker, Gross/Net, Target PnL/ROI, allocated margin and funding inputs/options exercised. Dialog close and internal scrolling work.

- Normal quote: entry 80000, exit 85000, quantity 0.002, leverage 10.
- Large quote at 320px: entry 1000000, exit 2000000, quantity 100, leverage 1; **99,835,000.00 USDT net PnL** and **100,000,000.00 USDT notional** display in full through internal scrolling. [Large calculator](screenshots/320-calculator-large.png).
- Excessive leverage for the size displays the server validation message rather than fabricated results.
- Apply populated the unsent ticket; positions/orders unchanged. Large-number inspection was closed without applying its values.

## Keyboard, safe area and touch targets

**Real iOS virtual keyboard NOT tested: this browser is desktop Chromium.** No claim of Safari auto-zoom or physical notch/home-indicator certification.

What was actually checked:

- Real focus/click and text entry for Price, Quantity, TP, SL and calculator fields. Computed input text size is **16px**.
- Reduced visible viewport **320 x 420**: active Price and TP/SL remain above sticky actions; vertical scrolling reaches fields/actions. Calculator uses a **344px** dialog, **64px** internally scrollable body and fixed **97px** footer. Focused quantity stays visible, footer and Close remain reachable. [Measurements](keyboard-measurements.json).
- After the focus repair, an input remains active across market refreshes; continued typing works. CI repeats the refresh/focus assertion at 320/390/393/430/768px.
- Mechanically inspected visualViewport resize/scroll listeners, >140px keyboard-inset detection, nav hiding while inset is active, safe-area env padding and dialog height limits. Chromium viewport resizing changes innerHeight and visualViewport together; it does **not** exercise a genuine nonzero iOS keyboard inset or notch inset.
- Main workspace tabs, order tabs, margin/leverage controls, percentage buttons, calculator controls and position actions have mobile touch sizing (generally >=44px; submit buttons >=52px). Order-book rows are 44px. Small descriptive text is not a touch target.
- Bottom navigation did not cover form fields/actions in tested scroll positions. The existing global support bubble can overlap the Profile navigation area at narrow widths; this pre-existing app-wide widget is outside the Futures form and was not redesigned here.

Recommended owner device check: iPhone Safari, decimal keyboard on all five input categories, rotate with keyboard open, scroll to submit/Apply and dismiss; verify notch/home indicator on hardware. This is an explicitly allowed tooling limitation, not a fabricated PASS.

## Desktop stability

Baseline `62eeb00a21536b4c2983172d19ab800949c36cfc` has **no tree diff** from main `2bc51d54...`. Its built terminal was served separately and measured at 1366/1440/1920.

For each viewport, final vs baseline rectangles are exactly equal for ticker strip, chart, order book, right ticket, positions panel and bottom asset strip. No page overflow. Order-book density/cadence unchanged; desktop CSS unchanged. Calculator opens within viewport at each size. Focus repair changes interaction only, not its geometry. This is a geometry comparison, not a pixel-perfect comparison of changing live market pixels.

## Validation

Runtime `974a5e68ae9b484431b3279c6215ed155c4a3f24`:

- Backend TypeScript/build and frontend TypeScript/production build: PASS.
- Local broad regression: **1542 PASS, 33 database-gated SKIP, 0 FAIL**; [raw output](final-tests.json). Final focused calculator/math/read-only regressions: **55 PASS**; mobile scope: **2 PASS**.
- Full CI integration with disposable PostgreSQL: **87 suites, 1575 tests PASS, zero skips**. Includes #152, #156, calculator, Pro/chart/Close All/order-panel/mobile suites.
- Native math/auth CI: **242 PASS**.
- Actual native browser: **40/40 PASS**; [report](ci-browser-report.json).
- Large values/browser/cards: **87/87 PASS**; [report](ci-large-values-report.json).
- All **7 relevant workflows GREEN** on the tested code. [Integration](https://github.com/nazardzuba79-tech/-/actions/runs/35599273737), [native/browser](https://github.com/nazardzuba79-tech/-/actions/runs/35599273846).
- Syntax and diff checks PASS. No backend/math/freshness/CAS/rollback/idempotency/projection/lazy-history implementation changes. No full journal polling added. Production acceptance/egress not rerun.

## Screenshots

Required final-build images:

- [mobile-chart.png](screenshots/mobile-chart.png)
- [mobile-trade.png](screenshots/mobile-trade.png)
- [mobile-positions.png](screenshots/mobile-positions.png)
- [mobile-calculator.png](screenshots/mobile-calculator.png)
- [mobile-orderbook.png](screenshots/mobile-orderbook.png)
- [desktop-after.png](screenshots/desktop-after.png)

Additional aliases: mobile-320, mobile-393, mobile-430, tablet-768, desktop-1366, desktop-1920; individual chart/trade/positions/calculator/book/confirmation images for every mobile/tablet width. Normal viewport screenshots intentionally show the current visible area; long position cards and calculator results use their real scroll behavior.

## Known preview limitations

The isolated review server does not implement every public summary route: Index, OI, funding timer and top-eight list can show their honest unavailable state. Their layouts/disclosure were checked; this report does not certify those public feeds in production. TradingView is an external iframe; switching/mounting/back-navigation were checked, not its third-party internals. Live prices naturally differ between screenshots and server-backed positions; historical Entry remains fixed.
