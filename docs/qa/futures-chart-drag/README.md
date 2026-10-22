# Futures chart: left-button drag — evidence (2026-10-21)

Owner: «коли затискаю ліву кнопку мишки на графіку та рухаю курсор ліворуч або
праворуч, графік не переміщується». Fixture-only evidence; nothing here was run
against production or a real account.

## What was measured

Every run reads the real Lightweight Charts instance behind the terminal
(`__voltexChart` on the chart host): the visible logical range before and after
the gesture, and the element under the pointer. A mouse event is never taken as
proof that the chart moved.

## Reproduction hunt (headless Chromium 1194 / WebKit 2215, `scripts/qa-chart-workspace.cjs --serve` fixture and the isolated native demo)

The drag panned the chart in every one of these, on the `main` bundle
(`f81df788`) and on the PR #566 bundle:

| Scenario | Result |
| --- | --- |
| 1440×900, 1366×768, 1280×720, 1920×1080, 1024×768, 390×844 | pans (≈0.8 × dx / barSpacing with a 10-step gesture — Lightweight Charts starts scrolling from its first pressed move) |
| press at the top, bottom, left edge of the pane; near the price scale | pans (a press on the price scale itself scales the price axis — expected) |
| after the 5 s candle poll (12 s wait) | the range holds |
| backfill at the left edge (40 drags, older bars arrive) | the view stays on the same bars; drag still pans |
| live position with entry/TP/SL lines; picking mode armed; after a short click; 4h; after reload | pans, 0 POST /native/commands |
| after the PR #566 handle resized the panel, keyboard resize, reload with a stored height | pans |
| WebKit engine | pans |
| ruler tool armed | the drag draws a ruler (by design); the tool returns to the cursor |
| a drawing selected, its anchor under the pointer | the anchor moves (by design) |

Production (`voltextech.net`) was looked at anonymously only: the terminal needs
a login, so it was not measured. The production bundle carries the same
Lightweight Charts defaults (`handleScroll.pressedMouseMove: true`); nothing in
`frontend/src` history ever set `handleScroll`.

## What does reproduce the dead drag, in code

1. **A locked drawing with a body under the press** — a rectangle, an ellipse,
   a ruler's box, a position tool's zones or cards; its own lock or
   «Заблокировать рисунки». `ChartDrawingLayer.startMove` prevented and
   stopped the pointerdown before checking the lock; the browser then skipped
   the compatibility `mousedown` and Lightweight Charts (mouse events only)
   never saw the gesture. Nothing moved. (An unlocked body moves the drawing,
   as on TradingView.)
2. **The eraser selected** (cursors group → «Ластик»). The drawing layer took
   the whole plot while the eraser was the tool, so a press anywhere did
   nothing unless a drawing was under it — and the eraser stays selected after
   use, so every later drag was dead too. Nothing is visible on such a chart.

Fixes (PR #569): a frozen drawing keeps its lines as hit targets (a text-only
drawing keeps its card) and gives up its body and cards to the chart
(`hitGeometry` in `lib/drawingGeometry.ts`); the eraser acts on a drawing's
own hit target and leaves the bare plot to the chart.

Whether the owner's own chart had a locked drawing or the eraser selected
could not be checked from here; without either, no scenario below fails on
`main`.

## `scripts/qa-futures-chart-drag.cjs` — every check, `main` vs this branch

Totals: `main` `f81df788` 41/48 (2 skipped); this branch 48/48 (2 skipped); PR #566 bundle `99bc15a6` (earlier script, 16 checks) 14/16.
The two skipped checks need the PR #566 bottom-panel handle, which is not in
this bundle; they run on the joint build (see the integration section below
when present).

| Check | `main` | this branch |
| --- | --- | --- |
| `normal-drag-right-shows-older-bars` | PASS | PASS |
| `normal-drag-left-shows-newer-bars` | PASS | PASS |
| `normal-range-holds-through-candle-poll` | PASS | PASS |
| `normal-wheel-still-zooms` | PASS | PASS |
| `picking-drag-pans-and-posts-nothing` | PASS | PASS |
| `picking-short-click-selects-a-completed-bar` | PASS | PASS |
| `picking-jittery-click-under-threshold-still-selects` | PASS | PASS |
| `picking-drag-past-threshold-does-not-select` | PASS | PASS |
| `picking-older-bars-load-on-the-way-back-and-one-of-them-can-be-picked` | PASS | PASS |
| `after-timeframe-change-drag-pans` | PASS | PASS |
| `after-reload-drag-pans` | PASS | PASS |
| `after-bottom-panel-resize-drag-pans` | SKIP | SKIP |
| `press-at-the-bottom-of-the-price-pane-pans` | PASS | PASS |
| `after-shrink-and-reload-the-panel-holds-and-the-chart-pans` | SKIP | SKIP |
| `locked-rectangle-over-the-plot-does-not-block-panning` | FAIL | PASS |
| `ruler-under-lock-all-does-not-block-panning` | FAIL | PASS |
| `unlocked-rectangle-moves-with-the-drag-as-on-tradingview` | PASS | PASS |
| `locked-drawing-is-still-selectable-on-its-outline` | PASS | PASS |
| `matrix-tool-cursor-drag-pans` | PASS | PASS |
| `matrix-tool-dot-drag-pans` | PASS | PASS |
| `matrix-tool-arrowcursor-drag-pans` | PASS | PASS |
| `matrix-tool-erase-drag-pans` | FAIL | PASS |
| `matrix-tool-erase-removes-a-free-drawing-and-spares-a-locked-one` | PASS | PASS |
| `matrix-drawing-rectangle-free` | PASS | PASS |
| `matrix-drawing-rectangle-locked` | FAIL | PASS |
| `matrix-drawing-ellipse-free` | PASS | PASS |
| `matrix-drawing-ellipse-locked` | FAIL | PASS |
| `matrix-drawing-ruler-free` | PASS | PASS |
| `matrix-drawing-ruler-locked` | FAIL | PASS |
| `matrix-drawing-long-free` | PASS | PASS |
| `matrix-drawing-long-locked` | FAIL | PASS |
| `matrix-drawing-fib-free` | PASS | PASS |
| `matrix-drawing-fib-locked` | PASS | PASS |
| `matrix-drawing-trendline-free` | PASS | PASS |
| `matrix-drawing-trendline-locked` | PASS | PASS |
| `matrix-drawing-horizontal-free` | PASS | PASS |
| `matrix-drawing-horizontal-locked` | PASS | PASS |
| `matrix-drawing-vertical-free` | PASS | PASS |
| `matrix-drawing-vertical-locked` | PASS | PASS |
| `matrix-drawing-text-free` | PASS | PASS |
| `matrix-drawing-text-locked` | PASS | PASS |
| `matrix-settings-logScale-drag-pans` | PASS | PASS |
| `matrix-settings-gridWatermarkNoVolumeNoTimeAxis-drag-pans` | PASS | PASS |
| `matrix-settings-rsiLowerPane-drag-pans` | PASS | PASS |
| `matrix-settings-twoPaneLayout-drag-pans` | PASS | PASS |
| `matrix-settings-compareEth-drag-pans` | PASS | PASS |
| `matrix-settings-railCollapsed-drag-pans` | PASS | PASS |
| `no-trading-write-left-the-page-during-the-whole-run` | PASS | PASS |

### Matrix: cursor tools (this branch; bars shifted by a 220px drag, element under the pointer)

| Tool | shifted | under the pointer |
| --- | --- | --- |
| cursor | 30.09 | canvas |
| dot | 30.09 | canvas |
| arrowcursor | 30.09 | canvas |
| erase | 30.09 | canvas |

### Matrix: drawing kinds, free and locked (this branch)

«on» is a press on the body (area kinds) or on the line itself; «beside» is 24px
off a line. A free body moves the drawing (TradingView); a locked body lets the
chart pan; a locked line only selects, the chart beside it pans.

| Kind | lock | on: under the pointer | on: bars shifted | on: drawing moved | beside: shifted / drawing |
| --- | --- | --- | --- | --- | --- |
| rectangle | free | polygon | 0 | yes | — |
| rectangle | locked | canvas | 27.35 | no | — |
| ellipse | free | polygon | 0 | yes | — |
| ellipse | locked | canvas | 27.35 | no | — |
| ruler | free | polygon | 0 | yes | — |
| ruler | locked | canvas | 27.35 | no | — |
| long | free | polygon | 0 | yes | — |
| long | locked | canvas | 27.35 | no | — |
| fib | free | polyline | 0 | yes | 27.35 / stayed |
| fib | locked | polyline | 0 | no | 27.35 / stayed |
| trendline | free | polyline | 0 | yes | 27.35 / stayed |
| trendline | locked | polyline | 0 | no | 27.35 / stayed |
| horizontal | free | polyline | 0 | yes | 27.35 / stayed |
| horizontal | locked | polyline | 0 | no | 27.35 / stayed |
| vertical | free | polyline | 0 | yes | 27.35 / stayed |
| vertical | locked | polyline | 0 | no | 27.35 / stayed |
| text | free | rect | 0 | yes | 27.35 / stayed |
| text | locked | rect | 0 | no | 27.35 / stayed |

### Matrix: saved chart settings from this browser (this branch)

| Setting | applied | bars shifted |
| --- | --- | --- |
| logScale | panes 2, price scale mode 1, canvases 11 | 30.09 |
| gridWatermarkNoVolumeNoTimeAxis | panes 1, price scale mode 0, canvases 7 | 30.09 |
| rsiLowerPane | panes 3, price scale mode 0, canvases 15 | 30.09 (lower pane 27.35) |
| twoPaneLayout | panes 2, price scale mode 0, canvases 18 | 75 |
| compareEth | panes 1, price scale mode 0, canvases 7 | 29.58 |
| railCollapsed | panes 2, price scale mode 0, canvases 11 | 27.86 |

## Integration: one isolated build with PR #566 and PR #569 (CTO, 2026-10-21)

Local merge `44e92987` = PR #566 head `4ee5faab` + PR #569 head `10017171`
(the only conflict was `docs/AI_HANDOFF.md`, both entries kept). Built with
`VITE_API_URL=/api/v1`; served by the isolated native demo review server
(synthetic candles, a disposable fixture account) and by the panel QA's own
fixture server. Nothing reached production.

- `scripts/qa-futures-chart-drag.cjs --label integration`: 48/48, 0 skipped — the two bottom-panel
  checks ran this time (the handle is in the joint bundle). Report:
  `integration-report.json`, screenshots `integration-*.png`.
- `scripts/qa-futures-panel-resize.cjs --dist <joint bundle>`: 36/36. The
  resize regression on the joint bundle: 1920×1000 End → 552px (chart 300),
  1366×768 → 324px shown (chart 300, stored preference 552),
  reload → 324px, back at 1920×1000 → 552px, a drag on the small
  window → 264px as the new preference. Report
  `integration-panel-resize-report.json`, screenshots `integration-panel-resize-*.png`.

The five integration points the CTO listed, on the joint build:

| Check | Result |
| --- | --- |
| `normal-drag-right-shows-older-bars` | PASS |
| `picking-short-click-selects-a-completed-bar` | PASS |
| `picking-jittery-click-under-threshold-still-selects` | PASS |
| `picking-drag-past-threshold-does-not-select` | PASS |
| `picking-older-bars-load-on-the-way-back-and-one-of-them-can-be-picked` | PASS |
| `after-bottom-panel-resize-drag-pans` | PASS |
| `after-shrink-and-reload-the-panel-holds-and-the-chart-pans` | PASS |
| `no-trading-write-left-the-page-during-the-whole-run` | PASS |

Mouse drag after the panel height changed: `after-bottom-panel-resize-drag-pans`.
Return to historical bars: `normal-drag-right-shows-older-bars` and
`picking-older-bars-load-on-the-way-back-and-one-of-them-can-be-picked`.
Short click vs drag: `picking-short-click-selects-a-completed-bar`,
`picking-jittery-click-under-threshold-still-selects`,
`picking-drag-past-threshold-does-not-select`. No trading command from a plain
pan: `picking-drag-pans-and-posts-nothing` and
`no-trading-write-left-the-page-during-the-whole-run`. The panel after a
shrink and a reload: `after-shrink-and-reload-the-panel-holds-and-the-chart-pans`
and the panel QA's resize section.

## Follow-up (PR #570): hit-target evidence for the pick and the position tool

Run `merged-local` (`merged-local-report.json`, `merged-local-*.png`): the
final script on the `main` tree after PR #566 and PR #569 merged, 48/48 with
nothing skipped. The pick checks now carry the bar chosen, what the DOM put
under it (`canvas`) and every bar skipped with its reason — this run skipped
one bar for «body in the lowest fifth of the pane (the volume area the picker
ignores)»; the position tool was pressed on its own hit `polygon` when free
(moved) and on the chart's `canvas` when locked (panned ≈27 bars).
