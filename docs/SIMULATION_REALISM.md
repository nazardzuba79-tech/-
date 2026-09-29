# Simulation realism (VTA and future simulated listings)

Candles of a simulated market now come from four layers. Only the last two
are new, and neither can move the market:

```
base simulation   hour anchors: regimes, hourly returns, block/day totals   testMarketSimulation.ts (unchanged)
→ profile         CALM_TREND | IMPULSE_TREND | PULLBACK_TREND | COMPRESSION_BREAKOUT   simulationRealism.ts
→ intrabar        how an hour's FIXED return is spread over its 12 × 5m candles,
                  and each candle's 30 ticks with wick excursions              simulationRealism.ts
→ OHLC            candleFromTicks / aggregateCandles (unchanged)               testMarketSimulation.ts
```

An asset without `simulationProfile` takes the original intra-hour path and is
byte-identical to `main` 1e6d61db (NRX today, and any managed listing stored
before profiles existed).

## What a profile can and cannot change

| Invariant under any profile (tested) | Intentionally different where the profile applies |
|---|---|
| `initialPrice`, `seed`, `listingAt`, listing schedule | 5m/1m candle bodies inside an hour |
| Regime of every hour and its return | Wicks: length, side, frequency (capped per profile) |
| Price at every hour boundary → every 1h/4h/1d open and close for an hour-aligned listing | Where inside an hour the move happens (impulse, pullback, compression → breakout) |
| P48 = 5.5234599, P168 = 35171.298 for VTA, every day anchor | Tick tape, display book and last price **between** hour boundaries (so an execution at such an instant prices differently) |
| 24h change measured on an hour boundary | 24h high/low when the window holds profiled hours; 24h change between hour boundaries; volume inside an hour |

Why the anchors cannot move: the twelve 5m steps of an hour sum to the hour's
return and the last boundary is set to the next hour's open by the base
simulation; a wick excursion is zero at the candle's first and last tick, so it
moves high/low but never open/close.

## Activation boundary (`realismFrom`)

A market that is already live must not rewrite what it has shown or sold at.
`realismFrom` (epoch ms, rounded up to the next hour after the listing) makes
every earlier hour take the original path — candles, ticks, tape, book, state
and the executable price — and every later hour the profile. Both paths start
and end each hour on the same anchor, so the join is seamless. It is a fixed
constant in the config, never a wall-clock default.

**VTA:** `realismFrom = 2026-10-01T00:00:00Z` (listing + 57h). Before it,
every VTA value is byte-identical to `main` (tested every 37 s from the
listing, plus tape, book and ticker state), so the chart always agrees with
private sales already recorded. The deploy must happen **before** this instant;
if it slips, move the constant to a later hour before deploying.

New managed listings have no `realismFrom`: their profile applies from the
listing, as they have no history to preserve.

## Profiles

Parameters live in one table, `REALISM_PROFILES` (`simulationRealism.ts`); the
code has no per-profile branches. Main knobs: pattern weights per regime
(`steady` / `burst` / `pullback` / `compression`), `breakoutAfterRange`,
`impulseShare`, `pullbackDepth`/`pullbackLength`, `compressionDuration`/
`compressionNoise`/`breakoutShare`, `bodyNoise`, `rangeNoise`, `bodyVariety`,
`shadowChance`/`shadowSize`, `longWickChance`, `rejectionChance`,
`sweepChance`, `afterImpulseWickChance`, `wickSizeFactor`, `maxWick`,
`localVolatilityFactor`, `tailChance`/`tailFactor`. `realismSeedOffset` on the
asset re-rolls the look without touching the anchors.

- **CALM_TREND** — smooth trend, small/medium candles, short shadows (≤ 6%), rare impulses, short pauses.
- **IMPULSE_TREND** — a few ordinary bars, then an impulse candle; consolidation → breakout; occasional big wicks (≤ 11%). **VTA uses this profile from 2026-10-01 00:00 UTC.**
- **PULLBACK_TREND** — the trend holds through short counter-trend runs, false breakouts, rejections and the longest shadows (≤ 13%).
- **COMPRESSION_BREAKOUT** — narrow ranges with small bodies and wick sweeps, then a strong breakout and a short settle.

## Rotation for new listings

A managed listing gets its profile once, when it is created in Admin → Listings,
from a counter kept in the listings Durable Object (`meta.simulation_profile_ordinal`,
same SQLite transaction as the insert): #1 CALM_TREND, #2 IMPULSE_TREND,
#3 PULLBACK_TREND, #4 COMPRESSION_BREAKOUT, #5 CALM_TREND, … for 20, 50 or 100
listings alike. It is stored in the listing's config (`simulationProfile`),
kept on every later save whatever the request carries (`withStableProfile`;
Render also drops it from requests), locked by `checkPublishable` after
publish, survives a Worker restart, and is not exposed in the public
catalogue. No DO schema or migration change: the profile is part of the JSON
config and the counter uses the existing `meta` table.

## Determinism

Every realism draw comes from `seededRandom(seed, 'realism', offset, 'hour'|'ticks'|'breakout', hour[, slot])`
(`simulationRandom.ts`, the same mulberry32/fnv1a generator as before, moved
without change). No `Math.random`, no clock: pair + seed + profile + offset +
time → the same candles on every reload, instance, restart and client.
`simulationFor` caches per full configuration including the profile.

## 1m candles

`1m` is served from the same ticks (six per minute), so five 1m candles are
exactly their 5m candle. The Spot chart's interval bar still offers 5m…1w
(`PriceChart.tsx` is unchanged); 1m is available on the API/edge.

## Deployment notes (nothing deployed by this change)

- VTA is served by Render. Deploy it before VTA's `realismFrom`
  (2026-10-01 00:00 UTC). A later deploy would redraw the hours between the
  boundary and the deploy, so if it slips, move the constant to a later hour
  first.
- Managed listings and NRX are computed on the market-edge Worker, which
  bundles this code. Order: **Render (and frontend) first, then the Worker**,
  from the same commit.
  - New Render + old Worker: works; new listings simply get no profile
    (original candles) until the Worker is deployed.
  - Old Render + new Worker: once one listing with a profile exists, the old
    Render's strict schema rejects the store's answer
    (`STORE_INVALID_RESPONSE`) for Admin → Listings and the trading registry.
- NRX has no profile and is byte-identical to `main`.
- Recorded VTA sales happened before the boundary, where every price is
  unchanged, so the chart keeps agreeing with them. Stored fills, balances and
  allocations are not touched by this change.
