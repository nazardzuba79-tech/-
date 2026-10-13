# Spot and CFD desktop: structure inside the tiles (2026-10-13)

Base: fresh `main` `14601fbd` (#514 merged, Spot/CFD already in the Futures top design). Branch `claude/spot-cfd-polish-20261013`. Draft only; no merge, no deploy, no production change. Desktop only (≥901px); phone and tablet layouts unchanged; no trading, order, balance, API or backend change.

Owner request: «Покращи якось спот і CFD, віни виглядають пустими, панелі не розділеними, зроби красиво, і професійно».

## What read as empty and unstructured (measured on main, 1366–1920)

| Where | Spot (main) | CFD (main) |
| --- | --- | --- |
| Rows inside a tile (list title, tabs, sort/column heads, book heads, ticket order-type tabs, account tabs, table head) | no rule under any of them: the 2026-10-07 port zeroed every `border-bottom` to copy the bare Futures rows, so the gold active-tab underline floated in black | same: list columns, order-type tabs, positions tabs, chart title row all without a rule |
| Market list title | «Рынки» row 40px | none: the list started with the search box, no title |
| Ticket fields | inset 12px deeper than the Buy/Sell toggle (252px wide inside a 276px column) | same (252/276); at 1366×768 the fields box was squeezed to 217px and at 1440×900 the «Прим. цена ликвидации» row was cut off |
| Ticket action | under its content | pushed to the tile floor with the void above it |
| Empty states | icon + title + hint (Spot account panel) | plain 12px grey text in the middle of the tile |

Figma 19:103 and Bybit keep the black 4px gutters and no tile borders, and draw the structure inside a tile with 1px `#222227` rules under its header, tab and column rows (HorizontalBorder_9…12 in the Figma ticket, the book and account headers). Futures has them from #508.

## Changes

- `frontend/src/pages/trade-terminal/SpotCfdParity.css` — new desktop block «Structure inside the tiles»: 1px `#222227` inset rules (box-shadows, so no row changes height) under the Spot market-list title, tabs and sort row, the book title and column heads, the ticket order-type tabs, the account tabs and the table head; under the CFD list title and columns, the chart title row, the ticket order-type tabs and the positions tabs. CFD list gets the Spot «Рынки» title row (40px, 14px/500 label with the 2px gold underline). CFD ticket: the fields box keeps its natural height and the action follows it (the void goes under the button, as on Futures); at short heights the box still shrinks and scrolls on its own while the action stays in view (Codex's 2026-10 premium rule, kept). Both tickets drop the extra 12px form padding so the fields sit on the Buy/Sell toggle's edges (276px), as on Futures. CFD empty states take the Spot account panel's icon + 14px title.
- `frontend/src/components/CfdInstrumentList.tsx` — the «Рынки» title row (`markets.title`, existing key) above the search box.
- `frontend/src/components/CfdPositionsPanel.tsx` — the two empty states render the Spot icon tile (lucide `LayoutList` / `History`) and the existing text as the title; `role="status"` kept.

Unchanged on purpose: layout grid, tile sizes, gutters, every control and its handler, order flow, request and market rules, Futures, all phone/tablet sheets, guard scripts and tests.

## Measured after (read-only loopback fixtures, Playwright Chromium)

| | Spot | CFD |
| --- | --- | --- |
| Rules under list title / tabs / sort or column heads | yes / yes / yes | yes / — / yes |
| Rules under book title / book columns | yes / yes | — |
| Rule under chart title row | (toolbar row, from #514) | yes |
| Rules under ticket order-type tabs / account or positions tabs / table head | yes / yes / yes | yes / yes / — |
| Market-list title row | 40px (unchanged) | 40px, new |
| Ticket fields width vs Buy/Sell toggle | 276 / 276px (was 252 / 276) | 276 / 276px (was 252 / 276) |
| CFD ticket at 1440×900 | — | fields 367px natural, summary with all three rows, button at y 638–676 inside the 702px tile, no scroll |
| CFD ticket at 1366×768 | — | fields box 241px and scrolls on its own; button at y 508–546, visible (tile ends at 570) |
| Empty state | icon + title + hint (unchanged) | icon + 14px white title |

## Verification (final tree, commit `99e73fda` sources)

- `tsc -b && vite build` PASS.
- Jest `frontend/src`: 237/237 suites, 4086/4086 tests, 0 failed, 0 skipped.
- `scripts/qa-spot-cfd-terminal.cjs`: 0 findings.
- `scripts/qa-futures-proportions.cjs --phase after --widths 1920,1707,1440,1366,390`: 5 cases, 0 violations.
- `scripts/qa-futures-figma-desktop.cjs`: 4/4 cases, 0 errors.
- `scripts/qa-futures-chart-ux.cjs`: 4 cases, 129 assertions, 0 failed.
- Spot/CFD 1366/1440/1707/1920 × 90/100/110/125 % zoom: 32/32 (pair-row text air ≥ 7px, no horizontal overflow, no page errors).
- Spot toolbar menus functional (catalogue, add indicator, legend, persistence in the Spot store, chart type, settings, rail pill keyboard): 26/26 at 1440 and 1920.
- Futures 1440/1920: geometry, header shadow, rail handle and ticker text identical to main; pixel diffs vs main within main-vs-main render noise (max 1–2 colour levels).
- Phones/tablet: 12 captures (Spot/CFD × 390/768 × chart/trade/account tabs) pixel-identical to main except one 25px antialias difference (max 1 level) on the Spot 768 «24h +» chip; `spot-390`, `spot-430`, `futures-390` identical.

## Files

- `spot-before-after-{1366,1440,1920}.png`, `cfd-before-after-{1366,1440,1920}.png` — main `14601fbd` (top) vs this branch (bottom), 1× captures on the read-only loopback fixture.
- `cfd-ticket-before-after-1366-1440.png` — the CFD ticket column only.
- `detail-2x-1440.png` — 2× crops of the structured rows (Spot market list head, book head, ticket, account tabs + table head; CFD list head, chart title row, ticket, positions tabs + empty state).
