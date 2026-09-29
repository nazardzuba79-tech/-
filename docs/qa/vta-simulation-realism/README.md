# QA — VTA simulation realism (local, not production)

Environment: this branch (merged with `main` 2c36ae31), local only. Nothing
was deployed and no production endpoint was called.

VTA applies `IMPULSE_TREND` only from its activation boundary
**2026-10-01 00:00 UTC** (listing + 57h). Everything before it is the original
generator. To show both sides today, the local servers run a shifted market
clock (`2026-10-01 06:00 UTC`); the code has no clock of its own.

- **Terminal screenshots** (`terminal-*.jpg`): the production frontend bundle
  (`vite build`, `VITE_MARKET_EDGE_URL=http://127.0.0.1:5181`) served next to
  the real Render router `testMarketsRouter(clock)` (VTA) and the real edge
  code `managedListingResponse` / `nrxPublicResponse` (the functions the
  market-edge Worker bundles). Other `/api/v1` reads are read-only fixtures;
  writes are refused.
  - `terminal-vta-before-5m.jpg`: VTA without profile = the original generator.
  - `terminal-vta-after-5m.jpg`: VTA as configured. Left of «окт.» identical,
    right of it IMPULSE_TREND; the 24h minimum (before the boundary) is the same.
  - `terminal-new-pair-*.jpg`: new, non-hardcoded managed listings. Four
    listings QCA/QIM/QPB/QCB share one base scenario (seed
    `qa-realism-base-0001`, 0.25 USDT, 2026-09-28 21:00 UTC); their profiles come
    from `withStableProfile(config, null, ordinal 0…3)` — the rotation the
    Durable Object applies at creation — and apply from the listing.
- **Preview screenshots**: a local page (lightweight-charts, the terminal's
  chart library). «ДО» = a byte-exact copy of main's `testMarketSimulation.ts`
  (for 1m, which main did not serve: the branch's legacy path); «ПІСЛЯ» = VTA
  as configured; the four profiles = VTA's base scenario with the profile from
  the listing. The table reads the price on hour boundaries (+56h, +57h =
  boundary, +58h …): identical in every row.
  - `boundary-and-profiles-5m.jpg` (window 2026-09-30 20:00 → 10-01 04:00),
    `boundary-and-profiles-1m.jpg` (23:00 → 01:00), `profiles-one-scenario-1h.jpg`
    (whole history; on the hour boundary all show the same last price and 24h change).
  - `vta-base-original-5m.jpg` / `vta-base-impulse-trend-5m.jpg`: the same
    7-hour window of VTA's base scenario, original vs IMPULSE_TREND.
- `http-qa.txt`: 58 HTTP checks: 1m/5m/15m/1h validity (high ≥ max(open, close),
  low ≤ min(open, close), no gaps, open = previous close), 1m → 5m rebuild,
  ticker max/min/24h, reload identity, identical hour open/close across the four
  profiles and VTA before/after; every VTA 1m and 5m candle before the boundary
  identical to the original generator, those after it different, seamless join.

Also checked by hand: a server restart returns identical closed candles; a
fresh browser session and a Node client get the same SHA-256 of the same
candles; Admin → Listings shows «Характер свечей» for a listing with a
profile, «Исходный» for one without, «Назначится при создании» for a new one,
no overflow at 1280 and 390 px.
