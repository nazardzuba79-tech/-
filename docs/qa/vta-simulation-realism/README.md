# QA — VTA simulation realism (local, not production)

Environment: this branch, local only. Nothing was deployed and no production
endpoint was called.

- **Terminal screenshots** (`terminal-*.jpg`): the production frontend bundle
  (`vite build`, `VITE_MARKET_EDGE_URL=http://127.0.0.1:5181`) served next to
  the real Render router `testMarketsRouter` (VTA) and the real edge code
  `managedListingResponse` / `nrxPublicResponse` (the functions the market-edge
  Worker bundles). Other `/api/v1` reads are read-only fixtures; writes are
  refused. The red «Связь с рынком прервана» banner in some shots comes from the
  fixture answering `/market/live` with 204, not from this change.
  - `terminal-vta-before-5m.jpg`: VTA with no profile = the original generator
    (byte-identical to main 1e6d61db, proven by `simulationRealism.test.ts`).
  - `terminal-vta-after-5m.jpg`: VTA with `IMPULSE_TREND`, same clock.
  - `terminal-new-pair-*.jpg`: new, non-hardcoded managed listings QPB/USDT and
    QCB/USDT. Four listings QCA/QIM/QPB/QCB share one base scenario (seed
    `qa-realism-base-0001`, 0.25 USDT, 2026-09-28 21:00 UTC); their profiles
    come from `withStableProfile(config, null, ordinal 0…3)` — the rotation the
    Durable Object applies at creation.
- **Profile screenshots** (`vta-*.jpg`, `profiles-one-scenario-*.jpg`): a local
  preview page (lightweight-charts, the library the terminal uses) fed by the
  branch's `testMarketCandles` for VTA's base scenario and by a byte-exact copy
  of main's `testMarketSimulation.ts` for «ДО». The table under the grid reads
  the price at hour boundaries from all five: identical.
  1m «ДО» is empty because main did not serve 1m.
- `http-qa.txt`: 53 HTTP checks against the two local servers (VTA via the Render
  router, four managed pairs via the edge code): 1m/5m/15m/1h validity
  (high ≥ max(open, close), low ≤ min(open, close), no gaps, open = previous
  close), 1m → 5m rebuild, ticker max/min/24h, reload identity, identical hour
  open/close across the four profiles and across VTA before/after.

Also checked by hand: a server restart returns identical closed candles; a
fresh browser session and a Node client get the same SHA-256 of the same
candles; Admin → Listings shows «Характер свечей» for a listing with a
profile, «Исходный» for one without, «Назначится при создании» for a new one,
no overflow at 1280 and 390 px.
