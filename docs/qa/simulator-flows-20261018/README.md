# Simulated listings: flow review on main `f81df788` (2026-10-18)

This is Phase 2 of the owner work order on PR #544, and covers:

- NRX and AITH scheduling;
- admin scenario management;
- candle precision;
- observed versus modeled feeds;
- pause, stop and delete;
- status;
- accidental live trading.

**Method.** Every finding below is a source repro on exact main `f81df788`, cross-checked by reading the code path. Nothing touched production, accounts or a database.

**Fixed in this Draft PR:**

- the display precision of low-priced test-market prices (§7).

**Left for the owner:** everything that changes settlement, the trading engine or the approved customer layout. The owner's order says «do not alter production account settlement». Each of those items carries a proposal instead.

## 1. NRX and AITH scheduling: no defect found

**NRX** is a code constant in `src/services/testMarkets/neurix.ts`.

- It lists at 2026-10-03 13:00 UTC.
- Its scenario is `range-selloff-range` v5, from 2026-10-06 17:00 UTC.
- The two-week scenario is deliberately detached.

**The NRX fingerprint:**

- It is `63610d3e181b31f67934f94436a2072a03ed13d4727060e83d80655a03a25961` on main, equal to the pinned value.
- PR #544 (History20 v2) leaves it unchanged: the scenario-controls modules are projected out for legacy modes.
- `scripts/check-nrx-scenario-release.cjs` prints «RELEASE BLOCKED» locally only because `NRX_ACTIVE_SCHEDULE_SHA256` is unset. On deploy it must equal the installed hash. This is by design.

**AITH** is a managed listing in the Worker Durable Object, not a code constant.

- It is `capped-growth-range` v1 at 2.00 USDT.
- Its listing time is in the past and is locked (`listingConfig.ts:240`).
- Only NRX has a release-fingerprint gate; AITH has none.

No time-zone defect was found.

## 2. Admin scenario management and status

**Status** is derived, not stored:

- **Draft** (no active version);
- **Published vN**;
- **unpublished changes** (`AdminListingsPage.tsx:61-64`).

**Actions:**

| Surface | Actions |
|---|---|
| Worker | list, published, version, PUT draft, POST publish, POST replace-prelisting (AITH only) |
| Render | the Worker's actions plus `/authority` and `/preview` |
| UI | list, create, save draft, preview, publish |

**Missing:**

- **There is no pause, stop, delete or unpublish anywhere** (Worker, Render, UI). A draft cannot be deleted, and its ticker stays reserved (`listingsStore.ts:252-253`).
- The only levers are to republish with `tradable:false`, which stops new Spot orders but not the chart, valuation or pending triggers (§4), or to postpone `listingAt` before opening.
- `replace-prelisting` and the Worker version history have no UI.

**Proposal for the owner:** an explicit «Приостановить / Снять с публикации» lifecycle. Published history is public and immutable by design, so this is a product decision, not a bug fix.

## 3. NRX admin MARKET SELL against the simulation counterparty (settlement: not changed)

**Path:** `POST /orders` (`orders.ts:51-67`) → `OrderService.ts:85-92` → `sellTeamSpotSimulation`. A role ADMIN or simulation-only user sells at the model price into real Spot USDT inside one Serializable transaction.

**Defect:** there is no idempotency key in the body, the schema or the client. A retried or duplicated request is a second independent sale whenever the balance covers it. `nrxSpot.pg.test.ts:89-107` expects two sales for two calls.

**Bound:** the debit is conditional (`WalletMutation.ts:19-26`), so a duplicate cannot create USDT without burning more NRX.

**Side finding:** for a non-NRX pair the price is the venue ticker (`OrderService.ts:224-226`). An admin can MARKET SELL BTC at the venue price into the real Spot balance.

**Proposal:** an optional `Idempotency-Key` stored with the order (unique), returning the first result on retry. This needs a migration and a settlement review, so it is not done here.

## 4. Model prices trigger real conditional orders (engine: not changed)

`PriceWatcherService.checkAndTrigger` reads `spotPriceSource` (`nrxSpot.ts:43-57`):

- NRX uses its model price.
- Any non-historical managed listing uses its model price **without checking `isTradable`**.
- `triggerOrder` (`OrderService.ts:418+`) does not re-run `assertSpotListing`.

So a listing republished with `tradable:false` still fires already-pending conditional orders, and they fill against real resting orders. For NRX this is intended and tested (`nrxSpot.pg.test.ts:154-166`). For a paused managed listing it contradicts «tradable:false».

**Proposal:** return `null` from `spotPriceSource` for a managed listing that is not tradable, and re-check the listing gate in `triggerOrder`. This is an engine change, so it is left for review.

## 5. A pair unknown to Render passes the Spot gate (engine: not changed)

`assertSpotListing` (`nrxSpot.ts:20-34`) refuses only:

- AITH;
- NRX before listing;
- known managed pairs;
- known test assets.

Every other `X/Y` passes the route regex, and the matching engine creates its book lazily. `registry.ensureFresh` waits at most 1.5 s and keeps an empty snapshot after a cold start or a store failure.

**Effect:** a Worker-only managed pair is briefly an ordinary pair. LIMIT orders lock USDT and rest without a `listingAt` or `isTradable` check. `tradingGates.test.ts:20-21,38` documents «unknown before Render learns it».

**Proposal:** fail closed for a pair that matches a managed-listing symbol shape while the registry has not loaded, or allow-list Spot pairs. This is an engine change.

## 6. Observed versus modeled feeds

**Labelled:**

- The test-market chart banner «Учебный рынок / Practice market» (`TestMarketTerminal.tsx:41,61-63`).
- `TestMarketsStrip`.
- The Markets table and TopGainers exclude test rows.
- The Admin preview says «Это симуляция, а не реальные рыночные данные». For History20 v2 it also says which values are observed and which are modeled (PR #544).

**Mixed, not labelled:**

- **Spot pair list.** It renders VTA, NRX and managed rows among real pairs without a badge (`PairListSidebar.tsx:289-337`). `scripts/qa-nrx-market.cjs` deliberately forbids «simulation/тестов/симуляц» wording on the NRX pages. The presentation is therefore an owner design choice, and no badge was added here.
  - **Proposal:** a small icon carrying `listing.simulation` («Учебный рынок»), an existing key in all seven locales, if the owner wants it.
- **Wallet valuation.** It prices NRX and non-historical managed listings at the model price inside the Spot value (`WalletPortfolioService.ts:166-182`). It has no label. Not changed here: Wallet is in active PR #543.
- **`GET /trades/me`.** It mixes simulation sales (`makerUserId: 'simulation:NRX'`) with real fills, unlabelled (`trades.ts:16-34`).
  - `CardApplicationService.ts:71-77` counts them toward card trading-volume eligibility.
  - `CandleService.ts:39` aggregates them.
  - **Proposal:** a `counterparty: 'SIMULATION'` field and a label, and exclusion from card eligibility. The latter is a business rule for the owner.

## 7. Candle precision: fixed (display only)

**Backend:**

- legacy schedules round to 8 significant figures;
- scenario-controls v2 and windows use 10 decimals, which is the listing price step (`listingConfig.ts:37,85`).

**Frontend:** the test-market chart axis, the strip and the listing card used six fixed decimals below 1. So a managed listing at 1e-7 showed **0.000000**, and 0.00001234 showed 0.000012.

**Fix** (`frontend/src/lib/testMarkets.ts`):

- 10 and above, 1 and above, and down to 0.01 are unchanged (2 / 4 / 6 decimals; every existing expectation is kept).
- Below 0.01 a price keeps at least four significant digits, down to the 1e-10 step. For example 1e-7 shows as 0.0000001000.
- A price change uses the decimals of its reference.
- **Repro test:** `frontend/src/lib/__tests__/testMarkets.test.ts` fails on main (`Expected "0.0000001000", Received "0.000000"`) and passes with the fix.

**Not changed:** the chart's custom-format `minMove` stays 1e-8, because CFD shares that path. Listing prices are ≥ 1e-8.

## Checks run for this PR

- frontend `tsc -b` and `npm run build`;
- the test-market and managed-listing suites under `frontend/src/lib/__tests__`: 76/76;
- the full frontend lib regression: 280/280 suites, 4525/4525 tests, 0 skipped.

Not run: production, a browser session against real accounts, PostgreSQL suites for the unchanged settlement paths.
