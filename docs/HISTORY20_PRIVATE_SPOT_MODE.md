# History20 private Spot test mode in SIMUSDT (code only, default off)

The owner approved SIMUSDT for the new History20 simulations on PR #551, 2026-10-19 08:07 UTC (`«Погоджуєш SIMUSDT для нових History20-симуляцій?» — «так»`). This is approval of the settlement design and of a code-only implementation. **It is not a production activation.** Nothing here was deployed, run against production, or credited to a real account.

Integration line: PR #553 (branch `claude/voltex-mobile-audit-7rpjni`). The design and the spike evidence are in `docs/HISTORY20_PRIVATE_SPOT_SETTLEMENT.md`. The wiring was adapted from the reference branch `538926e2`; nothing was merged from it. It uses #553's canonical names.

## What a private test is

A managed History20 growth window with:
- a reserved ticker `VHX01`–`VHX99`;
- `privateTest: { settlement: 'SIMUSDT', funding: { base, quote } }`.

It trades as `VHXnn/SIMUSDT` on the **existing** Spot accounts, orders, matching engine, triggers and model price source. There is no new engine or wallet, and nothing touches Futures, NativeDemo or Stocks.

| Rule | Where |
|---|---|
| A History20 window only | `parseListingConfig` / `checkPrivateTestable`: `PRIVATE_TEST_WINDOW_ONLY` |
| A reserved ticker only (`VHX01`–`VHX99`) | `PRIVATE_TEST_SYMBOL` |
| Owner allocation 0; funding ≤ 1 000 000 per asset, not both zero | `PRIVATE_TEST_FUNDING_ONLY`, `PRIVATE_TEST_FUNDING_BOUND` |
| Settlement is the literal `SIMUSDT` | zod `strict` |
| Still `tradable: false` for everyone else | `DEMO_ONLY`, unchanged |
| A replay window (`afterGrowth: 'historical'`) has no private exception | `HISTORICAL_RIGHTS_UNVERIFIED` |
| The same window without `privateTest` is never published | `HISTORICAL_RIGHTS_UNVERIFIED`, unchanged |
| A reserved ticker or `SIMUSDT` is never published as an ordinary listing | `RESERVED_TICKER` (at publish; drafts may carry such names) |
| Private ↔ public, and the funding, never change once started | `HISTORY_LOCKED` |
| Starting needs `HISTORY20_PRIVATE_TEST=enabled` on the Worker | `PRIVATE_TEST_DISABLED` |

## Who may use it

`privateTest.privateTestAdmitted(db, userId)` requires both:
- `HISTORY20_PRIVATE_TEST` is exactly `enabled` on Render (unset means off);
- `isPrivateTestParticipant`, checked against the database: the verified owner (`PRIVATE_TRADING_OWNER_ID` while `PRIVATE_TRADING_ENABLED=true`, an `ADMIN`) or an `PRIVATE_TRADING_TEST_USER_IDS` tester, and not blocked.

An `ADMIN` role alone never qualifies, and no request field opts an account in. The check runs before the gate and again inside every financial transaction: placing an order, OCO, the synthetic sale and funding.

## Cash-out safety, independent of the registry (CTO P0)

The guard (`testAssetConfig.isSimulationSettled`) recognises `SIMUSDT` and the reserved tickers from the raw value alone. It needs no registry, cache, listing store, database or network, and it matches them bare or on either side of any pair, in every spelling. So a private asset is restricted everywhere even when Render's registry is cold, stale, empty or unreachable:
- every order on any other pair is refused, and so is a forged registry entry that lists a reserved ticker as a tradable USDT listing;
- withdrawal (both paths), deposit, adjustment, demo top-up, Spot↔Futures transfer, purchase and banking all refuse it;
- OTC does not list it;
- `pricesFor` never values it in USD, even when a venue quotes a colliding ticker;
- a private pair the registry does not know has no price at all; the venue is never asked;
- public Render routes answer 404 for private pairs, known or not: `/market/test-assets…`, display ticker, book and trades, `/candles` and `/orderbook`.

The reported exploit is preserved as a test, `history20ColdRegistryCashout.pg`. It sets an empty registry and places `VHX07/USDT` LIMIT SELL into an ordinary user's USDT bid; that sale earned 50 real USDT before the fix. It now proves:
- zero USDT or BTC credited;
- no Futures transfer;
- every spelling and side refused, under empty, stale and loaded registries and after a restart.

| Code | P0 test result |
|---|---|
| `fa6b2cb9` | RED, 4/5 |
| `c7561624` | RED, 3/5: venue-priced valuation, venue price fallback, publish reservation |
| `78f7ad6c` and later | GREEN |

## Trading, funding, reads

- **Spot gate** (`assertSpotListing(pair, now, privateAdmitted)`): a `privateTest` market quoted exactly in SIMUSDT is the one narrow `DEMO_ONLY` exception, and only for admitted callers.
- **Synthetic MARKET SELL:** on a private market it credits **SIMUSDT** only, at the model price, and is audited as `HISTORY20_PRIVATE_SIMULATION_SOLD`. USDT managed listings keep the #551 stop. NRX and ordinary pairs are unchanged.
- **Funding:** `privateTestFunding.fundPrivateTestAccount` via `scripts/fund-history20-private.cjs`, a dry run unless `--confirm` is given.
  - It runs once per (listing, account), under an advisory lock, with the AuditLog receipt `history20-funding:<listingId>:<userId>`.
  - It credits the reserved base and SIMUSDT, never USDT.
  - It fails closed on a conflicting receipt or unexplained inventory.
  - There is no migration.
- **Private channel:** the Worker DO serves private tests to Render's Bearer registry only (`/internal/listings/published`). The public catalogue and pair paths never see them.
- **Reads:** `GET /api/v1/private-test/markets[/:pair/{candles,ticker,orderbook}]`.
  - Admitted participants only; anyone else gets 404.
  - Server clock only; no preview time is accepted.
  - Every response carries provenance: `HISTORY20_PRIVATE_TEST`, `SIMUSDT`, `withdrawable:false`, `HISTORICAL_RIGHTS_UNVERIFIED`, `REAL_TIME`, scenario and source.
- **Card volume** skips SIMUSDT fills.

## Terminal and admin (existing UI, no new design)

**Terminal.** `VHXnn/SIMUSDT` is recognised by its shape and never routed to the edge or a venue.
- Only a private pair's own terminal asks. It is opened from Admin → Listings → «Открыть рынок» or by a link to `/trade?pair=VHXnn/SIMUSDT`.
  - It reads `/private-test/markets` with the session token.
  - Every other page and list sends nothing. The Spot pair list shows only what this session's terminal already found.
  - So an ordinary user never makes the request, and no console 404 appears on any public page.
- A non-participant who opens such a link gets 404. That means "nothing": never an error banner, never a venue chart.
  - The store then stays quiet until the session changes, so it asks once per session.
  - Its reads never fail the page's wake barrier.
- The chart, book and ticker of a private pair come from the private API. An empty book shows as unavailable.
- The status line shows the provenance label.
- A session change forgets every private market.

**Admin → Listings.** On a History20 window, a "Приватный тест (SIMUSDT)" control:
- sets the reserved ticker and zero owner allocation;
- takes the one-time funding amounts;
- turns "Опубликовать" into "Запустить приватный тест".

Pairs are shown as `…/SIMUSDT`.

## Evidence (disposable PostgreSQL 16 and workerd/Miniflare; synthetic data only)

- `history20ColdRegistryCashout.pg` (6): the P0 cases above.
- `history20PrivateSpot.pg` (10):
  - admission matrix;
  - funding: concurrent calls credit once, conflict, prior inventory;
  - owner↔tester fill, cancel, double spend, concurrent takers, conserved totals;
  - restart;
  - STOP/OCO/TP on the model price;
  - orders placed before a registry drop;
  - synthetic sale;
  - every cash-out path;
  - public 404s and private reads;
  - legacy.
- `history20SimusdtSettlement.pg` (11, #553's suite): now runs on the real wired gate.
- `history20PrivateConfig` (9): config rules, 20-window rotation, all 20 model paths (Spot price = chart close, no future candle, no venue), the public read model, and legacy simulation input byte-identical.
- `workers/market-edge/private-test.integration.test.mjs` (4): switch off/on, never public, mode locked across a restart.
- `frontend/src/lib/__tests__/privateTestMarkets.test.ts` (6): pair-shape routing, private-only parse, private chart and book reads with no venue call, the real store's token, 404 and session reset, the wake barrier (a non-participant's 404 never holds the page in error; one ask per session), and rendered hooks: an ordinary page never asks, only the private pair's terminal does, and the list then shows what it found.

## Not done: remaining blockers

1. **Activation.** Each step needs the owner's separate approval: deploy; `HISTORY20_PRIVATE_TEST=enabled` on Render **and** the Worker; starting each private test; one `--confirm` funding per account.
2. **Rights.** `HISTORICAL_RIGHTS_UNVERIFIED` still blocks any public or commercial use of History20 data. Private validation should use synthetic or licensed data.
3. **Production check.** The production store's drafts were not checked for a non-window `VHX01`–`VHX99` name: the guard would refuse such a listing everywhere. The public catalogue held only AITH/USDT on 2026-10-19.
4. **Legacy findings, unchanged by the NRX rule.** NRX on `NRX/BTC`, `USDT/NRX`, NRX transfer and NRX purchase. These are an owner decision.
