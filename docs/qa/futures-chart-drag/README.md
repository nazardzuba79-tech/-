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

## The one failure found in code

A saved drawing with a filled body (a rectangle, a ruler's box) that is
**locked** — its own lock, or «Заблокировать рисунки» — swallowed the press:
`ChartDrawingLayer`'s `startMove` stopped and prevented the pointerdown before
checking the lock, the browser then skipped the compatibility `mousedown`, and
Lightweight Charts (which listens to mouse events only) never saw the gesture.
Nothing moved. An unlocked body moves the drawing, as on TradingView.

Fix: a frozen drawing keeps its outline and labels as hit targets (a click still
selects it, so its toolbar can unlock it) and gives up its body to the chart
(`hitGeometry` in `lib/drawingGeometry.ts`).

## `scripts/qa-futures-chart-drag.cjs`

| Run | Bundle | Result |
| --- | --- | --- |
| `before-main` | `main` `f81df788` | 14/16 — the two locked-drawing checks fail (0 bars moved, `polygon` under the pointer) |
| `pr566-bundle` | PR #566 head `99bc15a6` | 14/16 — same two; the bottom-panel checks pass (handle present) |
| `after-fix` | this branch | 16/16 (bottom-panel handle check skipped: not in this bundle) |

Checks: normal drag right/left, range holds through the candle poll, wheel
zoom; picking mode — drag pans and posts nothing, short click picks a completed
bar, a 2px jittery click still picks, a 14px drag does not; after a timeframe
change; after a reload; after the PR #566 panel resize; a press at the bottom of
the price pane; locked rectangle, ruler under lock-all, unlocked rectangle
(moves instead), a locked drawing is still selectable on its outline.
