# Terminal chart chrome and order-book review

Base fetched before work: **b9853ccb716bbf698af0cf39bf3a87090d5b47b2**. Branch: **codex/terminal-chart-geometry-orderbook**. No merge or deployment.

## What changed

- Removed the duplicate VOLTEX timeframe/VOL bar and the parent interval state. Native TradingView top toolbar, full Indicators catalog, drawings, volume and date ranges remain enabled. New symbols start at the widget's configured 15-minute interval; there is no parent label pretending to follow cross-origin interval changes. Verified 13 CFD symbol mappings remain unchanged.
- Restored VOLTEX toolbar/workspace/grid/chart tokens to #151e28 / #151e29 / #0e151e / #0d141d. Host, loading/fallback, footer and chart canvas share #0d141d; grid uses #0e151e. Visible bottom-right attribution now occupies 16 px, without a border. Browser inspection found the official loader injects a global 32 px copyright line-height with !important; the scoped parent-page rule explicitly overrides that while retaining the text and links. No iframe CSS injection or branding removal.
- Spot/Futures book: desktop 250 px, stable 30:32:38 grid tracks, right-aligned Amount/Total, tabular figures. Actual browser fonts are Spot 11.5 px / Futures 12 px. Normal quantities retain meaningful fractional precision; ordinary totals use grouped cents (75,787.93 / 6,518.43 / 100,603.20), zero is 0 and unknown is —. Extremely small (<1e-7) or large (>=1e9) quantities alone use compact scientific notation. Exact numeric values remain in tooltips. No aggregate, cumulative-depth, step precision or click-selection math changed. Depth opacity is 0.045.
- The first candidate browser run caught a genuine transient price truncation: the old Spot flex rule's max-width:55% was being applied to a single new grid track, leaving a 37 px Price cell. A narrowly scoped override removes that obsolete cap. Repeated browser QA after the fix found no truncated numeric cells.

## Requested blank strip: not reproduced, not claimed fixed

Before editing, ran the unchanged production build through 66 switch samples across Spot/Futures/CFD and nine settled resize samples (1920, 1440, 1366, 390 and back). Inspected the iframe and every ancestor's dimensions/display/flex, including the actual TradingView injected structure. The official loader replaces its placeholder with a direct iframe child of the owned container, using inline width/height 100%. No extra sizing wrapper appeared. All measured rendered iframe widths matched their plot; no right-side strip was reproduced. Raw evidence: [before-dom.json](before-dom.json), [before-stable.json](before-stable.json).

**The production intermittent strip's root cause remains unconfirmed. This PR does not claim to fix it.** No speculative ResizeObserver, delayed initialization or staged old-symbol display was added. Existing per-effect generation ownership and detached-subtree cleanup were preserved. The lifecycle test now covers 20 switches per market with StrictMode and late detached script work, using the observed direct-iframe structure.

Final browser QA: **116 samples**, all measurable iframe/plot width deltas **0 px** (allowed <=2). Spot, Futures and CFD each completed the requested ten-symbol sequence and a separate 20 rapid switches; each ended with **1 owned host + 1 iframe**, actual iframe symbol matching the selected symbol. Zero page overflow, duplicate toolbar, provider in VOLTEX header, truncated numeric cells or page exceptions. Indicators/drawings/canvas verified for all 11 named instruments and all 12 market/viewport combinations. Full native Indicators dialog was opened separately: [screenshot](native-indicators.png).

| Market / viewport | Plot and iframe width | Difference | Fully visible ask/bid levels |
|---|---:|---:|---:|
| spot:1920x1080 | 1131 | 0 | 15/15 |
| spot:1440x900 | 667 | 0 | 11/11 |
| spot:1366x768 | 593 | 0 | 7/7 |
| spot:390x844 | 390 | 0 | 7/7 |
| futures:1920x1080 | 1149 | 0 | 15/14 |
| futures:1440x900 | 701 | 0 | 11/11 |
| futures:1366x768 | 627 | 0 | 8/8 |
| futures:390x844 | 390 | 0 | 7/7 |
| cfd:1920x1080 | 1398 | 0 | —/— |
| cfd:1440x900 | 950 | 0 | —/— |
| cfd:1366x768 | 876 | 0 | —/— |
| cfd:390x844 | 390 | 0 | —/— |

At 1080 px height, up to 15 levels fit per side without an inner book scrollbar (fewer if the real grouped feed supplies fewer). Shorter viewports retain the nearest levels and clip distant rows; no synthetic depth is filled in. Ask prices are ascending in DOM order with column-reverse layout (best ask immediately above spread); bid prices are descending top-down (best bid immediately below spread). Browser report records their physical row coordinates.

## Validation and limits

- Frontend TypeScript: PASS. Production Vite 5.4.2 build: PASS. Windows sandbox blocked native esbuild process pipes, so the existing environment-only Vite build helper uses matching esbuild WASM in-process; repository build config/dependencies are unchanged.
- Eight focused suites: **241 passed / 1 existing failure**. Unchanged-main baseline: **227 passed / 2 failures**. **New failure names: 0**. [Exact identities](focused-results.json). The remaining failure is FuturesPage's pre-existing semantic fingerprint mismatch; its assertion and source were not changed. The old CFD chart dependency assertion (still referring to removed study state on main) was updated for the genuinely changed native-only chart state. No full repository/backend suite.
- Real Edge production-build QA uses the existing local harness: anonymous real public market reads, fixture local identity, private account reads unavailable and all financial writes denied. **Not a clean-console or authenticated financial-flow pass:** browser-report.json retains resource errors from deliberately blocked local private/funding endpoints, public provider unavailability and occasional third-party CDN requests. There were zero page exceptions. CFDs remained unavailable for execution when provider quotes were unavailable; no substitute value or CFD order book was added.
- [Official TradingView Advanced Chart configuration](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) supplies theme, canvas background and grid settings. Native top toolbar, left drawing toolbar and bottom date-range/status pane are owned by TradingView's dark theme; the public embed does not expose separate palette controls for them. They retain the provider's native shades. No Advanced Charts library overrides or cross-origin DOM/style writes.
- Protected source is byte-unchanged from base: backend, collector, Prisma, balances/ledger/matching/margin/liquidation/funding/orders, deposits/withdrawals, API methods, CFD quota scheduler/entitlements/gates, inverse/options and Copy Trading. PR44's 13-instrument catalog and quota policy are untouched.

## Screenshots

| View | 1920 | 1440 | 1366 | 390 |
|---|---|---|---|---|
| Spot | [open](spot-1920.png) | [open](spot-1440.png) | [open](spot-1366.png) | [open](spot-390.png) |
| Futures | [open](futures-1920.png) | [open](futures-1440.png) | [open](futures-1366.png) | [open](futures-390.png) |
| CFD | [open](cfd-1920.png) | [open](cfd-1440.png) | [open](cfd-1366.png) | [open](cfd-390.png) |

[Spot book](orderbook-spot.png) · [Futures book](orderbook-futures.png) · [after 20 switches](symbol-switch-after-20.png) · [raw browser measurements](browser-report.json). Screenshots contain real external chart/feed values at different capture times, not invented fixtures.

Reproduction: build frontend; run scripts/qa-professional-terminals.cjs with TERMINAL_QA_PORT=4198; run scripts/qa-terminal-geometry.cjs with PLAYWRIGHT_MODULE and EDGE_PATH pointing to installed browser tooling. Local preview starts at http://127.0.0.1:4198/__qa/start. No hosted preview was created. Commits use [CF-Pages-Skip] to prevent automatic Pages deployment, per [Cloudflare documentation](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message).

[Exact changed-file manifest](changed-files.txt). Additional clean-load Futures verification: [1440 screenshot](futures-isolated-1440.png). The repeated resize capture can show transient Chromium text-paint artifacts; clean-load inspection confirmed the selected pair and headers have their full text, dimensions and visible color.
