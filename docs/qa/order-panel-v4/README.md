# v4 — order ticket: width, surfaces, controls

Captured with `scripts/qa-order-panel-v4.cjs` (screenshots and states) and
`scripts/qa-order-panel-metrics.cjs` (computed geometry and colour). Both
drive the REAL build against `scripts/qa-futures-account-harness.cjs`, a
loopback-only fixture server with no database, no provider egress and no
real funds. `before` is a build of `main`; `after` is this branch. Same
harness, same fixture account, same viewport, same state — so every number
is the change and nothing else.

Every figure in the fixtures is local test data. Nothing was read from or
written to a production ledger, and no order was placed.

## Where the numbers came from

The owner supplied two full-terminal screenshots taken in one browser at one
scale, so the two are comparable to each other even though neither gives a
CSS size. Measuring the marked control rows in those frames:

| measured in the reference pair | reference | ours | ratio |
|---|---|---|---|
| marked select row, total width | 331px | 281px | 1.18 |
| left (margin) select | 171px | 164px | 1.04 |
| right (leverage) select | 145px | 107px | **1.36** |
| submit button width | 152px | 141px | 1.08 |

Those are PNG pixels, not CSS pixels, and they say nothing about the other
exchange's stylesheet. What they do say is the SHAPE of the gap: the column
needs roughly 12% more width, and the leverage control is the one that was
squeezed. Everything below is CSS px measured in a browser on our build.

The colours quoted as "reference" are pixels sampled from those PNGs. They
are a reference for our eyes, not published design tokens of another
exchange.

## The washed-out look, measured

| surface | before | reference sample |
|---|---|---|
| panel fill | `#111922` | `#101014` |
| control fill | `#192632` | `#222227` |
| panel to control contrast | 1.15 | 1.20 |
| control border | `#304050`, plainly visible | none |
| panel relative luminance | 0.0093 | 0.0053 |

Our panel was 75% brighter than the reference's and strongly blue, so every
layer sat inside one narrow band; and because each field also drew a lighter
1px outline, the eye read borders instead of surfaces.

After: panel `#0c1118` (luminance 0.0055), control `#1d2531`, contrast
**1.23**, hairline `#232c39` that is almost the fill. The blue channel stays
+12 over red on both, so this is a darker navy rather than a transplanted
neutral graphite.

## Geometry and colour, before to after

| element | before | after |
|---|---|---|
| order column | 278×779, r 0px, fill rgb(17, 25, 34) | 312×779, r 0px, fill rgb(12, 17, 24) |
| margin (mode) select | 144.66×36, r 3px, fill rgb(25, 38, 50) | 146.14×40, r 8px, fill rgb(29, 37, 49) |
| leverage select | 93.34×36, r 3px, fill rgb(25, 38, 50) | 123.86×40, r 8px, fill rgb(29, 37, 49) |
| price field | 254×40, r 3px, fill rgb(25, 38, 50) | 288×44, r 8px, fill rgb(29, 37, 49) |
| price input | 198×38, r 0px, fill rgba(0, 0, 0, 0) | 232×44, r 0px, fill rgba(0, 0, 0, 0) |
| quantity field | 254×40, r 3px, fill rgb(25, 38, 50) | 288×44, r 8px, fill rgb(29, 37, 49) |
| submit button | 123×40, r 4px, fill rgb(0, 184, 121) | 138×44, r 999px, fill rgb(18, 54, 44) |
| account card | 278×308, r 0px, fill rgb(16, 23, 32) | 312×288, r 0px, fill rgb(12, 17, 24) |
| account row (8-digit balance) | 246×43, r 0px, fill rgba(0, 0, 0, 0) | 280×21, r 0px, fill rgba(0, 0, 0, 0) |
| Депозит / Перевести | 119×34, r 5px, fill rgba(0, 0, 0, 0) | 136×36, r 8px, fill rgba(0, 0, 0, 0) |
| chart surface | 695×553, r 0px, fill rgba(0, 0, 0, 0) | 661×553, r 0px, fill rgba(0, 0, 0, 0) |
| terminal grid | `212px 695px 250px 278px` | `212px 661px 250px 312px` |

The order column takes its 34px from the flexible chart track. The pair list
(212px) and the depth column (250px) keep their exact widths, and horizontal
page overflow is 0 at every viewport.

## The submit pair, enabled and disabled separately

The owner's frame shows dim buttons beside an EMPTY quantity field. That is
the disabled state, not the palette — confirmed on the real build, where the
pair enables the moment a price and a quantity are present and the info rows
fill in with derived figures. Nothing was disabled or bypassed to get a
brighter frame.

| state | before | after |
|---|---|---|
| buy, disabled | `Купить / Лонг` 123×40, r 4px, fill rgb(0, 184, 121), label rgb(255, 255, 255), opacity 0.45 | `Открыть Лонг` 138×44, r 999px, fill rgb(18, 54, 44), label rgb(169, 195, 186), opacity 1 |
| buy, enabled | `Купить / Лонг` 123×40, r 4px, fill rgb(0, 184, 121), label rgb(255, 255, 255), opacity 1 | `Открыть Лонг` 138×44, r 999px, fill rgb(0, 184, 121), label rgb(255, 255, 255), opacity 1 |

The enabled fills are unchanged: `#00b879` and `#f33451`, which already sit
within a couple of points of the reference's own sampled fills. What changed
is the shape, and the disabled treatment: blanket `opacity:.45` took the
label down with the fill, so a trader could not read the control they were
being refused. Disabled is now its own fill and its own label colour, at
full opacity, still obviously inactive.

## Account rows at the wider column

### before

| viewport | label | value | label→value gap |
|---|---|---|---|
| 1440x900 | Маржинальный баланс | `56 405 024.03 USDT` | wrapped |
| 1440x900 | Доступная маржа | `56 381 922.68 USDT` | 24 |
| 1440x900 | Нереализ. PnL | `+508.92 USDT` | 79 |
| 1440x900 | Используемая НМ | `0.04%` | 87 |
| 1440x900 | Используемая ПМ | `<0.01%` | 87 |
| 1366x768 | Маржинальный баланс | `56 405 024.03 USDT` | wrapped |
| 1366x768 | Доступная маржа | `56 381 922.68 USDT` | 24 |
| 1366x768 | Нереализ. PnL | `+508.92 USDT` | 79 |
| 1366x768 | Используемая НМ | `0.04%` | 87 |
| 1366x768 | Используемая ПМ | `<0.01%` | 87 |
| 390x844 | Маржинальный баланс | `56 405 024.03 USDT` | 104 |
| 390x844 | Доступная маржа | `56 381 922.68 USDT` | 134 |
| 390x844 | Нереализ. PnL | `+508.92 USDT` | 189 |
| 390x844 | Используемая НМ | `0.04%` | 197 |
| 390x844 | Используемая ПМ | `<0.01%` | 197 |

### after

| viewport | label | value | label→value gap |
|---|---|---|---|
| 1440x900 | Баланс маржи | `56 405 024.03 USDT` | 77 |
| 1440x900 | Доступная маржа | `56 381 922.68 USDT` | 58 |
| 1440x900 | Нереализ. PnL | `+508.92 USDT` | 113 |
| 1440x900 | Используемая НМ | `0.04%` | 121 |
| 1440x900 | Используемая ПМ | `<0.01%` | 121 |
| 1366x768 | Баланс маржи | `56 405 024.03 USDT` | 77 |
| 1366x768 | Доступная маржа | `56 381 922.68 USDT` | 58 |
| 1366x768 | Нереализ. PnL | `+508.92 USDT` | 113 |
| 1366x768 | Используемая НМ | `0.04%` | 121 |
| 1366x768 | Используемая ПМ | `<0.01%` | 121 |
| 390x844 | Баланс маржи | `56 405 024.03 USDT` | 153 |
| 390x844 | Доступная маржа | `56 381 922.68 USDT` | 134 |
| 390x844 | Нереализ. PnL | `+508.92 USDT` | 189 |
| 390x844 | Используемая НМ | `0.04%` | 197 |
| 390x844 | Используемая ПМ | `<0.01%` | 197 |

`gap` is the measured distance between the end of the label and the start of
the value; `wrapped` means the whole value sat on its own line. The previous
round left one residual difference: an eight-digit balance beside the long
label `Маржинальный баланс` did not fit on one line in a 278px column. The
wider column plus the shorter `Баланс маржи` closes it — every row is a
single line at all three viewports now.

## States exercised

Empty ticket (pair disabled), filled ticket (pair enabled), and reduce-only,
at 1440×900, 1366×768 and 390×844. In reduce-only the labels become
`Закрыть Шорт` and `Закрыть Лонг`: a reduce-only BUY closes a short, so the
pair is deliberately crossed. Only the wording changes — side, the
reduce-only flag and the submitted command are untouched.

## Files

Per capture: `<viewport>-<state>-terminal.png` (whole terminal),
`-column.png` (the order column), `-ticket.png` (the form), `-account.png`
(the account card), plus `report.json`. `metrics-before.json` and
`metrics-after.json` hold the computed geometry and colour.
