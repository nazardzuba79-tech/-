# VTA terminal background-refresh stability

Base: `c237649ccd93e74c68013c861ab9cbd38af56726`.

## Reproduction and fix

The empty Open Orders view marked itself busy during each 4-second background
read. Premium styling treated that flag as initial loading and inserted an
80px skeleton pseudo-element. At 1440x1000 the chart canvas alternated between
637.0625px and 626px; each brief resize propagated through the terminal.
Initial loading now has its own attribute. Background busy/retry accessibility
and actual initial-loading skeletons remain.

A separate live-VTA render loop came from constructing a fresh ticker object
on every render: OrderForm's ticker-dependent effect set another object as
state. Memoizing against the source asset lets that effect settle, while a
new market snapshot still updates the price.

Prices, candles, linear/Auto scaling, trading/accounting, polling frequency,
and backend/hosting configuration are unchanged.

## Verification

- Browser before/after probe: recurring ~11px canvas height changes every 4s
  became zero after initial layout. React maximum-update-depth warning removed.
- Production bundle, synthetic data, all external traffic and writes blocked:
  VTA at 1440, 2552, 390px; BTC at 1440px. Each case includes two background
  poll cycles and multiple successful candle loads. Zero panel/canvas geometry
  changes, zero page/render-loop errors, zero financial writes.
- Reproducible regression: `node scripts/qa-spot-layout-stability.cjs`.
  Report/screenshots default to ignored `output/spot-layout-stability`.
  Included in Test markets CI.
- Frontend TypeScript and Vite production build passed. Existing >500kB bundle
  warning remains.
- Six focused Jest suites passed (97 tests): ticker identity, order presentation,
  account panel, test markets, chart blank-state guards, terminal design.
- An additional older `spotPairTransition.test.ts` run had 2 pass / 3 fail:
  obsolete exact source assertion for `setBook`, missing mocked
  `terminalPresentation` import, and an obsolete expectation that small
  ordinary prices render zero. The test and all its source/formatting inputs
  are identical to clean base/main. No production change or test weakening was
  made to mask these unrelated failures.

CI and release metadata belong to the PR/Pages deployment for this branch.
