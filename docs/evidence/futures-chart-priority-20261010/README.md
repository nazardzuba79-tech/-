# Desktop Futures: chart priority (2026-10-10)

Base: `a3e4cca42c0851f5953d0e03ddc7c125c6e21b7a`, freshly fetched main. PR #493 was already merged externally before this task. This follow-up follows the owner's corrected proportions, superseding that PR's 524:380 height ratio.

## Scope

Application changes are CSS only, inside existing Desktop Futures selectors and min-width 901px gates. No React behavior, account data, trading logic, requests, API, backend or mobile breakpoint changes. Stocks, admin and Spot source files are untouched. No merge/deploy.

## Measured geometry

| Viewport | Global header | Ticker | Empty bottom | Chart area before → after | Gain |
| --- | --- | --- | --- | --- | --- |
| 1440 × 900 | 48 → 40 | 56 → 48 | 316.11 → 160 | 435.89 → 608 | +172.11 px (+39.48%) |
| 1707 × 900 | 48 → 40 | 56 → 48 | 316.11 → 160 | 435.89 → 608 | +172.11 px (+39.48%) |
| 1366 × 768 | 48 → 40 | 56 → 48 | 260.63 → 160 | 359.38 → 476 | +116.62 px |
| 1920 × 1080 | 48 → 40 | 56 → 48 | 391.78 → 160 | 540.22 → 788 | +247.78 px |

Chart area includes its unchanged 40px heading + 40px toolbar. The chart/volume viewport below them grows by the same pixel amount. Orderbook stays 286px wide and aligned with the chart; order ticket stays 300px wide. Gutters remain 4px.

The account area is 160px when its existing empty/loading/error status is rendered, 200px for populated tables, and 44px when the user collapses it. No readers are unmounted or data filtered. Tradeoff: fewer table rows visible simultaneously; the existing inner scroll and sticky headings remain. CSS :has selects existing presentation markup; without :has support the fallback is a still-compact 200px.

## Evidence

- [1440 before / after](comparison-1440.png)
- [1707 before / after](comparison-1707.png)
- [Populated table](populated-1440.png)
- [Exact geometry and pixel comparison](comparison.json)

Before/after images use identical viewport sizes and isolated fixtures. Mobile390 and Spot1440 are pixel-identical (mean RGB difference 0). Spot1707 differs only in a 19 × 11px area of the unchanged 0.1 grouping text (mean RGB difference 0.00593/255); no panel displacement.

## Validation

- Frontend TypeScript and production Vite build: PASS (existing chunk-size warning).
- Existing proportions browser QA: 1440,1707,1366,1920,390; zero violations, including controls, chart, navigation and states.
- Updated desktop geometry QA: 4 desktop widths; zero runtime errors/external requests. Confirms 40/48/160px geometry, dominant chart, aligned right panels, no overflow, visible Long/Short, Limit/Market, collapse/expand, populated200px, all three fixture rows accessible, and all five account tabs.
- Local fixture permits only execution-session/quote setup POSTs; no financial execution or production requests.
- Complete frontend regression and exact-head CI status are recorded on the Draft PR. Shared-header stylesheet ownership checks remain intact: header dimensions are changed in the existing Futures header rule.
- Reproduce: frontend build, `node scripts/qa-futures-proportions.cjs --phase after --port 4446 --widths 1440,1707,1366,1920,390 --out <out>`; `FIGMA_QA_OUT=<out> node scripts/qa-futures-figma-desktop.cjs`. Set QA_PLAYWRIGHT_MODULE if required.
- Preview: `node scripts/qa-futures-proportions.cjs --serve --port 4447`.

Owner visual approval remains pending. Draft only; no automatic merge.
