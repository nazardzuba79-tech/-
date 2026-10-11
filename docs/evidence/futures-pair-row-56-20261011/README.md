# Desktop Futures — pair row like Bybit (2026-10-11)

Base: fresh `main` `f57eb710de85cf1153a52fcf62dc2586b75b2249` (includes #508). Branch `claude/futures-pair-row-56-20261011`. Draft only; no merge, no deploy, no production change. Desktop Futures only (`#archive-terminal-preview.futures-terminal`, `min-width: 901px`).

Owner request (2026-10-11, with screenshots of voltextech.net/futures and bybitglobal.com): «В мене ця панель занадто вузька, і текст як би зажат, повинен бути як у байбіт».

## Measured on the owner's screenshots (same capture scale, 1.167 = a 1707px page in a 2000px capture)

| | VOLTEX (main) | Bybit |
| --- | --- | --- |
| Header | 48px | 48px |
| Gutter under the header | 4px | 4px |
| Pair row | **48px** | **56px** (Figma 19:103 «Aside» 55.99) |
| Price | 16px / 600 | 16px / 600 |
| Statistics: label / value | 12px / 12px 500 | 12px / 12px 500 |
| Gap between statistics | 16px | 16px |

The type sizes and horizontal spacing were already Bybit's. The row was 8px lower, so the two lines of every statistic had 8.5px less air in total, and on laptops a wrapped label ran two 12px lines on 12px leading.

## Changes (`frontend/src/pages/trade-terminal/FuturesFigmaDesktop.css`)

- `--futures-ticker-height: 56px` (was 48) and every desktop use of the row reads it: `grid-template-rows: var(--futures-ticker-height) …` (normal and compact account), `.ticker-bar { height/min-height: var(--futures-ticker-height) }`. The content stays centred (the #508 single-row grid).
- `@media (min-width: 901px) and (max-height: 799px)`: `--futures-ticker-height: 52px`. On 1366×768 a 56px row would leave the chart tile 460px, under the 60%-of-screen floor (460.8px) that the #494 chart-priority guard holds; 52px keeps it at 464px.
- Laptop band (901–1599px), where Russian labels wrap: `.ticker-item { grid-template-rows: 28px 14px }` and wrapped labels `line-height: 14px` (was 24px / 12px), so the two label lines no longer touch.

Guards updated to the new agreed height only: `scripts/qa-futures-figma-desktop.cjs` expects 56px (52px under 800px tall) instead of 48px; `scripts/qa-futures-chart-ux.cjs` expects the chart tile 8px lower (4px on 1366×768): 464 / 592 / 592 / 772. The 60% floor, gutters, book 286, ticket 300, chart = book height and all other checks are unchanged.

## Cost

The chart tile loses 8px (4px on screens under 800px tall); book, ticket, bottom panel and the plot's internal layout are unchanged.

| Viewport | Pair row | Chart tile | Plot |
| --- | --- | --- | --- |
| 1366×768 | 48 → 52 | 468 → 464 | 392 → 388 |
| 1440×900 | 48 → 56 | 600 → 592 | 524 → 516 |
| 1707×900 | 48 → 56 | 600 → 592 | 524 → 516 |
| 1920×1080 | 48 → 56 | 780 → 772 | 704 → 696 |

## Evidence

- Bybit / VOLTEX main / this branch at the owner's capture scale: [bybit-vs-voltex-1707.png](bybit-vs-voltex-1707.png)
- Before/after, top 230px: [1366](pair-row-before-after-1366.png) · [1440](pair-row-before-after-1440.png) · [1707](pair-row-before-after-1707.png) · [1920](pair-row-before-after-1920.png); 2x detail at 1440: [pair-row-detail-2x-1440.png](pair-row-detail-2x-1440.png)

## Follow-up on the live page (owner, 2026-10-11): «тут перегородки не має бути, а скрити панель не має бути таким великим … як у байбіт»

- Pair row: the 1×32px divider between the pair and its price (added in #508) is removed (`FuturesFigmaDesktop.css`).
- Drawing-rail collapse handle (`frontend/src/components/TerminalChart.css`, new `@media (min-width: 901px)` block): Bybit's pill measured on the owner's capture — 10×26px, `border-radius: 5px`, `background: #aeb0b5`, chevron `#26292f` (10px, stroke 3), no border, no shadow, no gold edge; centred on the rail edge (`left: 100%; transform: translate(-50%, -50%)`), at the plot's left edge when collapsed (`left: 2px`). Hover `#c9cbd0`. It replaces #504's 22×48 dark tab. A transparent halo (`inset: -8px -14px -8px -2px`) keeps a 26×42px target; Enter/Space, `aria-expanded`, the focus ring, the remembered state and z 51 above the pane separators are unchanged. The phone rail strip (≤900px) keeps its own column.
- Guard `scripts/qa-futures-chart-ux.cjs`: «at least 22×48, white» → «Bybit's pill, 8–14 × 22–30px, #aeb0b5 with a #26292f chevron». The «hit area reaches 12px past its edge», Enter/Space, aria-expanded, plot +50px on collapse and persistence checks are unchanged.
- Evidence: [rail-handle-bybit-vs-voltex.png](rail-handle-bybit-vs-voltex.png).

## Verification (final code `faa74742`, read-only loopback fixture, Playwright Chromium)

| Check | Result |
| --- | --- |
| Pair-row text air, 1366–1920 × 90/100/110/125% | 16/16 cases ≥ 5px above and below (main: 4.5px); 56px rows give 7–8.5px |
| Same in 7 languages (ru, en, zh, es, hi, ja, ko) × 1366/1440/1920 | 21/21 pass |
| Page horizontal overflow | 0 everywhere |
| Spot 1440, CFD 1440, Futures 390, Spot 390, Futures 768 vs main | 0 differing pixels each (a second main capture against the new build; main against main itself differs by 14px of a header animation at 390/768) |
| `tsc -b && vite build` | PASS |
| Jest `frontend/src` | 236/236 suites, 4082/4082 tests |
| `qa-futures-figma-desktop.cjs` | 4/4 (56px row, 52px at 1366×768; chart > 60% of the screen; book 286, ticket 300) |
| `qa-futures-chart-ux.cjs` | 129 assertions, 0 failed (incl. the new pill checks) |
| `qa-futures-proportions.cjs --widths 1920,1707,1440,1366,390` | 0 violations |
| `qa-spot-cfd-terminal.cjs` | PASS |

At 110–125% on 1366/1440 the statistics row still scrolls sideways inside the bar, as on main; values are never truncated.
