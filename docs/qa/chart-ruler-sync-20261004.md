# Chart ruler synchronization — PR #424 integration

2026-10-04. Original Claude head: `8e057c35f019df83e76b9df20c4ac52c10b9126e`. Integration base: `4f4b1c96202233d4f9579802f119d4f7bb96b4dc`.

The owner authorized review and merge of the ruler correction. The only overlapping changed file between #424 and already merged #425 is `docs/AI_HANDOFF.md` (both append at its end). Preserve main's complete handoff and #425 content unchanged; preserve the #424 handoff below in this separate note. All four code/test/QA files retain their exact original Claude blob contents. No financial, backend, data or infrastructure change.

## Original Claude handoff (preserved)

- Owner (NRX/USDT screenshot): the ruler's box sat away from its candles. Root cause: the SVG drawing overlay is projected at React render time, but lightweight-charts also moves its scales on its own paint (price-axis drag, price-axis double click, autoscale), where React never re-renders. The overlay kept the old scale until some unrelated render.
- Fix in `frontend/src/components/PriceChart.tsx`: the overlay records the projection it was painted from (`paintedProjectionRef`, a key of two price coordinates, two bar coordinates and the plot width). A pane primitive with no views of its own (`chart.panes()[0].attachPrimitive`) is called by the chart on every paint that moved a scale, after the price range is recalculated; when the key differs it asks for one overlay repaint. No timers, no polling, nothing on crosshair-only paints. Conditional SL/TP lines use the same projection and benefit too.
- Tests: new case in `priceChartMarketOrders.test.ts` (unmoved paint -> no render; moved scale -> exactly one render, then settled; detached on unmount); fails without the fix. `futuresChartBlank.test.ts` fake chart gained `panes()`. New local browser QA `scripts/qa-chart-ruler-sync.cjs` (fixture candles, reads only) draws a ruler, then checks it against a forced repaint after a 5-second refresh with a new high, an axis drag, an axis double click and a refresh that drops the high.
- Original local results reported by Claude: before (main `2aa7c5fa` build) axis drag drift 95–101 px and axis reset 95–101 px at 1920/1440 (1366: drag 0.7, reset 95); after: 0.0 px in all four cases at 1920/1440/1366, no page errors. Frontend TypeScript and Vite build PASS; full frontend Jest 220 suites / 3808 tests PASS. These are original local results, not new production measurements.
- Branch `claude/peaceful-volta-h5zw7g-chart-ruler-sync` from main `2aa7c5fa`. No backend, data, balance or financial logic touched; Codex work on main preserved. Original review did not merge or deploy.

## Integration verification

Original-head GitHub Actions: 12/12 returned PR workflows successful. Fresh CI on the integration head is required before merge; old green checks do not certify this combined tree. Production publication must be verified separately.
