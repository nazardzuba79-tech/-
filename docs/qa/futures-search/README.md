# Futures instrument row and market chooser — browser evidence

Produced by `scripts/qa-futures-market-search.cjs`. Local fixture harness:
fixture market data, reads only, every write 404s. No production account,
database or external call, and no market feed — the fixture serves three
contracts, so the filtering here proves the predicate and the narrowing,
not behaviour at 500 markets.

## Files

| file | what it is |
|---|---|
| `before-*-rest.png`, `before-metrics.json` | `main` at `da1204b`, measured with `QA_GEOMETRY_ONLY=1` — no interaction, no assertions |
| `after-*-rest.png` | this branch at rest: the rail starts at the favourites row |
| `after-*-open.png` | the chooser open under the BTC/USDT selector |
| `after-metrics.json` | every measurement, per width |
| `top-row-before-after-1440.png` | the two side by side |

## What the run asserts

Geometry, at 1920 / 1664 / 1440 / 1366 (and overflow only at 390):

- the instrument row's left edge is the workspace's own content edge;
- the row starts left of the rail, and the rail begins under the row;
- no more than a grid gap between the row's bottom and the rail's top;
- chart, order book and order ticket keep their left, top and width with
  the chooser open;
- no horizontal overflow, at rest or open.

Behaviour:

- both entry points — the list glyph and the pair caret — open the same
  layer, focused, and the time from click to focused field is recorded;
- opening and typing reach no endpoint the untouched page has never
  reached, and add no calls to the two endpoints the market list can
  touch (`/market/assets/icons`, `/market/live`), measured over equal
  windows;
- Escape closes, a click outside closes, the opening control also closes;
- twenty open/close pairs alternating between the two buttons leave it
  closed, and it still opens afterwards;
- picking a contract selects it and dismisses the layer;
- the rail's own sort still works after all of it;
- zero page errors.

## What it deliberately does not assert

Total request volume. In this sandbox it is dominated by the depth REST
fallback polling at 1 Hz, because the venue WebSocket is unreachable from
this network — it drifts by several calls per ten-second window whatever
the page is doing, and the order book is not what search touches.
