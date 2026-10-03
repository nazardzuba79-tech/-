# Spot listings audit — 2026-10-03 (review only)

Base: `7d9ee6fc6bfe76badaac680313e9728e5abd3550`, freshly fetched `main`.
Branch: `codex/spot-listings-audit`. No merge, deploy, production DB access,
real orders, allocation, cancellation or balance changes. The owner explicitly
removed the separate ledger-transition plan from this task; none is proposed here.

## Proven defects corrected

| Reproduction on the base | Correction | Regression |
|---|---|---|
| Kyiv `2026-10-25T03:30` silently chooses one of two instants; spring gap and February 30 normalize to another time | Require exactly one round-tripping UTC candidate; invalid zones return a form error | `listingTimeSafety.test.ts`, mounted preview test |
| Direct configuration API accepts February 30 / April 31 / 24:00 and `Not/AZone` | Validate calendar round-trip and actual IANA zone server-side, shared by Render and Worker | `listingConfig.test.ts` |
| A successful HTTP response `{accepted:true}` closes the publish dialog and displays an undefined version | Validate response receipt; malformed/foreign receipts have UNKNOWN outcome, keep confirmation and same retry key | Mounted `managedListings.test.ts`; incomplete save retains inputs |
| Listings have no ticker search or publication-state filter | Filter the already loaded saved list, with Russian labels; zero added reads/timers | Mounted search/filter regression |

Initial regression run: **14 failed / 67 passed** before fixes. Missing-filter
regression also failed before implementation. Final focused run: **84 passed**.
No test or financial assertion was disabled to obtain these results.

## Sources and accounting are not interchangeable

| Market | Public price / candles / volume / display book / tape | Execution and accounting | Conditional price / wallet valuation | Persistence |
|---|---|---|---|---|
| NRX | `neurix.ts` + deterministic `simulationFor`, served through market-edge; not real counterparties | Ordinary `OrderService` / `SpotBookTransaction`, `Balance`, `Order`, `Trade`. Real resting orders only | `nrxSpot.spotPriceSource` supplies simulation to validation and `PriceWatcherService`; `WalletPortfolioService.pricesFor` also uses simulation (initial price before launch) | Built-in config; DB holds actual order/account records |
| VTA | Built-in config + deterministic simulation; public Render test-market routes | Ordinary Spot refuses VTA. ADMIN-only `VtaDemoSales` uses `DemoBalance` / `DemoOrder` / `DemoTrade`, explicitly identified synthetic counterparty; demo USDT is shared with native demo trading | Demo sale and demo account valuation use server simulation, not normal Spot triggers | Built-in config and separate demo DB tables |
| Managed | Published config + same deterministic generator, market-edge | When tradable, ordinary Spot ledger and real matching, like NRX. Display depth is not executable | Same simulation override and portfolio valuation as NRX once registry knows the asset | Worker SQLite Durable Object stores draft/CAS revisions/versions; public isolate cache; Render on-demand registry snapshot |

`isTestAsset` is a restriction/metadata flag, **not** a separate ledger.
NRX/managed synthetic prices still influence ordinary-account conditional triggers
and displayed valuation. This behavior is unchanged at the owner's request; the
audit does **not** certify these markets as isolated simulations or real liquidity.
Private ten-scenario laboratory remains browser-session-local, not a server queue
and not an order engine. No second laboratory was introduced.

## Existing protections checked

- Real local workerd/SQLite: ADMIN store auth, browser-Origin refusal, hidden
  drafts, unique ticker, twelve concurrent edits/CAS, idempotent publish, locked
  price/seed/profile, metadata-only versions and restart persistence: 13 tests.
- Admin route/auth, configuration, registry and owner-allocation unit tests;
  Russian copy and private laboratory tests. Create/preview/publish never call
  owner allocation. Allocation remains a separate explicit operation.
- Disposable PostgreSQL: NRX ordinary matching/insufficient funds/prelaunch gate/
  conditional families/OCO cancellation/real counterparty; managed owner credit
  once and rollback; VTA demo-only balance changes and native coexistence.
- Canonical UTC 15m/1h/4h aggregation uses first open, extrema, last close and
  summed base volume from 5m source; no-future and replay tests unchanged.
- Spot `7д %` preservation tests pass, including unavailable `—`; no fabricated
  seven-day baseline or changes to navigation/Futures design/localization.

## Limits and open findings — not an end-to-end release certification

1. **Cold/stale managed registry gate:** `assertSpotListing` only recognizes
   managed pairs present in `managedSnapshot`. `ensureFresh` keeps the last good
   snapshot on failure and returns after a bounded wait. An unknown pair passes
   the listing gate; `/orders` validates pair syntax, not membership. Reproduce
   without any DB: clear `setManagedListingAssets([])`, call
   `assertSpotListing('QAX/USDT', prelaunchTime)` (no rejection), then load a
   future QAX config and call again (rejection). Existing happy-path prelaunch
   tests do not prove safety during unavailable/stale registry propagation.
   This audit does not silently change venue-wide order admission.
2. **Ordinary order retry:** `/orders` has no persisted client idempotency key.
   Publish replay protection must not be confused with trading-order replay
   protection. Lost-response order retries/concurrent user intent are not
   certified exactly-once by this PR.
3. No production inventory/active-order inspection was performed. No claim is
   made about actual production obligations or deployment state.
4. The broad simulation-suite command exceeded the tool timeout and is not a
   PASS. Bounded suites and exact-head CI results must be reported separately.

These remaining findings must stay visible in owner review. No balances, existing
orders, history, pricing path, financial formulas or trading permissions are changed.

## Reproduce isolated verification

Use lockfile installs, local Prisma generation, backend `npm run build`, frontend
`tsc -b`. `node scripts/test-nrx-postgres.cjs --listings-audit` creates a fresh
loopback-only cluster and three independent disposable databases; it never uses
an inherited production DB URL. No production migrations are needed or permitted.

`scripts/qa-admin-listings.cjs` builds/runs the real local Worker and real admin
router with fixture identity records. Build frontend with
`VITE_MARKET_EDGE_URL=http://127.0.0.1:8787`; point `QA_FRONTEND_DIST` at that bundle.
All non-loopback browser requests and Worker outbound calls are denied; API writes
outside the local admin-listing fixture are refused. Screenshots and `report.json`
are emitted under `QA_OUTPUT`, and exact-head CI uploads `admin-listings-qa`.
Required matrix: `/admin/listings` and `/trade`, 1920/1440/1366/390 pixels.

First browser run: 20 checks passed, zero Worker outbound calls, no admin/trade
page errors or horizontal overflow; viewport screenshots saved locally.
Final-head CI, not this earlier run, is the authority for later edits.
