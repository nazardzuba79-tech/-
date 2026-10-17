# 2 charts → 1 chart → «К дате»: the CI failure on `9a112675` (owner review 5518558556, P1)

**What failed.** The `chart-workspace / browser` job on `9a112675` (run 38566822505, job 115861511535) timed out after `aith.spot.1440.layout.pane-own-source`: `locator('[data-cw-feature="goto"]').click()` — "element is not stable", then "element was detached from the DOM", for 30 s. The same step passed locally.

**Reproduced.** `repro/repro-transition.cjs` drives AITH/USDT Spot at 1440 exactly as the CI script did (`--mode old` is the helper of `9a112675`): layout 2 → layout 1 → «К дате», with every painted frame of the toolbar sampled (`requestAnimationFrame`), its mutations (`MutationObserver`), the ResizeObserver callbacks, a trace and a video. CPU ×1, ×4, ×8, ×16 and a ResizeObserver stressor (the row's padding changes by 1 px every frame).

| bundle | runs | painted key sets on the row after the click on «1» | «К дате» on the row for a frame |
|---|---|---|---|
| original toolbar (`9a112675`) | Spot 1440 ×1 ×2, ×4 + stress ×2 | 4–5: `compare layout goto scale fullscreen more` → `compare scale fullscreen more` → (`layout more`) → `fullscreen more` → `more`, over 0.5–1.6 s | yes, at +130…+372 ms |
| fixed toolbar | Spot 1440 ×1 ×2, ×4 ×2, ×4 + stress ×2, Spot 1366 ×4, Futures 1440 ×4, Futures 1920 ×4 | 1 (the final fold) | no |

`repro/before/` and `repro/after/`: `summary.log`, one `life-*.json` per run (frames, mutations with the row's measured parts, ResizeObserver callbacks, marks), one video each. Futures 1920 had one state before too: every key fits there, nothing folds.

**Cause — in the product, not only in the test.** After a width change the toolbar folded its keys into «Ещё» over several painted passes instead of one, so a trader saw keys appear and vanish, and a click could land on a key being replaced. `repro/toolbar-passes-intermediate.txt` shows the passes of one transition (debug build): the fold used `fixed` = 325 → 407 → 445 → 475 px for the same row, because

1. the timeframe strip is a shrinkable scroll box: while keys share the row it is squeezed, its squeezed box was taken as its width, keys were let through, its own keys pushed them out on the next pass;
2. «Ещё», absent while every key is on the row for measuring, was assumed to be 44 px (it is 55 px);
3. the label/badge reset (the «Раскладка» badge «2» disappears) ran as a passive effect after paint, so the previous fold was painted once more first;
4. the width-change restart from the full strip ran from a ResizeObserver callback, after the fold at the previous density had already been painted.

The restart in 4 also kept the narrow two-chart row busy: in the 2 s after 1 → 2 the original row changed its density 5 times (6 mutations, 2 painted key sets) at an unchanged width of 281 px — each ResizeObserver pass restarted the fold from the full strip and climbed back; after the fix, 1 density change, 1 painted state (`repro/*/life-old-spot-x1-1440-1.json`). No remount: the main chart kept its instance through every transition (`keep.futures.1440.main-chart-never-remounted`, `transition.*.layout-1-complete`).

**Fix.** `ChartWorkspaceToolbar.tsx`: the strip counts at the width of its keys (`naturalWidth`), «Ещё» keeps the width it last had on the row, the relabel reset runs in the same commit (layout effect), a width change from outside restarts from the full strip inside the fold itself (a width change caused by the toolbar's own density change is not a restart, so a row whose width followed its content could not loop), list copies of keys never overwrite the row widths, and nothing is folded from a partial measurement. The settled layout of every width is unchanged (`geometry.*.features-inside`, `*.quick-timeframes`).

**Test helper.** `openFeatureOn` looks the key up on a quiet row (measured, no menu, same keys at the same place over two reads), clicks with a bounded timeout, re-finds the key after a move, reaches folded keys through «Ещё» or the phone sheet, and confirms that the menu or section actually opened — past a 12 s deadline it throws with what it saw. No `force`, no DOM dispatch, no catch-to-pass. `selectLayout`/`waitLayout` wait for the completed layout (grid value, pane count, every pane answered, row quiet).

**Regression.** Section `transition` of `scripts/qa-chart-workspace.cjs` (in CI): Spot AITH 1440 and 1366, Futures BTC 1440, phone Spot AITH 390 — CPU ×4, layout 2 complete, layout 1 complete (main chart kept), the row paints once (no key shown and hidden), «К дате» opens, and answers (AITH: an honest «История за эту дату не загружена», no request for bars before the listing; BTC: the chart moves to the date, the dialog closes). Trace (DOM snapshots) and video per case.

| bundle | `transition` checks | failed |
|---|---|---|
| original toolbar | 28 run, 25 passed | `row-paints-once` on Spot 1440 (4 states), Spot 1366 (7 states, layout ↔ fullscreen swapping), Futures 1440 (3 states) |
| fix | 28 run, 28 passed | — |

`regression/on-original-toolbar/` and `regression/on-fix/`: report, manifest, the Spot 1440 trace, video and screenshot.
