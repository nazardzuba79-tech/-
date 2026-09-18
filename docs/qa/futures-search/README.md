# Futures market rail: search as a header control — evidence

Produced by `node scripts/qa-futures-market-search.cjs` against the normal
production build, on loopback fixtures. Reads only; every write 404s. No
production account, database or external call.

## What changed

The permanent full-width search input above the market list is gone. In its
place is a fixed-height row: **«Рынки»** on the left, a **magnifier** on the
right. Pressing the magnifier swaps the title for the field; pressing it
again, or `Escape`, closes it.

There are now **two obvious ways in**, both reaching the same search: the
list glyph beside the pair in the top bar (the reference terminal's
affordance) and the pair's own caret, which this terminal already had.

## The "instant" claim, measured

"No API request" is measured rather than asserted from reading the code. The
page polls its ticker feed and chart on timers whatever the user does, so a
raw count over the search window would charge those polls to the search.
Three windows are compared instead:

1. **idle** — nothing touched, 3s;
2. **control** — the field open and focused, nothing typed, 1.6s;
3. **search** — the click, and then the typing.

An endpoint is charged to search only if neither an idle page nor an
open-and-idle one reached it.

| viewport | ms to usable | endpoints opening added | endpoints typing added | rows all → BTC → ETH | list moved | overflow |
|---|---|---|---|---|---|---|
| 1440 | 36 | none | none | 3 → 1 → 1 | no | 0 |
| 1366 | 21 | none | none | 3 → 1 → 1 | no | 0 |
| 390 | 27 | none | none | 3 → 1 → 1 | no | 0 |

Also asserted at every viewport: the field takes focus on open; the header
keeps its height and the list, chart, order book and ticket keep their exact
geometry; `Escape` closes it; ten rapid open/close pairs leave it closed and
an eleventh press still opens it; picking a filtered row selects that
contract; the sort control reports itself pressed.

## A real defect this run found

On mobile the rail lives inside a `<dialog>`, and `Escape` is that element's
native cancel — backing out of the search field **dismissed the whole market
panel**. The handler now calls `preventDefault()`, so the first `Escape`
closes the field and a second closes the panel, matching the desktop rail.

## Honest limits

- The fixture serves the three core contracts, so `BTC` and `ETH` each
  narrow the list to one row. Filtering is proven; filtering *at scale* is
  not measured here.
- For the same reason **sorting could not be proven to reorder**: with three
  rows and no live prices every sort key is null. What is asserted is that
  the control still responds and reports `aria-pressed`. The sort logic
  itself was not touched — the regression pins that separately.
- No production check.

| file | what it shows |
|---|---|
| `*-closed.png` | the resting state: «Рынки» + magnifier, favourites, `Цена ⇅` / `24ч % ⇅` |
| `*-open.png` | the field in the header's place, nothing below it moved |
| `*-btc.png` | `BTC` typed, list filtered |
| `metrics.json` | every measurement above, per viewport |
