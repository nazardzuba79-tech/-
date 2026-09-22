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
