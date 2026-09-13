# Futures terminal — owner-supplied Bybit visual reference

Base: `0f7ab66f9af6e5e1a33ff0356182a2174b804c66` (freshly fetched GitHub main, 2026-09-13).
Branch: `codex/terminal-reference-layout`. Review only; no merge/deployment.

## Presentation

- Desktop has permanent left search and markets as requested in the owner's follow-up. At 1920px the sidebar is 240px, chart 1040.6px, book 293.8px and rail 345.6px. The book is 23px narrower than the first PR version (228px versus 240px at 1440). The right rail spans the instrument header and lower positions area.
- Selecting the instrument name focuses the permanent desktop search. Tablet/mobile use a native modal dialog. Exactly one market list is mounted; the selected contract survives breakpoint changes. Search, sorting, favorites and virtualization remain. The sort selector has a full-width line instead of a clipped label.
- Neutral charcoal surfaces, orange active accents, aligned book/chart headings, clearer secondary labels and one integrated account rail. Form gaps reduced from 18px to 13px, header values increased to 14px and form labels to 13px. Margin/leverage are above Limit/Market; existing sizing and order controls remain functional. Count labels no longer inherit decorative shared badges.
- Market tape moves below the workspace. Tablet uses chart above book/form; mobile uses chart, form, book, positions. The existing mobile navigation remains fixed and content scrolls behind it.
- Futures chart canvas uses the official TradingView background/grid options. Spot and CFD keep their original colors and symbol mappings. Native timeframe/indicator/drawing controls and attribution remain intact.
- Chart integration follow-up removes the extra parent Graph/TradingView heading, aligning the native toolbar directly with the book heading and giving the plot 35px more height. A pointer-transparent one-pixel perimeter matches the terminal divider; the widget is not cropped/scaled or modified across origins. Attribution stays visible in a neutral footer. The chart remains an explicitly labelled accessible region.
- Graphite refinement: chart stays `#101014`, panels use `#17171e`, fields use `#25252f`. One-pixel `#2b2b35` dividers replace thick black boundaries. Shared panel/border tokens unify the account summary and menus. Order estimates use simple horizontal rules instead of another boxed card.
- USDT market rows show the base asset on one line, without a repeated `/USDT` subtitle. Full symbols remain in accessible button labels and all selection/search/API values; non-USDT quotes remain visible. Rows are 36px, with aligned numeric columns and enough room for triple-digit percentage moves. Desktop sidebar minimum is 236px (still 240px at 1920).
- Final typography/state pass: market prices 13px, signed changes 12px without redundant direction triangles; account labels and table headers at least 12px, numeric rows 13px. Account heading and P&L use stable separate rows; the balance-visibility button has a translated accessible name. Empty/loading/error positions have a centered state and failed reads offer a real shared-store retry. Cold order-read errors appear once with retry; stale last-good rows remain visible. An unavailable market-order mark price shows `—`, not an endless loading label. Financial calculations and execution guards are unchanged.

This is a VOLTEX implementation of the reference's hierarchy and proportions, not a pixel-identical copy of Bybit's private chart integration. Unsupported Post-Only/TIF and order-entry TP/SL controls were not invented. VOLTEX branding and the real existing APIs remain.

## Actual browser evidence

Same 1920×1080 viewport, same read-only local harness, current main versus candidate:

| Current main | Candidate |
| --- | --- |
| ![Current main](before-main-1920.png) | ![Candidate](futures-1920.png) |

[1440](futures-1440.png) · [1366](futures-1366.png) · [1280](futures-1280.png) · [1024](futures-1024.png) · [768](futures-768.png) · [390 chart](futures-390-chart.png) · [390 order controls](futures-390-controls.png) · [Market search](market-selector.png)

`browser-results.json`: all seven viewport widths have no page overflow, one native chart iframe matching the container width, and fitting action labels. Desktop rail and bottom panel end together; tablet book and form share a row. Twenty alternating BTC/ETH sidebar selections verified the matching BYBIT perpetual iframe without stacking. Desktop search focus, mobile dialog/Escape, responsive modal removal and mobile controls above the fixed navigation were checked. Screenshots use actual public data only; private account requests are intentionally unavailable and all writes are blocked by the QA harness. Missing ticker/mark/account values are visible as unknown, not filled with sample numbers. Mobile viewport screenshots verify the actual rendered chart.

Local preview: `http://127.0.0.1:4202/__qa/start?market=futures` (requires the running local QA server). This is not a deployed branch URL.

[Immediately before graphite refinement](before-graphite-1920.png) · [Updated graphite refinement](futures-1920.png)

## Validation

- Latest measured-reference pass: see [interface study](interface-research.md), [1920 screenshot](research-1920.jpg), [1440 screenshot](research-1440.jpg), [390 screenshot](research-390.jpg), and [browser checks](research-browser.json). Locally bundled Inter replaces mixed terminal fonts, navigation matches the observed 48px/14px/400 hierarchy, native Futures legend/grid use supported settings, and order controls share consistent states. Seven widths have no page overflow or clipped book/change values. Native Indicators verified using keyboard Enter; form controls checked without financial writes.
- Latest expanded validation: frontend TypeScript/build PASS; **248 passed / 8 pre-existing failures / 256 tests across ten suites**. The four additional header ownership failures also reproduce in the two added suites on pristine main (27 passed / 4 failed); they are not new regressions. Earlier eight-suite comparison remains below. Exact current names and zero new failures are in [research-tests.json](research-tests.json). Palette assertions now additionally verify Futures legend/grid and unchanged Spot/CFD behavior.

- Frontend TypeScript: PASS (`node frontend/node_modules/typescript/bin/tsc -b frontend`).
- Chart integration follow-up: TypeScript/build rerun PASS; all seven browser widths rechecked, including opening/closing the native Indicators dialog through its own close button and visible attribution. The prior eight-suite counts below are from the preceding functional sidebar change; this follow-up only changes the outer chart presentation/accessible label.
- Vite production build: PASS. Windows environment runner uses the same Vite/React configuration with in-process esbuild WASM because native Node pipe creation is restricted; no dependency or build configuration change committed.
- Six focused suites (`futuresOrderPanel`, `futuresFinalPolish`, `futuresAccountUnknownState`, `cfdChartFallback`, `terminalPresentation`, `spotOrderBook`): **166 passed, 4 failed / 170**. Four new chart palette/ownership cases pass.
- Same six suites in pristine worktree at exact base main: **162 passed, 4 failed / 166**.
- Additional account-store and position-protection suites: **52 passed / 52**.
- Follow-up rerun of all eight suites together: **219 passed, same 4 failed / 223**. One additional responsive-list test verifies one list and retained contract across desktop/mobile changes. Existing hook harness now supplies the browser's `matchMedia` API; no existing assertion removed or weakened.
- Graphite/row refinement rerun: TypeScript and production build PASS, eight focused suites again **219 passed / same 4 existing main failures**, new failures zero. Browser at seven widths checks the three distinct surfaces, no repeated USDT subtitles, unclipped percentage labels, no horizontal page overflow, one chart, native indicators and responsive market selection. Quotes in screenshots are actual public data, not fixtures.
- Final acceptance: TypeScript/build PASS; **221 passed / 4 identical main failures / 225 tests**. Two additional tests verify that retrying open positions versus history invalidates only the correct read resource and never claims an unknown account is empty. Browser acceptance covers all seven widths plus Limit/Market toggling, price entry, real-config 5x/10x presets, menu bounds, order/position tabs, a retry GET, Indicators open/close, twenty BTC/ETH switches, one list across breakpoints and fitting mobile controls. No financial submission or production mutation occurred.
- **New failures versus main: 0.** Existing failing assertions were not weakened or rewritten:
- Composition completion: aligned dark chart/book/tab bands; 12px book labels and higher-contrast secondary text; 156–194px desktop lower panel with persistent position column headings; separated account PnL, risk tracks and balance rows. Desktop support is docked into the bottom tape instead of covering account controls. TypeScript/build pass; eight suites rerun at 221 passed / the same 4 baseline failures. Seven-width browser acceptance rerun passes, including support open/close, dock outside the trading rail, visible unavailable-state column headers and native chart controls. One initial run timed out waiting for a live ETH market entry; an unchanged repeat passed all twenty switches. No market values were seeded to make the run pass.
  - `timeframe label is driven by the exact interval sent to the chart; controls cannot drift`
  - `native TradingView indicators toolbar is enabled and volume remains controllable`
  - `verified CFD mapping and compact visible attribution are preserved`
  - `Spot tiny-price rows keep unchanged full numeric labels and narrowly scoped non-overlapping cells`
- The first three still expect parent controls already removed on main in favor of the native widget. The fourth expects an older Spot total formatter. Both implementations and all four assertions predate this branch.
- No full backend suite claimed: backend/collector, account state, order payloads, matching, balances, funding, leverage/risk formulas and protection logic are unchanged. Diff whitespace check passes.

To repeat browser QA, run `scripts/qa-professional-terminals.cjs` with `TERMINAL_QA_PORT=4202`, then `scripts/qa-terminal-reference.cjs` with `PLAYWRIGHT_PATH` and `EDGE_PATH` pointing to the local Playwright module and browser executable. No market/account fixture values are injected.
