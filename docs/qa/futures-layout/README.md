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

The owner marked a Bybit-like position, roughly mid-chart, rather than pinned
to the top or bottom edge. Measured as a percentage of the way down the chart:

| viewport | tab centre |
|---|---|
| 1920×1080 | 56.1 % |
| 1664×900 | 57.7 % |
| 1440×900 | 57.7 % |
| 1366×768 | 59.6 % |

## 3. Pair search

`chooser.clipped` is `[]` at every width: the filter row, the heading row, the
list and the search field all sit inside the panel. The filter row measures a
full 34 px rather than being squeezed. Price and percent each share one right
edge, and each heading sits over the column it names — the harness asserts this
rather than eyeballing it, and it is what `findings: []` covers.

## 4. Seven-day sorting

Real `changePercent7d` from the catalogue the page already loads. No value is
synthesised: a market without a 7-day figure sorts last and renders `—`.

    default    BTC, ETH, SOL, XRP, ADA, DOGE
    gainers 7d AVAX, SOL, ATOM, DOT, ADA, BTC
    losers 7d  NEAR, DOGE, XRP, UNI, ETH, LINK

Identical at all four widths, heading `7д %`. The control is shown only in the
330 px chooser; in the 212 px rail it would clip to `▼ 7`, so it is gated.
