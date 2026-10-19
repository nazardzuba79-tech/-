# History20 private Spot test mode in SIMUSDT (code only, default off)

> **Status (2026-10-19, 09:05 UTC):** reference branch, not a PR. The CTO named Draft #553 as the single integration line. This branch is the wired implementation, to be reconciled into that line by whichever session is assigned the integration.

The owner approved this on 2026-10-19 (PR #551, 08:07 UTC): «Погоджуєш SIMUSDT для нових History20-симуляцій?» — «так». It approves the settlement design and a code-only implementation. **It is not a production activation**: nothing here was deployed, run against production, or credited to a real account.

The design note is `docs/HISTORY20_PRIVATE_SPOT_SETTLEMENT.md` (PR #551). The refusals-only spike is `docs/SIMUSDT_SETTLEMENT_SPIKE.md` (PR #552). This branch carries both and builds the mode on top of the History20 work in PR #544.

## What a private listing is

A managed listing whose configuration carries:

```json
"privateTest": { "settlement": "SIMUSDT", "funding": { "base": "100", "quote": "1000" } }
```

| Rule | Where |
|---|---|
| Only a History20 growth window (`growth: 'historical-window'`) may be private | `parseListingConfig` → `PRIVATE_TEST_HISTORY20_ONLY` |
| Owner allocation must be 0: the only funding is the test funding | `PRIVATE_TEST_FUNDING_ONLY` |
| Funding ≤ 1 000 000 per asset, not both zero | `PRIVATE_TEST_FUNDING_BOUND` |
| Settlement is the literal `SIMUSDT`; no other field is accepted | zod `strict` |
| Still non-tradable for everyone else (`tradable: false`, `DEMO_ONLY`) | unchanged |
| A replay window (`afterGrowth: 'historical'`) stays refused | `HISTORICAL_RIGHTS_UNVERIFIED`, unchanged |
| The same window **without** `privateTest` stays refused for publication | `HISTORICAL_RIGHTS_UNVERIFIED`, unchanged |
| Private ↔ public, and the funding, cannot change once published | `HISTORY_LOCKED` |
| Publication needs `HISTORY20_PRIVATE_SPOT_ENABLED=true` on the Worker | `PRIVATE_TEST_DISABLED` |
| No listing may take the ticker `SIMUSDT` | `RESERVED_LISTING_SYMBOLS` |

Its pair is `SYMBOL/SIMUSDT` (`listingSimulationConfig`: `quote: 'SIMUSDT'`, `privateTest: true`). Legacy configurations produce a byte-identical simulation input (`quote: 'USDT'`, no `privateTest` key; tested).

## Who may use it

`canUsePrivateTestListing(userId)` (`src/services/listings/privateTestAccess.ts`):
- the Render switch `HISTORY20_PRIVATE_SPOT_ENABLED` is exactly `true` (unset = off), **and**
- `isSimulationOnlyUser(userId)`: the verified owner while `PRIVATE_TRADING_ENABLED=true`, or an ID in `PRIVATE_TRADING_TEST_USER_IDS`.

An `ADMIN` role alone never qualifies. No request field opts an account in.

## Trading: the existing Spot pipeline

There is no new engine or wallet. Everything goes through `OrderService`, `MatchingEngine`, `SpotBookTransaction`, `PriceWatcherService` and the Spot `Balance` rows.

- **Gate** (`assertSpotListing(pair, now, userId)`): a private pair admits `canUsePrivateTestListing` users after `listingAt` and refuses everyone else with the listing's ordinary refusal. This is the one narrow `DEMO_ONLY` exception. `placeOrder` and `placeOcoOrder` pass the caller's ID.
- **Price**: `spotPriceSource` serves the model price, as for every managed listing. Ticker, triggers, OCO validation and the synthetic sale use that same price. The venue is never asked about the pair.
- **Synthetic MARKET SELL** (`sellTeamSpotSimulation`): allowed on a private pair for `canUsePrivateTestListing` users only, re-checked inside the transaction. It credits **SIMUSDT**, with audit action `HISTORY20_PRIVATE_SIMULATION_SOLD`. For a USDT managed listing the #551 stop is unchanged (`Simulation Spot sale is not available for this listing`). NRX and ordinary pairs are unchanged.
- **Other pairs**: a private base on any other pair (`X/USDT`, `X/BTC`, …) and `SIMUSDT` on any pair except a private one are restricted test assets (`isTestAssetPairOrSymbol`). They cannot be ordered, so neither can be converted into a withdrawable asset through the internal book.

## Funding: explicit, bounded, once, audited

`fundPrivateTestAccount(db, publishedListing, userId)` (`src/services/listings/privateTestFunding.ts`) is run only from `scripts/fund-history20-private.cjs`. It is never called by startup, HTTP or publish. Without `--confirm` the script is a dry run.

- The listing comes from the published catalogue and must be private. The account must pass `canUsePrivateTestListing` and must not be blocked.
- It credits the listing's base asset and SIMUSDT in the published amounts. It never touches USDT or any other asset.
- The receipt is the AuditLog row `history20-funding:<listingId>:<userId>`, written under an advisory lock on that key. A repeat or a concurrent call credits nothing.
- A receipt that disagrees with the listing fails closed, and so does unexplained prior base inventory.
- SIMUSDT is shared across an account's private listings. Each listing's funding adds its own bounded amount, so 20 listings × 1 000 000 at most.
- No schema migration. A `Balance` row keyed by `SIMUSDT` is the only new kind of state, and every exit refuses it.

## Never withdrawable, never public: what refuses what

| Path | SIMUSDT | Private base |
|---|---|---|
| Withdrawal, Spot ledger and owner/tester trading-wallet paths | refused | refused |
| Deposit observation, admin balance adjustment | refused | refused |
| Spot ↔ Futures transfer | refused | refused (`isPrivateTestAssetOrPair`) |
| Product purchase | refused | refused (`isPrivateTestAssetOrPair`) |
| OTC cash assets, banking assets | not listed | not listed |
| Spot order on any other pair (conversion) | refused | refused |
| Wallet valuation (`pricesFor`) | unpriced | unpriced (no model price, even with a colliding venue ticker) |
| Card trading volume | skipped: not volume, not an unpriced gap | — |
| Public catalogue, `/published`, pair paths on the Worker | absent | absent |
| Render public `/market/test-assets…`, display ticker/book/trades, `/orderbook`, `/candles` | 404 | 404 |
| Worker `/internal/listings/published` (Bearer; Render's registry) | the listing is present, so Render can trade and fund it | — |

Owner and testers read their markets through `GET /api/v1/private-test/markets` (authenticated). It serves `/candles`, `/ticker` and `/orderbook` per pair (`VHX01-SIMUSDT`) and answers 404 to anyone else, an ADMIN included. It uses the server clock only, so no preview time ever reaches it. Every response carries provenance: `HISTORY20_PRIVATE_TEST`, settlement `SIMUSDT`, `withdrawable: false`, rights `HISTORICAL_RIGHTS_UNVERIFIED`, clock `REAL_TIME`, scenario and source.

## Evidence (disposable PostgreSQL 16 and workerd/Miniflare; synthetic data only)

- `src/services/listings/__tests__/history20PrivateSpot.pg.test.ts` (9 tests):
  - admission matrix: owner, allowlisted tester, another ADMIN, ordinary user, switch off, private trading off, before listing;
  - funding: six concurrent calls credit once, then repeat, other accounts, second listing, switch off, tampered receipt, prior inventory;
  - owner↔tester LIMIT fill, cancel, a double spend of SIMUSDT, two concurrent takers; base and SIMUSDT totals conserved;
  - restart, via a new engine and service over the committed book;
  - STOP direction, OCO cancel with one refund, a TP triggered by the model price and filled in SIMUSDT;
  - synthetic MARKET SELL credits SIMUSDT at the model price; another ADMIN, the switch off and a USDT listing are refused;
  - every cash-out row in the table above;
  - public 404s and private reads, including a preview parameter that is ignored;
  - legacy USDT listing, public History20 window, VTA/NRX/AITH guard results.

  USDT stays 500/0 for all four accounts in every test, and the venue mock is never asked about the private pair.
- `src/services/listings/__tests__/history20PrivateConfig.test.ts` (8 tests): the configuration rules, a 20-window rotation (20 distinct SIMUSDT pairs, all publishable as private), and the public read model, which hides the private listing and keeps the legacy catalogue byte-identical.
- `workers/market-edge/private-test.integration.test.mjs` (4 tests): publish refused while the Worker switch is off; publishes when on; absent from the catalogue and pair paths and present only behind the Bearer; the mode is fixed once published and survives a restart.
- **RED → GREEN.** Each new refusal was disabled on its own and the suite failed:
  - other-pair conversion;
  - valuation;
  - card volume;
  - public candles;
  - public book;
  - transfer;
  - purchase;
  - synthetic-sale admission;
  - gate admission;
  - private read access;
  - funding admission;
  - public catalogue filter;
  - Worker switch.

  The Worker's two catalogue filters (DO and `listingPublic`) are defence in depth: the suite fails only when both are removed.

## Not done: remaining blockers

0. **Cold registry: fail-open (blocks activation).** The private base is recognised only through Render's registry snapshot (`managedListingAssets()`). With a cold or stale snapshot, a local probe on disposable PG showed:
   - `isTestAssetPairOrSymbol(X)` false;
   - an owner's `X/USDT` LIMIT SELL accepted and filled against an ordinary user's USDT bid;
   - `X` transferred to Futures.

   #553's `isSimulationSettled` has the same dependency. The fix must not need the registry. Proposed: a reserved ticker namespace for private History20 listings, refused for every other listing and matched syntactically on any side of any pair. The alternative is a DB-backed set built from funding receipts. Either way, add a test with an empty registry.
1. **Frontend.** No Admin → Listings control yet sets `privateTest` or shows funding. The terminal does not yet list `/private-test/markets`, and it still builds `${symbol}/USDT` for managed listings (`AdminListingsPage.tsx`, `nrxMarket.ts`). Until then the mode is usable through the API only.
2. **Activation** needs, each with the owner's separate approval:
   - deploy;
   - `HISTORY20_PRIVATE_SPOT_ENABLED=true` on Render **and** the Worker;
   - publish of each private listing;
   - one `fund-history20-private.cjs --confirm` per account.
3. **Rights.** `HISTORICAL_RIGHTS_UNVERIFIED` still blocks every public or commercial use of History20 data.
