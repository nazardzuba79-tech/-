# Admin → Listings (managed simulated markets)

Review-only audit and evidence limits: [Spot listings audit](qa/SPOT_LISTINGS_AUDIT.md).
The `isTestAsset` flag does not isolate NRX/managed ordinary Spot balances.
The audit records unresolved registry propagation and order-retry limitations;
do not read the UI corrections as financial-release certification.

A new simulated coin is a **configuration**, not code: the owner creates it in
Admin → Listings, previews it privately, and publishes it. The exchange then
shows it (Markets row, countdown, pre-listing → live, candles, order book,
tape, Spot trading when enabled) without a code change or a deploy.

VTA and NRX are unchanged and remain in code. A managed listing may not use
their tickers (`VTA`, `NRX`, and other reserved symbols) or a pair that already
trades on the venue.

## Where things live

| Piece | Location | Notes |
|---|---|---|
| Drafts, versions, active config | `workers/market-edge` Durable Object `ManagedListingsDO` (SQLite), binding `LISTINGS` | Not Neon. Own namespace; the deposit-catalogue Worker was only a pattern (nothing shared). |
| Admin store API | `market-edge` `/internal/listings/*` | Bearer `LISTINGS_STORE_TOKEN`, refuses any browser `Origin`, no CORS. Only Render calls it. |
| Admin UI + API | `frontend/src/pages/admin/AdminListingsPage.tsx`, `src/api/routes/adminListings.ts` | `requireAuth` + `requireAdmin` on every route (role re-read per request). |
| Public market data | `market-edge` `/market/listings` and pair paths (`/market/test-assets/QAX-USDT[/candles]`, `/market/display/spot-book/QAX-USDT`, …) | Computed on read from the active config + server time. Never returns a draft, a seed, or the owner allocation. |
| Spot trading gate, valuation | Render `ManagedListingRegistry` (`src/services/listings/registry.ts`) | Reads published configs from the store at most once per 60 s per instance, and immediately after a publish from that instance. |
| Owner allocation | `scripts/allocate-listing-owner.cjs` → `src/services/listings/ownerAllocation.ts` | Separate, explicit, idempotent. Never run by Create/Preview/Publish. |

## Configuration and history rules

- Fields: name, ticker, logo (PNG/JPEG/WebP/SVG data URL, ≤ 64 KB), initial
  price (USDT), listing date + time entered in a chosen IANA time zone (stored
  as the UTC instant, the zone kept for display), owner allocation quantity,
  seed (automatic or manual), Spot trading on/off.
- An automatic seed is generated once and kept across draft saves.
- A simulation profile (candle character only) is assigned by the store when
  the listing is created, in rotation #1 CALM_TREND, #2 IMPULSE_TREND,
  #3 PULLBACK_TREND, #4 COMPRESSION_BREAKOUT, #5 CALM_TREND…, and never changes
  afterwards; a request cannot choose it. Listings created before profiles
  existed keep the original candles. See `docs/SIMULATION_REALISM.md`.
- History is a pure function of `(pair, seed, initialPrice, listingAt,
  simulationProfile)` and the server clock
  (`src/services/testMarkets/testMarketSimulation.ts`). Reload, reopen,
  Preview, a Worker restart or another Render instance produce the same
  candles. The profile never moves the hour anchors or the final price.
- After publish, ticker, seed, initial price and profile are locked (`HISTORY_LOCKED`).
  The date can move only while the market has not opened. Name, logo, time
  zone, allocation parameter and the trading switch can change and publish a new
  version; past prices never change.
- Concurrency: drafts use `If-Match` revisions (a stale save is `409`), publish
  is atomic in one SQLite transaction, a repeated publish key or an unchanged
  draft returns the active version (`replayed: true`).
- Minimum lead: a listing must open at least 60 s after publish
  (`LISTINGS_MIN_LEAD_MS`, floor 5 s, used only by local QA).

## Request budget (honest numbers)

- Public market data for managed pairs: **0 Render requests, 0 Neon queries**.
  Served by Cloudflare. The public catalogue is cached per isolate for 15 s.
- Browser → edge: the listings catalogue is one more small GET on pages that
  already read the NRX catalogue (pair lists, Markets), at the existing 60 s
  list cadence while visible. An open terminal on a managed pair reads the
  catalogue and candles every 5 s and the book every 10 s, like NRX (local QA:
  30 edge requests in 30 s for two open tabs).
- Render per admin action: 1 session/user read (`requireAuth`) + 1 role read
  (`requireAdmin`) + 1 Cloudflare call (Publish: 2 Cloudflare calls, the list
  and the publish). Preview is computed on Render from the draft. These are
  admin-only and rare.
- Render for trading: a Spot order on a managed pair may trigger at most one
  store read per 60 s per Render instance (waits ≤ 1.5 s, keeps the last good
  snapshot on failure). Orders on other pairs are unaffected.
- The admin check stays on Render with Neon; this was not weakened to reach
  "Render = 0".

## Production steps (not done by this change)

The ordered runbook, workflows and smoke checks are in `docs/CLOUDFLARE_ACTIVATION.md` §A.

1. Choose a random token (≥ 32 characters). Set it on the Worker
   (`wrangler secret put LISTINGS_STORE_TOKEN`) and on Render
   (`LISTINGS_STORE_URL=https://market.voltextech.net`, `LISTINGS_STORE_TOKEN`).
2. Deploy `market-edge` through the existing gated workflow (commit message
   with `[deploy-market-edge]`); it applies the `listings-v1` Durable Object
   migration and reports `public-display-edge-v10` on `/health`.
3. Deploy Render and the frontend. Without step 1, Admin → Listings answers
   `503 STORE_NOT_CONFIGURED` and nothing else changes.
4. Create a listing, Preview, Publish. Optional: run the owner allocation
   step (dry run first) with a verified ADMIN id, only with the owner's
   separate approval.

## Owner allocation

```
npm run build
node scripts/allocate-listing-owner.cjs --listing-id <id> --owner-id <ADMIN user id>            # dry run
node scripts/allocate-listing-owner.cjs --listing-id <id> --owner-id <ADMIN user id> --confirm  # credit once
```

Credits exactly the configured quantity of the listed asset to that ADMIN's
Spot balance, once per listing (audit receipt + advisory lock), creates or
debits no USDT, and refuses when unexplained inventory already exists.

A retry validates the existing receipt's owner, action, listing ID, asset and
exact decimal quantity before reporting that it was already applied. A later
display-only version or equivalent decimal formatting does not invalidate the
receipt. Changing the allocation quantity after crediting it requires manual
review: a retry refuses the mismatch and never reports the new quantity as the
old credit. It never tops up an existing allocation.

## Display is not liquidity

The order book and tape shown for a managed pair are display data. Spot orders
use the standard matching and settlement: they fill only against real user
orders.
