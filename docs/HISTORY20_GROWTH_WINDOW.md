# History20: historical growth window for model listings

This is the owner's pack `VOLTEX_History20_Claude_20261018` (2026-10-18), integrated into **Admin → Listings** as a private preview for bot research.

The model listing is a **simulation, not a market**. It shows the label «Симуляция • обучение ботов • не реальный торговый актив».

## What changed

There is a new, versioned format, `voltex.historical-growth.v1`. Its intraday model is versioned separately by `intrabar` (v2 seeded bridge by default, v1 straight-line baseline). It sits next to the legacy formats:

- `src/shared/listingHistoricalGrowth.ts` is the reference implementation.
- The inert copies are in `listingScenarioControls.ts` (validation) and `simulationScenarioControls.ts` (ticks).
- The browser copy is `frontend/src/pages/admin/historicalGrowthModel.ts`.
- Tests pin all the copies against each other, tick for tick.

The two growth modes are **mutually exclusive**:

- **Programmed stages.** This is the legacy mode. It may still be followed by the PR #518 hourly continuation.
- **Historical growth window.** It replaces the stages, so `stages: []`, `afterGrowth: 'range'` and there is no continuation. Normalised historical growth is never laid over growth that has already been programmed.

The program records each of these explicitly:

- `source_asset`, `source_quote` (USD stays USD, never renamed to USDT), `source_metric`, `data_kind`, `source_timeframe`;
- `clock` (REAL_TIME, 86400 s source step = 86400 s scenario step);
- the source slice SHA-256 and the SHA-256 of the stored values;
- `rights: HISTORICAL_RIGHTS_UNVERIFIED`.

The program stores only `round(ln(P/A)·1e8)` per source day. The source's absolute prices and volume are never stored.

## Mathematics

- A is the first source open, or the first reference price.
- H is the highest high, or highest reference price, over the whole window.
- G is the catalogue target. P0 is the listing's initial price.

```
M = 1 + G/100,   alpha = ln(M) / ln(H/A),   P_model(t) = P0 · exp(alpha · ln(P_source(t)/A))
```

- **Peak.** The allowed global peak is +7248% … +15324%, inclusive. The listing's `maxPrice` is exactly P0·M, cut down to the asset step (1e-10).
  - The peak equals P0·M up to floating point, at most 1e-12 relative. Only that rounding is floored to the cap; a larger excess throws.
  - No trajectory is clipped.
  - Every tick high, and so every candle of every timeframe, is ≤ the cap.
- **Numerical error.** Values are stored at 1e-8 in log space. Against the pack's `normalized_path` the model differs by at most 1.31·10⁻⁸ (relative), across all 20 windows (local test).
- **Refusals.** NaN, Infinity, non-positive prices, H ≤ A, invalid OHLC, gaps, duplicate dates, more than 1500 or fewer than 30 days, a changed checksum and a non-REAL_TIME clock are all refused.

## Time

**REAL_TIME is the default. There is no acceleration.**

- Source day *d* is scenario day *d* (24 h). Changing the chart timeframe never changes elapsed scenario time.
- **After the last source value** the price stops. There is no automatic tail and no loop back to the start.

## Observed and modeled parts

The pack holds **daily** values only. No 5m, 1h or 4h history exists in it.

- **Observed:** the daily values of the source, normalised into model units.
  - Coin Metrics `PriceUSD` gives one reference price per day.
  - Binance Vision gives the daily O/H/L/C.
- **Modeled:** everything inside a day. That covers the 10-second path, every 5m/15m/1h/4h candle, a reference day's wicks, high and low, and all volume.

The admin labels this wherever the window is charted:

- «Наблюдение» marks the observed daily values.
- «МОДЕЛЬ» marks the modeled intraday values.
- The preview header marks 1d candles as observation and every finer candle as the model.

`intrabar` names the model per program. Changing it never changes the stored logs or their checksum.

| `intrabar` | Status | Inside a day |
|---|---|---|
| `SEEDED_BRIDGE_REFERENCE_V2` / `SEEDED_BRIDGE_OHLC_V2` | **default** for new choices | deterministic seeded bridge (below) |
| `LOG_LINEAR_REFERENCE_V1` / `SEEDED_OHLC_PATH_V1` | baseline, still valid | straight lines: log-linear between references; O → extreme (8 h) → extreme (16 h) → C |

The admin chooses the model in «Модель внутри суток». v2 is the default; v1 stays available only for comparison.

### Intraday model v2 (seeded bridge)

The code is in `src/shared/listingHistoricalGrowth.ts`. It is copied verbatim, with the `historicalBridge` prefix, into `simulationScenarioControls.ts`, and tests pin the two equal tick for tick (price, open and volume).

- **Deterministic.** The path is a function of (program, listing seed, day, second).
  - It uses integer hashing only: no `Math.random`, no clock and no stored path.
  - A restart, another timeframe or a split query reproduce it exactly.
  - Another seed changes only the intraday model, never the daily values.
- **Activity clock.** Each day has a quiet base rate plus 3–6 seeded bursts (20 min – 2.5 h).
  - Price moves and modeled volume follow it, giving irregular pauses and clustered activity.
  - Drift between fixed points is linear on this clock.
- **Bridge.** A Brownian bridge built by Lévy midpoint construction, with random access in O(14) per tick.
  - Each piece's noise lives in a coordinate where the allowed band cannot be left.
  - Inside the band it uses a logit coordinate.
  - Toward a source high or low, the distance to that edge is the norm of a 3-D bridge (a Bessel-3 bridge). It is repelled from the edge and touches it only at its vertex, so there is no flat top.
- **OHLC day.**
  - It **opens at the source open** at 00:00.
  - It reaches the **source high and low exactly**, by a tick or by the open or close itself, at seeded tick-aligned times.
  - It **never leaves [low, high]** and **ends on the source close**.
  - So **the simulation's 1d candle is the source bar.** v1 opened on the previous close and differed by up to 0.18 % (LINK).
  - Which extreme comes first, and when, is modeled. The seeded choice is biased by where the day opens and closes, and is not claimed as real.
  - The source's own gap between a close and the next open (≤ 0.92 % in History20) stays at 00:00. It is the one discontinuity of the tick stream.
- **Reference day.**
  - Both daily samples are kept exactly, so the 1d open and close are the source.
  - Intraday wicks stay inside a modeled band: the two samples ± 1.25 σ, where σ = 1.25 × the mean absolute daily move of the current and six previous days (0.4 %–6 %).
  - The band never rises above the global peak, so the cap holds.
  - Its high and low are labelled MODELED.
- **No look-ahead beyond the day.**
  - An OHLC day reads only its own bar.
  - A reference day reads its two samples and earlier moves.
  - A forming day is still a bridge to that day's own source value. That makes it training data, not a market: it does not establish bot profitability.
- **Volume.** Volume is modeled in SIMUSDT: day level × activity × seeded jitter × (1 + move). It is never venue volume.
- **Cost.**
  - About 1.1 µs per tick in plain Node, and about 3 µs inside Jest.
  - The whole 861-day BotLab 01 window is 7.44 million ticks and peaks at exactly 239.449.
  - The server preview stays bounded to ≤ 30 days.
  - Hot loops copy `Math` functions into locals, because a global lookup per call is slow in sandboxed VMs.

### v1 → v2 on the owner's pack (local run, numbers only)

Each row is scenario day 300, P0 = 2.

| Window | 5m turns/day v1 → v2 | 5m body CV | 5m two-sided wicks | 5m volume CV | 1d vs source |
|---|---|---|---|---|---|
| VHX-01-BTC (reference) | 0 → 136 | 0 → 0.80 | 0 → 55 % | 0.02 → 0.76 | open/close exact in both; v2 adds modeled wicks |
| VHX-03-SOL (OHLC) | 2 → 148 | 0.10 → 0.82 | 0 → 65 % | 0.03 → 0.68 | v1 ≤ 8.9e-4, v2 ≤ 7e-13 |
| VHX-07-LINK (OHLC) | 2 → 156 | 0.08 → 0.85 | 0 → 60 % | 0.02 → 1.01 | v1 ≤ 1.8e-3, v2 ≤ 5e-12 |

The charts themselves are derived from the non-commercial sources and stay out of this repository.
- **Weekly files** in the pack are derived from the daily ones and are not used as a second source.
- **No hourly or 4h history exists** in the pack.
- **Compressing a whole cycle** (for example into 120 h) is shown only as an **inactive** proposal and needs separate owner approval.
- **Cost.** Each tick is computed on request in O(1) from the stored row; nothing is generated in advance.
  - The server preview is bounded to ≤ 30 days per request.
  - Without a horizon, it returns at most 30 days of candles.
  - The admin page draws the whole window from its daily model, without the server.

## Data rights: what is NOT in the repository

The sources are licensed **CC BY-NC 4.0** (Coin Metrics) and **CC BY-NC-SA 4.0 plus the Binance Vision Dataset Terms**. The pack itself states that redistribution and commercial use are not cleared.

This repository is public. It therefore holds **only code, tests on synthetic data, and the catalogue metadata**: IDs, periods, targets, alpha, drawdowns, licences and SHA-256 hashes. That metadata is in `frontend/src/pages/admin/historicalGrowthCatalog.ts`.

The trajectories are loaded **on the admin's device** from the owner's ZIP, or from the extracted folder:

- Every file used is checked against the committed SHA-256.
- Every window is rebuilt from its source CSV and must reproduce `normalized_path` (limit 1e-7).
- Only `ln(P/A)` is kept, in IndexedDB `voltex.admin.historical-growth.v1`.

A saved draft carries the selected window's `ln(P/A)` values to the operator's own Durable Object. This is the same as the legacy continuation.

**Publication stays blocked.** `checkPublishable` refuses with `HISTORICAL_RIGHTS_UNVERIFIED`, and the Durable Object enforces it.

## Isolation

`isHistoricalDemoConfig` / `isHistoricalDemoAsset` cover the window. This means:

- no ordinary Spot order;
- no conditional-order trigger;
- no wallet valuation or collateral;
- no deposits, withdrawals or adjustments;
- owner allocation is always 0;
- the listing is never tradable.

`SIMUSDT` is only the preview's accounting unit. It is not added to any currency, deposit or balance.

## Admin

The section is Admin → Listings → «Источник роста». It has:

- **20 cards:** asset and real period, data kind, source date, original growth, model target, alpha, max close drawdown (raw → model), REAL_TIME duration, source, slice hash, licence, rights, and fold.
- **Pack import:** ZIP or folder.
- **Choice and P0:** choose a window; changing P0 sets the cap to exactly P0·M.
- **Previews:** the whole-shape chart (daily or weekly groups of scenario days), and the bounded server preview (first day, or a ≤ 30-day fragment from a chosen day).
- **Draft actions:** save a private draft, clone into a new listing ID, return to the programmed stages, and export the draft as JSON or the daily model as CSV.
- **Rotation:** the deterministic 20-ID cycle. The cursor is the number of other listing IDs that already use a window, so it persists with the listings themselves. Reuse is not independent training data.
- **BotLab 01:** «Черновик BotLab 01» prefills the proposal from `04_NEXT_LISTING_DRAFT.json` (VOLTEX BotLab 01, VHX01, P0 = 2, VHX-01-BTC → cap 239.449).
  - Nothing is saved automatically.
  - The ticker's uniqueness is checked only on save.
  - The start time is left for the admin to choose.

## Bots

`historicalGrowthObservation(program, P0, seed, listingAt, now)` returns only:

- closed days;
- the forming day up to `now` (its high and low so far, never the final ones);
- the current price.

It never returns the peak, the target, alpha, the scenario id or any later value.

`historicalGrowthFold(asset)` assigns train / validation / test **by source asset**, never by candles. A window on another timeframe or seed stays in the same fold.

**There is no offline bot-execution harness in this repository.** None was added, and ordinary Spot was not opened to get "working trades".

The pack is a strong-growth set. It is not evidence that a bot is profitable. Bearish, range and out-of-distribution controls must come separately.

## Checks

- `src/services/listings/__tests__/historicalGrowthWindow.test.ts`: synthetic data.
- `src/services/listings/__tests__/historicalGrowthIntraday.test.ts` (synthetic data) covers v2 against the v1 baseline:
  - inlined = reference, tick for tick;
  - OHLC 1d = the source bar, with H and L reached and never exceeded;
  - reference samples exact, with bounded modeled wicks;
  - no cap breach;
  - no stall or wrap;
  - 1m/5m/1h/1d consistency;
  - restart, seed and timeframe reproducibility;
  - no look-ahead;
  - bot observation;
  - the publication gate;
  - cost.
- `frontend/src/lib/__tests__/historicalGrowthLibrary.test.ts`: synthetic data. Its last test runs only with `HISTORY20_ZIP`.
- `src/api/routes/__tests__/adminListings.test.ts`: window drafts through the router.
- `src/services/listings/__tests__/historicalGrowthPack.local.test.ts`:
  - It always checks that no pack file is in the repository.
  - The pack suite itself is **registered only** with `HISTORY20_PACK_DIR`, so there is no skip in CI. Not running it is NOT_RUN, not PASS.
  - It covers all 20 windows under v2, plus a full tick scan of BotLab 01.
- `scripts/qa-listing-history20.cjs`: production bundle → router → Durable Object on workerd, at 1440 and 390 px.
  - In CI it uses one synthetic window.
  - With `QA_HISTORY20_ZIP` it imports the real pack through the page; keep those screenshots out of the repository.

## Before any public use (owner)

1. A licence that covers the exact intended use. Binance Vision §3.4 requires a separate written licence for commercial use.
2. A unique simulation-only symbol and an explicit start time.
3. An isolated, authorised bot harness, if trades are wanted. Its execution, liquidity, spread, fee and latency must be named models.
4. Bearish, range and out-of-distribution control sets.
5. Optionally, the 120 h compression: only with explicit owner confirmation, as a separate, labelled laboratory mode.
