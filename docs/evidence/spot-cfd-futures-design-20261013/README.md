# Spot and CFD in the Futures design (2026-10-13)

Base: fresh `main` `c205ca3ce64f087b490bae11b2a285791f11f052` (includes #507, #508, #511). Branch `claude/spot-cfd-futures-design-20261013`. Draft only; no merge, no deploy, no production change. Desktop only (≥901px); phone and tablet layouts unchanged.

Owner request: «На інші ринки перенеси цей же дизайн, CFD спот».

## What Spot and CFD lacked (measured on main, 1366–1920)

| Futures design element | Futures | Spot (main) | CFD (main) |
| --- | --- | --- | --- |
| Header 48px with a 1px rule (#508) | yes | 48px, no rule | 48px, no rule |
| Pair row 56px (52px under 800px tall), centred, rule under it (#508/#511) | yes | 56px everywhere, no rule | 56px, text 8px from the top / 4px from the bottom (price line hung out of its cell), no rule |
| «График» row 36px, underline straight under the label (#508) | yes | 40px, 12px between word and underline | one chart row, title without the tab underline |
| Toolbar: timeframes, chart-type and «Индикаторы» menus, gear at the right end (#504) | yes | flat buttons that wrapped to a hidden second row at 1366–1920 (chart type and indicators out of reach) | own intervals row (no indicators on the CFD chart) |
| Legend as lines under the title (#508) | yes | boxed chip 32px down | — |
| Rail 56px, 56×38 keys, 24px glyphs (#504) | yes | 52px rail in a 44px shell (8px clipped) | — (no rail on the CFD chart) |
| Collapse handle: Bybit's 10×26 pill on the rail edge (#511) | yes | 43×24 bar above the tools | — |
| Price-scale corner labels only when whole (#508) | yes | could be cut | could be cut |

## Changes

- `frontend/src/pages/trade-terminal/SpotCfdParity.css` — new desktop block «The Futures design of 2026-10-10…11 on Spot and CFD», every value taken from the shipped Futures sheets: header rule `inset 0 -1px 0 #2a2b31`; pair row rule `inset 0 -1px 0 #222227`; CFD metric rows `18px 14px` (price `14px 24px`, status `18px 18px`) so the strip is centred; Spot «График» row 36px / `padding-top:12px` / label 22px with the 2px underline under it; CFD chart title with the same 2px tab underline; Spot toolbar end `margin-left:auto`; Spot legend as plain lines (`top:28px; left:12px`); Spot rail 56px (shell 56, keys 56×38, 24px glyphs, 32px dividers) and the Bybit pill handle (10×26 `#aeb0b5`, chevron `#26292f`, centred on the rail edge at 80%, 26×42 hit area, z 51); plus `@media (max-height:799px)` pair row 52px as on Futures.
- `frontend/src/components/PriceChart.tsx` — desktop Spot (≥901px) uses the Futures toolbar menus (`chartMenus`); the phone Spot sheet keeps its flat buttons. `entireTextOnly` on the right price scale now covers desktop Spot as well as Futures.
- `frontend/src/components/CfdChart.tsx` — `entireTextOnly` on the desktop CFD chart.

Unchanged on purpose: Spot/CFD layout (market list, Spot book 250px, ticket position), every control, order flow, request and market rule; Futures; all phone/tablet sheets. The «•••» phone-only toolbar key that still shows on desktop Spot is hidden by the open Draft PR #513 (another change in flight, not duplicated here).

## Measured after (read-only loopback fixtures, Playwright Chromium)

| | Spot | CFD |
| --- | --- | --- |
| Header rule / pair-row rule | yes / yes | yes / yes |
| Pair row (1366×768 / others) | 52 / 56px | 52 / 56px |
| Pair-row text air above / below (min over 1366–1920 × 90–125% zoom) | 7 / 7px | 7 / 7px (was 8 / 4) |
| «График» row → toolbar → plot | 36 → 40 → plot (+4px plot) | one 40px row, title with the tab underline |
| Toolbar | timeframes · chart type · «Индикаторы» · gear, one 40px row at 1366–1920, nothing wraps | intervals (unchanged) |
| Rail / handle | 56px, 10×26 pill, Enter/Space, remembered | — |
| Legend | lines under «BTC/USDT · 1h» | — |
| Page horizontal overflow (32 width × zoom cases) | 0 | 0 |

Spot menus checked in the browser at 1440 and 1920 (26/26): catalogue of 15 kinds, no visible count on the trigger, EMA added and shown in the legend, kept across a reload in the Spot store (`voltex.chartIndicators.v1`) with the Futures store untouched, chart type switches to Line, the gear opens the settings dialog, the pill collapses and expands the rail from the keyboard.

Pixel identity against main: Spot 390/430/768, CFD 390/768 and Futures 390 — 0 differing pixels. Futures 1366/1440/1920 — 0–7 pixels inside the live ticker/ticket areas, the same spread two captures of main show against each other.

Repository checks on `e3a0e596` (guards with `LANG=en_US.UTF-8`): `tsc -b && vite build` PASS; Jest `frontend/src` 236/236 suites, 4083/4083 tests; `qa-spot-cfd-terminal.cjs` 0 findings (tokens and strip geometry of Spot/CFD against Futures, Futures against its baseline, phones 320–430); `qa-futures-proportions.cjs` 1920/1707/1440/1366/390 0 violations; `qa-futures-figma-desktop.cjs` 4/4; `qa-futures-chart-ux.cjs` 129/0.

## Evidence

- Futures / Spot / CFD after, 1440: [futures-spot-cfd-1440.png](futures-spot-cfd-1440.png)
- Spot before/after: [1366](spot-before-after-1366.png) · [1440](spot-before-after-1440.png) · [1920](spot-before-after-1920.png); chart chrome 2x: [spot-chart-detail-2x-1440.png](spot-chart-detail-2x-1440.png)
- CFD before/after: [1366](cfd-before-after-1366.png) · [1440](cfd-before-after-1440.png) · [1920](cfd-before-after-1920.png); strip 2x: [cfd-strip-detail-2x-1440.png](cfd-strip-detail-2x-1440.png)

## Known limits

- The CFD chart has no drawing rail, indicators or settings dialog (it is a separate, simpler chart); only its strip, title and price scale were aligned.
- Spot's market list (262px) and 250px book keep their widths; the Figma 19:103 286px book is a Futures measurement, not a Spot one.
- The «•••» phone-only key visible on desktop Spot is handled by Draft PR #513 and not duplicated here.
