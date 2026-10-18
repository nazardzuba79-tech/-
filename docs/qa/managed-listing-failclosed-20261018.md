# Managed listings fail closed: P0 follow-up to PR #546 (2026-10-18)

This follows the CTO triage on PR #546. Base: main `f81df788`. Code and tests only: no migration, deploy, balance, order or flag was changed, and production was not touched.

## P0-1: a paused managed listing never executes a conditional or OCO order

**Before.**

- `spotPriceSource` gave a non-historical managed listing its model price even with `tradable:false`, so `PriceWatcherService` fired its pending orders.
- `OrderService.triggerOrder` did not re-check the listing gate, so a triggered order filled against real resting orders.

**Now.**

- `spotPriceSource` returns no price for a managed listing that is not tradable or not open yet (`src/services/testMarkets/nrxSpot.ts`). The watcher skips it.
- `triggerOrder` waits for the registry, bounded at 1.5 s, before its transaction. Inside the transaction it re-checks the gate at the execution boundary: `spotListingOpen(row.pair)`.
  - If the gate is closed, the order **stays `PENDING_TRIGGER` with its reserve**. Nothing is refunded, cancelled or lost.
  - The OCO sibling is untouched.
  - Once the listing reopens, the orders trigger normally.
- **NRX is unchanged:** `assertSpotListing` keeps its exact NRX rule, and `nrxSpot.pg.test.ts` passes.

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
- no trigger price and a closed gate for a paused or not-yet-open listing, with the venue never asked.

**Disposable PostgreSQL (`managedListingFailClosed.pg.test.ts`, 4/4; added to `admin-listings.yml`):**

1. A conditional TAKE_PROFIT and an OCO are placed on a tradable listing, against a resting bid. The model price then passes both triggers and the listing is paused.
   - The watcher triggers 0, and a direct `triggerOrder` returns null.
   - Balances, orders and trades are unchanged, and new orders are refused.
   - After reopening, exactly 2 orders fill, the OCO stop leg is cancelled, and the base asset is conserved (seller 8 available / 0 locked).
2. With the registry unresolved, the service refuses LIMIT, STOP_LIMIT and OCO on a Worker-only pair before any lock or row. A venue pair is accepted.
3. With the registry unresolved, REST `POST /orders` (LIMIT and STOP_MARKET) and `POST /orders/oco` answer 400 with the customer-safe refusal and write nothing.
4. After recovery, the ordinary path is unchanged.

**Mutation check:** with the three guards removed, 5 of these tests fail.

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

- An auditable state on the published version (`ACTIVE | PAUSED | STOPPED`), not a delete.
- Define, per state, what happens to:
  - quotes and charts (frozen or continuing model);
  - resting orders (kept, or cancelled with release);
  - conditional triggers (held, as P0-1 now does);
  - wallet valuation.
- Cover the state transitions, restart behaviour and the 7-language UI.
- Show a test/simulated market as such without redesigning the approved Spot pair list.
