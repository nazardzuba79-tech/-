# History20: historical growth window for model listings

This is the owner's pack `VOLTEX_History20_Claude_20261018` (2026-10-18), integrated into **Admin → Listings** as a private preview for bot research.

The model listing is a **simulation, not a market**. It shows the label «Симуляция • обучение ботов • не реальный торговый актив».

## What changed

There is a new, versioned format, `voltex.historical-growth.v1`. It sits next to the legacy formats:

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
- **Daily reference** (Coin Metrics `PriceUSD`, not OHLC): the price is interpolated log-linearly between daily samples. This is a model; no wick is invented.
- **Daily OHLCV** (Binance Vision): each day runs open → first extreme (8 h) → second extreme (16 h) → close (24 h).
  - Which extreme comes first is unknown in daily data, so the listing seed decides it. This too is a model.
  - Every day reaches its source H, L and C exactly.
- **After the last source value** the price stops. There is no automatic tail.
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
- `frontend/src/lib/__tests__/historicalGrowthLibrary.test.ts`: synthetic data. Its last test runs only with `HISTORY20_ZIP`.
- `src/api/routes/__tests__/adminListings.test.ts`: window drafts through the router.
- `src/services/listings/__tests__/historicalGrowthPack.local.test.ts`: runs **only** with `HISTORY20_PACK_DIR`, and is skipped in CI.
- `scripts/qa-listing-history20.cjs`: production bundle → router → Durable Object on workerd, at 1440 and 390 px.
  - In CI it uses one synthetic window.
  - With `QA_HISTORY20_ZIP` it imports the real pack through the page; keep those screenshots out of the repository.

## Before any public use (owner)

1. A licence that covers the exact intended use. Binance Vision §3.4 requires a separate written licence for commercial use.
2. A unique simulation-only symbol and an explicit start time.
3. An isolated, authorised bot harness, if trades are wanted. Its execution, liquidity, spread, fee and latency must be named models.
4. Bearish, range and out-of-distribution control sets.
5. Optionally, the 120 h compression: only with explicit owner confirmation, as a separate, labelled laboratory mode.
