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
