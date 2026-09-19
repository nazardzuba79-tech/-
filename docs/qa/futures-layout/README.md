# Futures terminal layout — four-viewport evidence

Produced by `scripts/qa-futures-layout.cjs` against the built app in Chromium
at 1920×1080, 1664×900, 1440×900 and 1366×768. `report.json` carries the
measurements; the PNGs are what the harness saw at the moment it measured.

`report.json` → `"status": "PASS"`, `"findings": []`.

## What each shot shows

| suffix | what it captures |
|---|---|
| `01-default` | the page as it opens — bottom orders panel visible |
| `02-user-folded` | the same page after the fold control is pressed |
| `03-rail-collapsed` | the drawing rail collapsed, showing where its tab sits |
| `04-chooser` | the pair-search dropdown open |
| `05-sort-7d-gainers` | 7-day sorting, gainers |
| `06-sort-7d-losers` | 7-day sorting, losers |

## 0. No permanent market rail

The 212px column that stood open all day is gone; the chart has the width. The
harness asserts both the absence and the gain, because deleting the markup
while a later sheet still declares the track would leave the chart squeezed
into an empty column — which is exactly what happened on the first attempt,
and why `TerminalAccountPanel.css` (loaded last, and the real owner of the
track map) had to be changed too.

| viewport | chart width | share of window |
|---|---|---|
| 1920×1080 | 1354 px | 71 % |
| 1664×900 | 1098 px | 66 % |
| 1440×900 | 874 px | 61 % |
| 1366×768 | 800 px | 59 % |

## 1. Default layout — panel open, chart not full height

Measured on a cold load, a hard reload and a route leave/return, at each width.
All three states agree at every width, and the fold is still available on demand:

| viewport | panel on load / reload / return | after user folds | chart |
|---|---|---|---|
| 1920×1080 | 270 / 270 / 270 px | 44 px | 688 → 914 px |
| 1664×900 | 225 / 225 / 225 px | 44 px | 553 → 734 px |
| 1440×900 | 225 / 225 / 225 px | 44 px | 553 → 734 px |
| 1366×768 | 208 / 208 / 208 px | 44 px | 438 → 602 px |

The fold is deliberately not persisted, so a reload returns to the open state.

## 2. Collapse tab height

Marked twice by the owner. The first pass moved the **collapsed** tab off the
bottom corner to mid-chart; the second screenshot showed that the **expanded**
state had been left alone and still sat at the very bottom — measured at
**96.1–97.5 %** down the chart — with a mark at roughly four fifths.

Both states now read one `--rail-toggle-top`, so the control cannot move when
you press it. Measured centre, and the drift across a press:

| viewport | expanded | collapsed | drift |
|---|---|---|---|
| 1920×1080 | 82.8 % | 82.8 % | 0.0 |
| 1664×900 | 83.5 % | 83.5 % | 0.0 |
| 1440×900 | 83.5 % | 83.5 % | 0.0 |
| 1366×768 | 84.5 % | 84.5 % | 0.0 |

It is also no longer dim: near-white on a lifted, bordered surface rather than
`--text-secondary` on `--panel-alt`.

## 3. Bottom panel — room for one order

The owner marked about how much further the chart could come down so that one
open order sits clear of the edges. The panel's body, measured:

| viewport | before | after |
|---|---|---|
| 1920×1080 | 230 px | **306 px** |
| 1664×900 | 185 px | **248 px** |
| 1440×900 | 185 px | **248 px** |
| 1366×768 | 168 px | **232 px** |

The harness measures a real table cell's height from the live sheet rather
than assuming one, and requires the body to clear three of them — a row, its
header, and a row of headroom.

## 4. Type

Nav links and the chart's axes were both reported as blurry. The nav is now
14px / weight 550 / `#fff` on the terminal (the terminal has its **own** nav
rule that outranks the base one — raising the base alone left this page at
weight 400, which the harness now asserts against). The chart's axis type goes
11px → 12px and `#c7d2e0` → `#dbe3ee`, set on the terminal only.

## 5. Pair search

`chooser.clipped` is `[]` at every width: the filter row, the heading row, the
list and the search field all sit inside the panel. The filter row measures a
full 34 px rather than being squeezed. Price and percent each share one right
edge, and each heading sits over the column it names — the harness asserts this
rather than eyeballing it, and it is what `findings: []` covers.

### Seven-day sorting

Real `changePercent7d` from the catalogue the page already loads. No value is
synthesised: a market without a 7-day figure sorts last and renders `—`.

    default    BTC, ETH, SOL, XRP, ADA, DOGE
    gainers 7d AVAX, SOL, ATOM, DOT, ADA, BTC
    losers 7d  NEAR, DOGE, XRP, UNI, ETH, LINK

Identical at all four widths, heading `7д %`. The control is shown only in the
330 px chooser; in the 212 px rail it would clip to `▼ 7`, so it is gated.
