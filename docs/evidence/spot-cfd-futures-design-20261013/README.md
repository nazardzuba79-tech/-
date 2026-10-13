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
