# Desktop Futures — Figma 19:103 (2026-10-10)

Base: `1d0fae9c3f3ccd4ec9aa995038e3eb0d4476230b`. Branch: `codex/futures-figma-desktop-20261010`.
Scope: one Futures CSS import and a desktop-only geometry stylesheet. Existing React controls, chart, orderbook, account tabs, actions, data readers and financial calculations are unchanged. No mobile, Stocks, API, backend or production changes.

## Source and measurement provenance

[Owner's Figma node](https://www.figma.com/design/9gbmBfp0OSHTzLsnbBUnrZ/Untitled?node-id=19-103).
Figma MCP tools were not available in this session. After the owner signed in, the editable hierarchy and properties were inspected in the Figma editor. The selected Container was exported as PNG and SVG (layer IDs retained, text not outlined). Temporary export settings were removed. This is a browser/editor + editable SVG measurement, **not an MCP result**.

Target Container: 1547.27 × 1327, at (0,47.99) inside Html 1547.27 × 1374.99.
PNG export rounds width to 1548. All reference coordinates below are relative to the target Container, not the full browser. Source SVG is retained alongside the PNG; no screenshot is embedded into the product.

## Measured Bybit → VOLTEX comparison

At a 1548 × 1052 browser viewport, VOLTEX's 48px site header and 28px tape leave a 1548 × 976 workspace. The reference's active left workspace ends at y=972. Its remaining 355px is blank, while its right panel continues beyond the left workspace. We fit the active grid to the viewport instead of reproducing blank space or clipping controls.

| Element / SVG layer | Figma (px) | VOLTEX (px) |
| --- | --- | --- |
| Pair/statistics, Aside | x4 y4, 1240.12 × 55.99 | x4 y4, 1236 × 56 |
| Chart, Background_2 | x4 y63.99, 949 × 524 | x4 y64, 946 × 524 |
| Chart heading | 39.808 high | 40 high |
| Chart toolbar, Background_3 | 949 × 40 | 946 × 40 |
| Orderbook, Background_11/12 | x957 y63.99, 285.99 × 524 | x954 y64, 286 × 524 |
| Buy/Sell panel, Background_20 | x1248.12 y4, 300 wide | x1244 y4, 300 wide |
| Trading heading | 46.606 high | 46 high |
| Form interior | 12 side padding; 276 wide | 12 side padding; 276 wide |
| Margin / leverage controls | 142.7 / 121.31 wide, 32 high | existing two-column control, 32 high |
| Fields, Background_27/28/29 | 276 × 40; radius 4 | existing floating-label fields 276 × 42 including border |
| Long / Short actions | 132 × 42, gap 12 | 132 × 42, gap 12 |
| Bottom account, Background_15 | x4 y591.99, 1239 × 380 | x4 y592, 1236 × 380 |
| Bottom tab header, Background_16 | 44 high | 44 high |
| Panel gutters | 4 | 4 |
| Tile / field colors | #101014 / #222227 | existing VOLTEX colors retained |
| Type sizes in SVG | 12 / 13 / 14 / 16 | existing 12 body / 14 panel tabs / 16 price; order family tabs 13 |
| Typefaces | Inter; chart Trebuchet MS | existing VOLTEX typography retained |
| Borders/radius | form radius 4; subtle dividers | existing form styling and 6px VOLTEX panel corners retained |

The 3–4.12px horizontal offset is intentional: VOLTEX keeps 4px right padding; the imported 300px panel extends past the nominal frame edge. Heights align to within 0.61px (rounded heading), major horizontal panel boundaries to 0.01px. No claim of full pixel identity: the reference has POV order controls, different market data and Bybit branding. Existing Limit/Market/Stop/Take Profit remains functional; no unsupported POV or Open/Close trading mode was introduced.

## Responsive desktop

The remaining chart/account area uses a 524:380 ratio, with 300/180px minimums. Collapsing the account area retains its existing 44px tab header. A compact laptop statistics row wraps descriptive labels without truncating values.

| Width | Ticker height before → after | Book width before → after | Chart height before → after | Bottom height before → after |
| --- | --- | --- | --- | --- |
| 1920 | 56 → 56 | 319.19 → 286 | 712 → 540.22 | 220 → 391.78 |
| 1440 | 96 → 56 | 250 → 286 | 492 → 435.89 | 220 → 316.11 |
| 1366 | 96 → 56 | 250 → 286 | 360 → 359.38 | 220 → 260.63 |

## Evidence and pixel diff

- [Original Figma PNG](figma-19-103.png), [editable exported SVG](figma-19-103.svg).
- [1920 before/after](comparison-1920.png), [1440 before/after](comparison-1440.png), [1366 before/after](comparison-1366.png). Same viewport per pair; left before, right after.
- [Geometry overlay](reference-geometry-overlay.png): reference pink, VOLTEX cyan.
- [50/50 pixel overlay](reference-overlay.png), [raw pixel difference](reference-pixel-diff.png), [measured coordinates and deltas](comparison.json).
- Reference comparison crops the original to the active 976px workspace; no scaling. Raw pixel diff includes chart/data/branding/control differences and is not a geometry error score.
- Mobile 390 × 844 and Spot 1440 × 852 before/after images are pixel-identical (mean RGB difference 0). All new CSS selectors require the Futures root and min-width 901px.

## Validation

- Frontend TypeScript + Vite production build: PASS. Existing >500kB chunk warning remains.
- Full frontend regression: **234/234 suites, 4064/4064 tests PASS**.
- Existing `qa-futures-proportions.cjs`: 1920/1440/1366/390, 0 violations. Checks margin/leverage, price/amount, chart settings/timeframe/drawings, calculator, navigation/instrument switching, account state.
- New `qa-futures-figma-desktop.cjs`: 1920/1440/1366 plus reference-width 1548; aligned book/chart, 4px gutters, 300px form, 286px book, 42px actions, ratio tolerance <0.005, no overlaps/horizontal overflow, visible Long/Short, usable Limit/Market.
- Isolated loopback fixture; all external requests blocked. No real orders, balances, DB or production writes. Only local fixture execution-session/quote setup is permitted; no execution POST.
- Initial local test run lacked generated Prisma dependency types; generated the client in an isolated dependency directory and reran the complete frontend suite. Another initial assertion required TerminalPanelTiles to remain the last import; preserved that order and reran all checks.

## Reproduce

Build frontend first: `npm --prefix frontend run build`.
Run `npm test -- --runInBand --testPathPattern=frontend/src`.
Set `QA_PLAYWRIGHT_MODULE` if Playwright is not locally installed.
Run `node scripts/qa-futures-proportions.cjs --phase after --port 4444 --widths 1920,1440,1366,390 --out <evidence-dir>`.
Set `FIGMA_QA_OUT` to an evidence directory, then `node scripts/qa-futures-figma-desktop.cjs` (port 4445).
Local read-only preview: `node scripts/qa-futures-proportions.cjs --serve --port 4443`, open `http://127.0.0.1:4443/futures?pair=BTC%2FUSDT`.

Publication boundary: **Draft PR only; no merge, no deploy, owner review pending.**
