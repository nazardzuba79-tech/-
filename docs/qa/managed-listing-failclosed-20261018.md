# Managed listings: preserved bot triggers, fail-closed unresolved pairs, ledger map (2026-10-18)

This follows the CTO triage on PR #546, as edited by the owner's override of 08:32 UTC. Base: main `f81df788`. Code and tests only: no migration, deploy, balance, order or flag was changed, and production was not touched.

## P0-1: withdrawn by the owner. Bot triggers are preserved, not blocked

The owner withdrew «block PENDING_TRIGGER for a non-tradable managed listing». Model prices must keep triggering bots' STOP, TAKE_PROFIT, OCO and limit tests. `tradable:false` closes new **public** orders only.

**What this PR does about it:**

- The first commit `e7e04f2` had added that block. **It is reverted here.** `spotPriceSource` and `OrderService.triggerOrder` are byte-identical to main, apart from the gate's `venue` argument from P0-2.
- The behaviour is now pinned so it cannot be removed by accident:
  - **Unit test.** A `tradable:false` listing refuses new public orders, yet still returns its model price to the trigger engine.
  - **PostgreSQL test.** A TAKE_PROFIT and an OCO placed on an open listing still trigger on the model price after the listing is closed to the public. The test checks:
    - exactly 2 fills;
    - the OCO stop leg is cancelled;
    - the base asset is conserved;
    - the reserve is consumed exactly once.
- NRX is unchanged.

## Ledger map: read-only, verified in source on main `f81df788`

| Path | Price | Ledger written | Withdrawable afterwards? |
|---|---|---|---|
| NRX and managed-listing Spot orders between users (LIMIT and MARKET) | internal book | `balance` (ordinary Spot) and `trade` (real user ids on both sides) | the base asset no (`WithdrawalService.ts:50,116` refuses test assets); **the USDT received yes** |
| Conditional, TP and OCO triggers on NRX or managed listings (`PriceWatcherService` → `triggerOrder`) | model price (`spotPriceSource`) | same as above: fills against real resting orders | **USDT proceeds yes** |
| Admin or simulation-only MARKET SELL (`OrderService.ts:85-92` → `sellTeamSpotSimulation`) | NRX at model price; other pairs at the venue price | `balance`: base debited and **USDT credited from `simulation:NRX`**, which no user funds | **USDT yes**; no idempotency key (P1-3) |
| Owner allocation of NRX or a managed listing (`nrxAllocation.ts`, `ownerAllocation.ts`) | — | `balance` (base asset only) | no (test asset) |
| Native demo / bot engine (`private-trading/native`) | its own | `DemoBalance` and demo orders and trades | not a withdrawable ledger |
| Futures account (`/futures/orders/me`, `/futures/positions/history`, `/futures/balances`) | venue marks | `FuturesBalance`, `FuturesPosition`, futures orders and funding | its own; untouched by any change here |

**Risk for owner review. Not changed here, and no claim is made about production balances.**

- Model-priced practice markets settle in the **same Spot USDT ledger as deposits and withdrawals**.
- USDT that moves through them, or that the admin simulation sale credits, becomes withdrawable USDT.
- «Simulation» in a name does not isolate a ledger.

**Smallest separation to consider:**

1. Mark proceeds from `simulation:*` counterparties, and from practice-market fills, as non-withdrawable practice USDT, using a separate asset code or balance column. This needs a migration and a financial review.
2. Alternatively, quote practice markets in a practice unit, as History20 already does (`SIMUSDT`), with no deposit or withdrawal path.

Either option needs explicit owner approval and its own tests: duplicate POST, unknown outcome, retry, and already-settled history.

## P0-2: an unresolved pair is never treated as ordinary

**Before.** `assertSpotListingReady` waited at most 1.5 s for the registry. If Render did not yet know the published listings (cold start, failed or slow reads), a Worker-only managed pair passed as an ordinary pair. Its LIMIT orders locked USDT and rested.

**Now.**

- `ManagedListingRegistry.resolved()` is true only when no store is configured, or when a read succeeded within `STALE_MS` = 2 × `REFRESH_MS`.
- While the registry is unresolved, a pair that is none of the following is refused before any lock or row:
  - NRX;
  - a known listing or test asset;
  - a pair the venue prices.
- The refusal is `Операция временно недоступна`. Customers see the existing localized «temporarily unavailable» text, so no new i18n keys were needed.
- Venue pairs such as BTC/USDT are never rejected.
- Once the registry recovers, an unknown pair that is not a managed listing keeps its existing ordinary path.

## Tests

**Unit (`tradingGates.test.ts`, 10/10):**

- the owner-required trigger price for a `tradable:false` listing;
- registry resolution across:
  - unconfigured;
  - cold start;
  - success;
  - a failed read inside `STALE_MS`;
  - stale;
  - upstream timeout;
  - recovery;
- the gate for an unknown pair while unresolved, with the venue unpriced or failing;
- venue pairs, NRX, and tradable or paused known listings;

**Disposable PostgreSQL (`managedListingFailClosed.pg.test.ts`, 4/4; added to `admin-listings.yml`):**

1. **Owner-required behaviour.** A TAKE_PROFIT and an OCO are placed on an open listing. The listing is then closed to new public orders.
   - New orders are refused.
   - The existing orders still trigger on the model price: 2 fills, and the OCO stop leg is cancelled.
   - The base asset is conserved (seller 8 available / 0 locked).
   - The proceeds land in the seller's ordinary Spot `balance` USDT; nothing goes to `DemoBalance`.
2. With the registry unresolved, the service refuses LIMIT, STOP_LIMIT and OCO on a Worker-only pair before any lock or row. A venue pair is accepted.
3. With the registry unresolved, REST `POST /orders` (LIMIT and STOP_MARKET) and `POST /orders/oco` answer 400 with the customer-safe refusal and write nothing.
4. After recovery, the ordinary path is unchanged.

**Mutation check** on the first commit: with its guards removed, 5 tests failed. The P0-2 guard is still covered by the unit and REST tests above.

## P1/P2: plan only (financial changes gated for owner review; no code here)

**P1-3: idempotent admin simulation sale**

- Add an optional `Idempotency-Key` header on `POST /orders` and `/orders/oco`, scoped to (user, key) with a TTL.
- Store a request receipt: a unique `(userId, idempotencyKey)` table or column, plus a hash of the request.
- A retry with the same key and body returns the first result. The same key with a different body is a 409. Two deliberate orders carry two keys.
- This needs a migration and a settlement review. Tests: duplicate POST, a timeout with unknown outcome, a crash between commit and response, and two intentional distinct orders.

**P1-4: simulation fills**

- `/trades/me` returns `counterparty: 'SIMULATION'` for `makerUserId` starting `simulation:`, and the UI labels it.
- `CardApplicationService` excludes those fills from trading volume for new applications only.
- First, a read-only report of already-approved applications that relied on them; no silent revocation.

**P1-5: Wallet**

- A modeled-valuation field separate from the market value, plus honest asset labels.
- Only in coordination with the #543 owner, never in its branch.

**P2: admin pause / stop / unpublish**

- An auditable state on the published version (`ACTIVE | PAUSED | STOPPED`), not a delete. It must keep bot paper triggers running unless the owner chooses otherwise, as with `tradable:false` today.
- Define, per state, what happens to:
  - quotes and charts (frozen or continuing model);
  - resting orders (kept, or cancelled with release);
  - conditional triggers (held, as P0-1 now does);
  - wallet valuation.
- Cover the state transitions, restart behaviour and the 7-language UI.
- Show a test/simulated market as such without redesigning the approved Spot pair list.
