# Studio terminal final refinement — 2026-09-14

Implementation: `994c27520bc5999af0df19460b55fb9b8831e147` on the existing `codex/terminal-layout-repair` branch. Work continued without resetting prior changes. Fetched main remained `db23fdf70b076a7a7fe844d85eefd4f32bb59b12` at task start.

## Changes

- Shared readable metadata and form styling for Spot, Futures and CFD; explicit timeframe/type/indicator groups, pressed states and translated accessible group names.
- Spot quantity/quote-total formatting fits narrow columns; exact numeric tooltips and selected price remain unchanged.
- Failed account reads show one actionable state per panel. Prior real rows remain available with a refresh-failure notice. Failed empty refreshes no longer claim a current empty account. Retry controls reflect pending reads.
- Spot catalogue rows without a positive last-trade price show dashes for price and dependent change. Missing changes stay unavailable; an actual zero change with a valid price stays `+0.00%`. All symbols and sorting remain intact. Public GHIBLI/YALA records were observed with zero last-trade/high/low/volume and positive bid/ask; no bid/ask price was substituted.
- Narrow Futures position headers scroll in a minimum-width table instead of overlapping. On mobile CFD, symbol, quote and daily change remain visible together.

Preserved: Studio A palette and compact seams, owned chart and TradingView alternative, default 1h, all five order-family forms, full Futures catalogue, real book aggregation and streams, five grouping choices capped at 5 and scaled for low-price assets, 36px Futures center strip, order payloads, financial math, auth and CFD execution safeguards. Backend/runtime/API/Analytics were not changed.

## Validation

- `npm --prefix frontend run build`: TypeScript and Vite production build passed; 5,754 modules, final Vite build 5.72s.
- 472 tests passed in 16 focused suites in 9.934s: referenceBook, chartDrawings, spotOrderBook, futuresFinalPolish, futuresOrderPanel, spotOrdersPresentation, cfdTerminal, futuresDepth, cfdDisplayOnly, terminalPresentation, futuresAccountUnknownState, futuresAccountStore, spotPairList, spotOrderEntry, spotOrderFeedback, marketColumnSort.
- `git diff --check`: passed. No global/backend full-suite claim; previously documented unrelated cfdChartFallback test-loader failures were outside this UI change.
- Browser: Futures 1440/1077/390, Spot 1440/390, CFD 1440/390. No horizontal document overflow; zero clipped Futures book cells at 1077 and Spot cells at 1440. Narrow Futures table measured864px with internal scroll, center strip36px. Five grouping options0.1/0.2/0.5/1/5 verified for BTC, with real bids and asks retained at5. Default1h, OCO and Stop forms, unavailable Spot quote display, and one retryable initial account notice checked. No order submitted.
- Screenshots saved outside the repository at `../../artifacts/studio-final-2026-09-14/futures-1440.png` and `spot-1440.png` relative to the worktree root.

## Preview and limits

Local entry: `http://127.0.0.1:4210/__qa/start?market=futures` (also `market=spot` and `market=cfd`). The existing loopback QA harness serves the production build, proxies anonymous public reads, blocks all writes and intentionally returns503 for private account data. Visible unavailable account states in this preview are expected, not a diagnosis of production account availability. Success, empty, failure and stale-refresh states are covered by component tests. CFD remains practice/nonexecuting where already configured; no unsupported execution was enabled.

No push, merge or production deployment in this task. Authenticated production verification would belong to a later release.
