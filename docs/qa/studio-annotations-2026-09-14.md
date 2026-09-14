# Studio annotated refinements — 2026-09-14

Continued the clean `codex/terminal-layout-repair` checkout from `d2c27376ef6a46a610ddf68a20b3e5f7aa13ecf2`. No reset, branch replacement, or financial behavior change.

## Requested presentation changes

- Brighter terminal navigation, VOLTEX wordmark, headings and metadata; approved Studio palette and gold accents retained.
- Native Spot/Futures and CFD chart grid lines hidden. Existing candles, volume, MA200, price line, drawings and 1h default remain.
- Stronger Text tool silhouette and longer Ruler icon. Drawing rail starts expanded and has a persistent collapse/reopen chevron. Collapsing cancels an in-progress gesture without deleting saved drawings or chart preferences.
- Fully rounded buy/sell selectors and submit buttons in Spot, Futures and CFD. All five order-family forms and existing execution gates retained.
- Spot/Futures verified-empty account panels shrink to a 44px tab strip. Tabs, History, Assets and manual expansion remain reachable. Readers remain mounted; new activity and failed refreshes restore the body. Other-pair orders prevent Spot compaction; Futures requires both account orders and positions to be verified empty.
- Compact navigation below 1440px prevents Spot/CFD header overlap. Drawer aligns with the existing 48/56px terminal header.
- Desktop Studio support launcher is docked beside the market tape so it cannot cover the account-panel restore control.

CFD account-panel auto-collapse is not changed: its current local storage reader cannot distinguish unavailable/malformed storage from a verified empty account without a broader data-layer change.

## Validation

- 510 tests passed in 18 focused suites (12.391s): referenceBook, chartDrawings, spotOrderBook, futuresFinalPolish, futuresOrderPanel, spotOrdersPresentation, cfdTerminal, futuresDepth, cfdDisplayOnly, terminalPresentation, futuresAccountUnknownState, futuresAccountStore, spotPairList, spotOrderEntry, spotOrderFeedback, marketColumnSort, priceChartMarketOrders, terminalAccountPanel.
- New interaction coverage checks mounted polling, new-order expansion, failed refresh, other-pair orders, manual reveal/ARIA, and chart-state preservation.
- Frontend TypeScript and production build passed. No global/backend full-suite claim for this frontend-only change.
- Browser: Spot/Futures/CFD desktop visual checks; Spot 1280 and 390 responsive checks. No horizontal page overflow. Desktop rail 44→18→44px; mobile 42→24→42px. Spot empty panel 44→159.5→44px; History/Assets reveal the body. Futures empty panel 44px and manual expansion 156px. Computed round-button radius is 999px on all three markets.

## QA data and release boundary

Normal loopback preview on port4210 uses existing public-market reads and intentionally rejects private account reads/writes. Unavailable account states remain visible. The temporary port4211 fixture supplied empty orders/positions responses only to test empty-state geometry; it was isolated, GET/HEAD-only, and not a real account or a deployed feature. Tests exercise populated/error transitions. No orders or financial writes were submitted.

Local implementation and browser verification only. No push, merge or deployment in this task. Current production is not claimed to contain these refinements.
