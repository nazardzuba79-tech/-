# Positions table — before / after (2026-09-22)

Fixture: the isolated native review server (`NATIVE_PREVIEW_FIXTURE=1`), one
15 000 000 AKE historical LONG at 10x (entry 0.004, mark 0.0538), the real
`/futures` terminal at four widths, positions tab. `before` is main
`a1785161` (after #179); `after` is this branch.

Measured on the built page (panel width vs table width, cells whose text is
wider than its box, cells sharing pixels, text nodes sharing pixels):

| width | before: table / panel | before: headings on two lines | before: unit under the figure | after: table / panel | after: clipped / overlapping | row height |
|---|---|---|---|---|---|---|
| 1920 | 1570 / 1570 | no | no | 1570 / 1570 | 0 / 0 | 67 |
| 1600 | 1350 / 1274 | yes (3) | no | 1494 / 1274, scrolls | 0 / 0 | 67 |
| 1440 | 1131 / 1114 | yes (5) | yes | 1494 / 1114, scrolls | 0 / 0 | 67 |
| 1366 | 1128 / 1040 | yes (5) | yes | 1485 / 1040, scrolls | 0 / 0 | 67 |

`after`: the table is never narrower than its content (`min-width:max-content`),
every cell stays on one line, the contract column is pinned to the left edge
and the panel scrolls the rest sideways. Nothing is hidden and no font is
smaller. The screenshots are taken headless, where Chromium hides scrollbars;
a real browser draws the horizontal scrollbar under the rows.

## v2 — the owner's production row (2026-09-22, second report)

The first fix (#180) kept the table at its full one-line width and scrolled
it; on the owner's screen that still read as «Закрыть ка…» / «Лимитны…»
sliced off at the panel's edge, with no obvious scrollbar. This pass makes
the row FIT where the first one scrolled, and pins the actions where it
still cannot.

Fixture as above, but the row is the owner's: 14 999 900 AKE after a
100-contract close (entry 0.004, realized P&L on the row), page on
BTC/USDT, Inter loaded. `before-v2` is main `78f9dadc` (#180 merged);
`after-v2` is this branch. Column widths are the heading cells' boxes.

| width | before-v2: table / panel | after-v2: table / panel | after-v2: what changed |
|---|---|---|---|
| 1920 | 1570 / 1570 | 1570 / 1570 | headings on one line, as before |
| 1664 | 1494 / 1338, scrolls 156px | **1338 / 1338, fits** | five headings on two lines |
| 1600 | 1494 / 1274, scrolls 220px | **1274 / 1274, fits** | five headings on two lines |
| 1440 | 1494 / 1114, scrolls 380px | 1269 / 1114, scrolls 155px | «Закрыть как» pinned at the right edge with a shadow |
| 1366 | 1485 / 1040, scrolls 445px | 1267 / 1040, scrolls 227px | same |

What did it: cell padding 12 → 8px (11 columns), the close pills sized by
their text instead of a fixed 84px, and the five widest headings («Цена
Входа», «Цена маркировки», «Цена ликвид.», «Нереализованный P&L(ROI)»,
«Реализованный P&L») allowed onto two lines inside the same 40px heading
band — only when the panel cannot hold them on one, because auto layout
never drops a column below its cells (`min-width:0` on the table, every
cell still `nowrap`). Nothing is hidden, no font is smaller, the row is
still 67px and the heading band one height at every width (geometry check
PASS). Where the row is still wider than the panel, «Закрыть как» is
pinned to the right edge like the contract is to the left — both opaque,
the actions cast a shadow onto the figures scrolling under them only while
the panel flags `data-overflow` — and the panel's horizontal scrollbar is
drawn explicitly (10px) rather than left to the platform's overlay.

Screenshots: `before-v2-panel-1600.png`, `before-v2-panel-1440.png`,
`after-v2-panel-{1366,1440,1600,1664,1920}.png` (headless Chromium; the
scrollbar is styled and therefore visible in a real browser).
