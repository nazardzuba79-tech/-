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

## Pre-listing timer: start, pause, stop (operational state, never a new version)

A published listing's public countdown is controlled by the admin, separately
from its configuration. The state lives in the Durable Object's `meta` table
(`countdown:<listing id>`, see `listingConfig.ListingCountdown`); nothing in the
immutable configuration changes, and the listing time never moves with it. The
countdown always counts to `listingAt` by the **server** clock: the public
catalogue carries `serverTime`, the page keeps the offset, so a wrong viewer
clock or a reload changes nothing.

| State | Exchange | Market | Render (gate, triggers, guards) |
|---|---|---|---|
| `staged` | not in the public catalogue: no page, no row in Markets | never opens | knows the ticker (restricted everywhere), unarmed: orders refused |
| `running` | page with the date and the ticking countdown | opens at `listingAt` by the server clock (if `tradable`) | armed: orders refused before `listingAt`, open from the instant |
| `paused` | page with the date, «Отсчёт до листинга приостановлен», no counter | stays frozen one millisecond before its first tick, even past `listingAt` | unarmed: orders refused, no trigger price |

A listing published before the timer existed has no state and behaves as
`running` (unchanged behaviour).

Rules (`nextListingCountdown`):
- **Nothing starts by itself.** `start` needs a listing time still ahead;
  a passed date answers `LISTING_TIME_PAST` until the date is moved.
- A staged or paused listing whose date passed **did not open**, so its time
  may still be moved: edit the listing, set a new time, publish (a new
  version), then start the timer. `checkPublishable` takes an `opened` flag
  for this; a running listing past its date is opened and locked as before.
- An opened market has no timer: `pause` / `stop` answer `MARKET_OPEN`.
- Actions are idempotent (`changed: false`), bump the catalogue revision only
  on a change, and the public edge follows within its 15 s cache window.

API:
- `POST /admin/listings/:id/publish { draftRevision, publishKey, countdown?: 'staged' | 'running' }` —
  `staged` on a FIRST publication keeps the listing off the public edge until
  the timer is started. Omitted = as before.
- `POST /admin/listings/:id/countdown { action: 'start' | 'pause' | 'stop' }` → `{ id, countdown, changed }`.
- Durable Object: `POST /internal/listings/:id/countdown`; `GET /internal/listings/published`
  includes staged listings (with `countdown`), `GET /published` excludes them.
- Public asset (`publicListingAsset`): `listingArmed` follows the timer and
  `countdown: 'running' | 'paused'` names it.

Admin → Listings: the publish confirmation has «Запустить таймер сразу после
публикации» (ticked by default; untick it to publish without the timer); every
published row shows the timer status, the line
«Листинг: 27.10.2026 — 13:00 UTC / 16:00 МСК» and the buttons «Запустить
таймер», «Приостановить», «Остановить и скрыть». A passed date with a timer
that never ran is a red alert: «назначьте новую дату».

Tests: `src/services/listings/__tests__/listingCountdown.test.ts` (rules, gate,
trigger price, public edge at 13:00 UTC), `workers/market-edge/listings.integration.test.mjs`
(timer lifecycle on workerd: staged → start → pause → stop, idempotency, a
passed date, an opened market, restart), `src/api/routes/__tests__/adminListings.test.ts`,
`frontend/src/lib/__tests__/managedListings.test.ts` (admin buttons, dialog,
overdue), `customerListingPresentation.test.ts` (paused card in seven
languages), and `scripts/qa-listing-timer.cjs` (browser: `docs/qa/listing-timer/`).

Known limits:
- Deploy the **Worker first**: an old Worker answers the new route with
  `not_found`, which the admin shows as «Листинг не найден».
- The Spot terminal does not hide the order form of a tradable listing before
  its time; the server gate (`assertSpotListing`) is the guard, as before.
- Wallet valuation of a paused listing's base asset after its date would use
  the model price; nothing is allocated before activation, so no holder exists.

## Runbook: listing of Tuesday 2026-10-27, 13:00 UTC = 16:00 Moscow

One instant: `2026-10-27T13:00:00Z`. The admin shows it as «27.10.2026 13:00
Всемирное время (UTC) · 15:00 Киев (UTC+2) · 16:00 Москва (UTC+3)»; the
exchange shows «27.10.2026 — 13:00 UTC / 16:00 МСК» next to the timer.

**Approved asset (owner, 21.10.2026): TERYVANE, ticker `TYVN`, pair
`TYVN/USDT`, initial price `0.0250` USDT, total emission 100 000 000 TYVN.**
The candidate draft is `config/test-markets/tyvn.draft.json`; its exact values
are checked by `src/services/listings/__tests__/tyvnDraft.test.ts` and the
local end-to-end run `scripts/qa-listing-tyvn.cjs` (`docs/qa/listing-tyvn/`).

| Field | Value | Note |
| --- | --- | --- |
| Name / ticker | TERYVANE / `TYVN` | 2–10 Latin characters; not reserved; not NRX/VTA/AITH; not a CFD, futures, stocks or icon entry of the repository. Not on Kraken's public pair list. The production venue list (`marketUniverse.spot()`) and the production Durable Object can be checked only by the real admin: it refuses `TICKER_ON_MARKET` / `DUPLICATE_TICKER` itself. |
| Initial price | `0.0250` USDT | Stored as entered; the exchange shows `0.025000 USDT`. |
| Listing | `2026-10-27T13:00:00Z` | Admin form: **27.10.2026 16:00**, zone **Москва**; the admin row shows «13:00 Всемирное время (UTC) · 15:00 Киев (UTC+2) · 16:00 Москва (UTC+3)», the exchange «27.10.2026 — 13:00 UTC / 16:00 МСК». Kyiv is UTC+2 on that Tuesday (winter time from 25.10.2026). |
| Emission | 100 000 000 TYVN | The listing system has no supply field; this is documentation. `ownerAllocation: "100000000"` is a parameter only: nothing is credited until the separate audited allocation step with the owner's go. |
| Trading | `tradable: false` | A non-executable demo scenario: the Spot gate refuses every order before and after the opening. Making it tradable is a separate owner decision and a different draft. |
| Price path | `scenario-controls-v2`, defaults | Scenario `AUTO`, which the unchanged manual seed `teryvane-20261026-v1` (kept to preserve the same deterministic scenario after rescheduling) resolves to **FREQUENT_PULLBACKS** (deterministic); first 24 h +1725 % → `0.45625`; growth 168 h in two stages (24 h → `0.45625`, 144 h → `2.009605`); hard cap `2.33675` (+9247 %); then a range. Moderate pullbacks 2–8 % / 45 min, medium candles, normal wicks. No new generator; other listings' scenarios untouched. |
| Logo | none | Not provided; the exchange shows the letter badge. Can be added to the draft before publication (≤ 64 KB). |
| Timer | **off** | Publish with «Запустить таймер сразу после публикации» unticked; start only on the owner's command. |

The draft exists in the repository as a file only: nothing has been created on
the production Durable Object, published, started, traded or credited.

Steps, all in Admin → Listings, no deploy between them:
1. «Создать листинг»: ticker `TYVN`, name `TERYVANE`, price `0.0250`, time
   **27.10.2026 16:00** with the zone «Москва» (the field under it confirms
   13:00 UTC), «Спотовая торговля после листинга» off, seed `teryvane-20261026-v1`
   entered manually, movement settings left at their defaults (the saved
   scenario must read «Рост с частыми откатами», 24 h price 0,45625, cap
   2,33675). Save the draft, Preview: the first 24 h must start at 0.025
   and end at 0.45625.
2. «Опубликовать» with «Запустить таймер сразу после публикации» **unticked**.
   The listing is validated and locked, Render learns the ticker, the
   exchange shows nothing yet; the row reads «Таймер не запущен».
3. When ready, «Запустить таймер». Within 15 s the exchange shows the asset
   page with the date and the countdown; Markets lists the pair with the date.
   «Приостановить» / «Остановить и скрыть» at any time before 13:00 UTC; the
   date stays.
4. At 13:00:00 UTC the server's phase turns live and the chart replaces the
   countdown on the next read; orders on a tradable listing are refused one
   millisecond before and accepted from the instant. No scheduler, no deploy.
5. If 13:00 UTC passes with the timer not running: the row shows the alert,
   nothing opens; move the date (edit → publish) and start the timer.

Production activation stays the owner's separate decision: this change needs
the Worker (Durable Object), Render and the frontend deployed first, then the
readiness check of steps 1–3 on the real admin.
