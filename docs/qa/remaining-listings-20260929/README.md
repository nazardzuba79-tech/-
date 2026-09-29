# PR #331 supersession review and allocation receipt safeguard

## Source identity and outcome

- Reviewed on 2026-09-29 against release main `c237649ccd93e74c68013c861ab9cbd38af56726`.
- Historical PR: [#331](https://github.com/nazardzuba79-tech/-/pull/331), head `6403981d2a8bc9071d76f8e63d78b99b9f757175`, common base `0fd62abfe8fb1a329367078d4688d8dddadfa634`.
- A fresh GitHub read confirmed the PR is still open, with the same head and a conflicting merge state. Its description still requests review only. This review makes no remote changes.
- The old delta contains 51 files, including 25 runtime source files. `pr331-file-map.json` accounts for every file and records source blob identities.

The Admin Listings factory in #331 has been superseded by the architecture
already present in main: the market-edge listings Durable Object, the shared
configuration and simulation core, the Admin form, dynamic public discovery,
and the ordinary Spot listing gates. The old branch must not be merged as a
whole. Its distinct allocation receipt check revealed one small useful gap;
that safeguard is implemented here in the existing maintenance helper.

Historical evidence remains available at
[the pinned old QA report](https://github.com/nazardzuba79-tech/-/blob/6403981d2a8bc9071d76f8e63d78b99b9f757175/docs/qa/managed-listings/README.md).
It describes the old implementation and is not evidence that this review ran
its former browser, PostgreSQL or workerd tests.

## Runtime capability map

All main paths in this table refer to the pinned release main above, except
the explicitly described receipt follow-up. The machine file includes full
paths and Git blob hashes.

| Historical #331 file | Current implementation and proof |
|---|---|
| `frontend/src/App.tsx` | Same lazy Admin Listings page and `/admin/listings` route. The generic blocking `ManagedListingsGate` is replaced by pair-specific discovery in `TradePage`. |
| `frontend/src/components/ManagedListingsGate.tsx` | `TradePage.tsx` uses `pairResolving` and `useManagedListingDiscovery`; `testMarketStore.ts` coalesces catalogue reads and refreshes on route re-entry. Existing venue pairs do not require a separate factory bootstrap. |
| `frontend/src/components/CryptoIcon.tsx` | `managedListingLogo` supplies published inline logos. An explicitly absent managed logo stays a generic icon, without an unrelated symbol lookup. |
| `frontend/src/components/NrxBookTabs.tsx` | Accepts `pair`, validates returned pair, and reads dynamic tape through the existing edge transport. |
| `frontend/src/components/TestMarketTerminal.tsx` | Dynamic names and countdowns exist; `managedListingTime` adds the chosen display zone. Current chart scale and natural-wick model are retained. |
| `frontend/src/lib/api.ts` | All four external ticker/book/candle/trade methods select `fetchNrxPublic` through `isEdgeMarketPair`, which includes managed identities. |
| `frontend/src/lib/managedListingRegistry.ts` | Replaced by `registerManagedListings`, `isManagedListingPair` and `managedListingLogo` in `testMarkets.ts`. |
| `frontend/src/lib/managedListings.ts` | Replaced by `nrxMarket.ts` public edge transport, `testMarkets.ts` validated identities and the shared `managedListingStore`. No separate frontend origin or duplicate registry is required. |
| `frontend/src/lib/spotPublicMarket.ts` | `isEdgeMarketPair` routes managed candles to the edge before the ordinary venue branch. |
| `frontend/src/lib/testMarketStore.ts` | Shared store supports managed rows, fastest active subscription, concurrent-read coalescing, future-only discovery, empty-catalogue visibility wake and route re-entry. The focused `managedListings.test.ts` names cover each case. |
| `frontend/src/lib/testMarkets.ts` | Parses the current `managed` DTO, excludes VTA/NRX impersonation, registers names/logos/tradability, and supports dynamic test pairs. |
| `frontend/src/pages/TradePage.tsx` | Resolves unknown pairs before subscribing to venue market data, then enables managed chart/book/tape. |
| `frontend/src/pages/admin/AdminLayout.tsx` | Existing localized Listings entry in the Markets group. |
| `frontend/src/pages/admin/AdminListingsPage.tsx` | Existing create/save/preview/confirmation/publish flow, with saved-revision, unsaved-form, pending-logo and late-preview guards. Main supports versioned metadata edits and time-zone entry. |
| `frontend/src/pages/admin/adminListings.css` | Existing scoped responsive Admin Listings styles; no old layout replacement is required. |
| `frontend/src/pages/markets-bolt/TestMarketsStrip.tsx` | Current managed rows, logos, search/favorites and dynamic opening use the working SPA path. The old full document navigation is unnecessary. |
| `src/api/routes/adminListings.ts` | Same ADMIN-authenticated create/save/private-preview/publish capabilities. The store assigns profile and `NATURAL_V1`; request-supplied model fields are stripped. Allocation remains outside HTTP. |
| `src/index.ts` | Mounts the existing listings router/store and starts the bounded registry bootstrap. |
| `src/services/DemoTradingService.ts` | Its existing restricted-asset guard reads dynamic assets via `testAssetConfig.ts` and `managedSnapshot.ts`. The old independent per-order registry lookup is not imported. |
| `src/services/OrderService.ts` | Existing `assertSpotListingReady` runs for ordinary and OCO order entry. Current tradability/time rules and real-order matching are preserved. |
| `src/services/managedListings/schema.ts` | Replaced by `services/listings/listingConfig.ts`: strict shape, reserved tickers, exact decimal input, bounded inline logo, stable seed/profile/wicks, publish-time bounds and history locks. |
| `src/services/managedListings/public.ts` | Replaced by `services/listings/listingPublic.ts` and the shared simulation core. Metadata, server clock, catalogue, candle/book/tape aliases and redaction are present. |
| `src/services/managedListings/store.ts` | Replaced by `services/listings/store.ts`, `registry.ts` and `managedSnapshot.ts`. Existing backend-only bearer transport, redirect refusal, errors and registry cadence remain. |
| `src/services/managedListings/allocation.ts` | Existing `services/listings/ownerAllocation.ts` plus `scripts/allocate-listing-owner.cjs` provide the separately confirmed, audited, exact allocation. This review carries over receipt-content validation only. |
| `workers/managed-listings/src/index.js` | Replaced by `workers/market-edge/src/listingsStore.ts` and `worker.ts`: separate `LISTINGS` namespace/token, SQLite draft CAS, append-only versions, atomic/idempotent publication, private drafts and published public data. |

Current capability evidence is also documented in
[`docs/LISTINGS.md`](../../LISTINGS.md), the
[Admin Listings QA report](../admin-listings/README.md), and the
[completion QA report](../finish-20260929/README.md).

## Deliberate differences preserved

These are not missing features to restore from an older implementation:

- #331 creates an independent Worker, configuration origin, package lock and
  private registry protocol. Main already uses a dedicated listings namespace
  within market-edge, with its own secret and no Deposit storage reuse.
- #331 makes every factory market display-only. Main has an approved per-listing
  `tradable` setting; the simulation book remains display data and standard
  Spot matching still requires real resting orders. VTA restrictions remain.
- #331 freezes the entire published document and the identity on Create.
  Main preserves price history while permitting versioned display metadata,
  trading-switch and allocation-parameter updates, and date changes before
  opening. The stable profile and wick policy cannot be replaced by a request.
- #331 adds a creator-only, default-disabled allocation HTTP endpoint and UI
  button. Main uses a separate operator CLI with a verified ADMIN ID and
  `--confirm`; no endpoint, button, environment switch or automatic credit is
  added by this review.
- #331 fixes its capacity at 50 listings, requires a raster logo, supports only
  UTC entry and uses a different input schema. Main's current validation and
  supported SVG/null logo and time-zone choices are retained. This review does
  not claim a production capacity or load benchmark.
- #331 makes a separate private registry lookup before order entry and fails
  closed on an unavailable lookup. Main retains its existing bounded shared
  published registry and last-good behavior. This review does not alter the
  market, execution or accounting policy.

## The one retained safeguard

Before the change, finding an existing receipt checked only its `userId`, then
returned the *currently requested* asset and quantity with `applied: false`.
For example, an old credit of `9007199254740993.00000001` was reported as
`9007199254740993.00000002` after the allocation parameter changed. The helper
made no second balance write, but its reply incorrectly described the old
credit. Same-owner malformed or unrelated receipt metadata was also accepted.

The existing receipt namespace and database transaction stay unchanged. A
retry now validates action `LISTING_OWNER_ALLOCATION`, listing ID, owner,
asset and the recorded positive plain-decimal quantity. Quantities are
compared with `BigNumber.eq`, so differences smaller than JavaScript Number
precision remain detectable. A mismatch throws `Allocation receipt conflicts
with the published listing; manual review required` before balance or audit
writes. A valid retry reports the recorded quantity.

Every receipt field used is already emitted by current main. A display-only
new version or equivalent decimal formatting remains valid; the receipt's
version and display price are not mistaken for a new allocation identity.
First allocation, advisory locking, refusal of unexplained inventory, verified
ADMIN checks, no USDT movement and rollback on receipt failure are preserved.

## Verification actually run

| Check | Result |
|---|---|
| New replay tests against unchanged main helper | 12 failures, 2 passes: reproduces the missing refusal cases. |
| Same focused unit suite after safeguard | 14/14 pass, including exact decimals beyond Number precision, asset mismatch, malformed/foreign receipts and valid old receipt shape. |
| Backend TypeScript build | Pass. |
| Extended PostgreSQL suite | Compiles; 14 tests skipped locally because no loopback PostgreSQL or embedded PostgreSQL executable is installed. No DB result is claimed. |
| Existing Admin Listings CI | Updated to include the new unit suite; it already runs the extended PG file against a disposable PostgreSQL service. Final-head CI is still required. |
| Browser/workerd/production checks | Not repeated: no UI, Worker, routing, schema or deployment change in this follow-up. |

Reproduction and focused test command:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  src/services/listings/__tests__/ownerAllocation.test.ts \
  src/services/listings/__tests__/ownerAllocation.pg.test.ts
node node_modules/typescript/bin/tsc --pretty false
git diff --check
```

The PG suite is enabled only by `VOLTEX_LISTING_TEST_URL` with host
`127.0.0.1` and database `voltex_listing_test`; it now checks actual emitted
receipt compatibility, exact mismatches, malformed/foreign metadata,
concurrency, no USDT change and rollback of an audit failure. No production
connection, allocation, balance, listing, order or trade was accessed.

## Closure text prepared for the release owner

Use only after integrating and verifying the focused receipt follow-up; this
report itself does not close the PR:

> Superseded by the managed Listings architecture already released through
> #333 and the completion work in #341. Reviewed old head
> `6403981d2a8bc9071d76f8e63d78b99b9f757175` against current release main
> `c237649ccd93e74c68013c861ab9cbd38af56726`: all 51 changed files are mapped
> in `docs/qa/remaining-listings-20260929/pr331-file-map.json`.
>
> The current implementation covers Admin creation, preview, publication,
> dynamic discovery, chart/book/tape, stable simulation configuration and
> separate owner allocation. The old separate Worker, display-only policy,
> immutable-document model and allocation HTTP endpoint are not merged.
> The useful existing-receipt validation safeguard was retained in the
> current CLI-only allocation helper, with exact decimal checks and focused
> regression coverage. No production allocation or financial-data change
> was performed for this review. The original branch and historical evidence
> remain available.
