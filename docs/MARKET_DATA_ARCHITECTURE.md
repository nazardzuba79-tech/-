# VOLTEX Market Data Architecture

How market data gets from an external provider into a VOLTEX page, and the
rules that keep that path cheap, honest and hard to break.

```
external providers
  Kraken · CoinGecko · alternative.me · Twelve Data · Binance · OKX
        │
        ▼
HttpProviderClient      retries · jittered backoff · Retry-After · circuit
        │
        ▼
ProviderHealth          per-provider state, shared registry
        │
        ▼
ProviderCache           TTL · in-flight dedup · stale-last-good · LRU bound
        │
        ▼
provider service — normalization lives here
  KrakenMarketDataService · CoinGeckoService · FearGreedService
  CfdMarketDataService · ArbitrageService
        │
        ▼
MarketDataGateway       capability routing · provenance · availability
   ├─ AssetRegistry     canonical ids · catalogue vs tradable
   └─ never a fake zero: a failure becomes `available: false`
        │
        ▼
VOLTEX REST API (/api/v1/market/*, /futures/*, /analytics/*)
        │
        ▼
frontend lib/marketDataStore — ONE poll, ONE in-flight request per tab
        │
        ▼
Spot · Futures · CFD · Markets · Homepage · tickers · Wallet · Arbitrage
```

The one exception to the last step is the live order book / trade tape,
which streams straight from Kraken's public WebSocket in the browser. That
is deliberate and documented under **Frontend direct provider
dependencies** below.

---

## 1. Providers, and what each one is for

| Provider | Used for | Key? | Notes |
|---|---|---|---|
| **Kraken** public REST (`api.kraken.com`) | Tradable pair list, spot tickers, order-book depth, OHLC candles, recent trades. Also the index price the futures mark price is built on. | No | Chosen over Bybit because Bybit's public API blocks US-hosted servers, which is where this backend runs. Read-only: nothing here ever places or affects an order. |
| **Kraken** public WebSocket (`ws.kraken.com/v2`) | Live order book + trade tape in the browser. | No | Frontend-only. See §9. |
| **CoinGecko** (`api.coingecko.com/api/v3`) | Market-cap rank, category tags, per-coin market-wide price/volume/market cap/7d sparkline, and the `/global` totals (total market cap, 24h volume, BTC and ETH dominance). | Optional Demo key (`COINGECKO_API_KEY`) | Never backs a tradable pair — Kraken is the only source the matching engine and price watchers act on. |
| **alternative.me** (`api.alternative.me/fng`) | The published Crypto Fear & Greed Index. | No | Republished once a day. Cannot be derived locally: the index is a composite of volatility, momentum, social sentiment, dominance and search trends; our tickers can measure one of those. |
| **Twelve Data** (`api.twelvedata.com`) | CFD reference quotes: gold + five major forex pairs. Price and, when reported, 24h change. | **Yes** — `TWELVE_DATA_API_KEY` | The only key-bearing provider, and the only metered one: the free tier is **8 credits per minute** and a batched `/quote` costs one credit per symbol. Absent key = `provider_not_configured`, which the UI shows differently from an outage. |
| **Binance** public REST (`api.binance.com`) | One of the three venues the arbitrage monitor compares. | No | Read-only price comparison. Never places or moves anything. |
| **OKX** public REST (`www.okx.com`) | The second arbitrage comparison venue (Kraken is the third). | No | Same. A pair with fewer than two live venues is omitted rather than shown as a one-sided "spread". |
| **VOLTEX itself** | Futures funding rates, open interest, mark/index prices, internal order books, internal candles. | — | An exchange is the only authoritative source for its own book. |

Adding a provider is a decision with an ongoing cost (budget, secrets,
failure modes) — see §12.

**No derivatives-reference provider is configured.** Market-wide open
interest, external funding, long/short ratio and cross-venue liquidations
therefore remain unavailable, and are reported as such rather than
approximated — see §11.

## 2. Normalized contracts

Provider-shaped responses stop at the service boundary. Kraken's `c`/`o`/`h`/
`l`/`v`/`p` arrays and CoinGecko's `market_cap_percentage` never leave their
adapter; what the API and the frontend see is:

- `MarketSymbol` — `pair` (`BTC/USDT`), `baseAsset`, `quoteAsset`.
- `MarketTicker` — `pair`, `lastPrice`, `bidPrice`, `askPrice`, `high24h`,
  `low24h`, `volume24h` (base), `quoteVolume24h` (quote), `changePercent24h`
  (already a percentage — see `frontend/src/lib/priceChange.ts`).
- `MarketOrderBookSnapshot` — `pair`, `bids[]`, `asks[]`, `timestamp`; routes
  add `source`.
- `MarketCandle` — `time` (unix **seconds**), `open`, `high`, `low`, `close`,
  `volume`.
- `MarketTrade` — `id`, `price`, `quantity`, `side`, `time` (unix **ms**).
- `CoinRanking`, `GlobalMarketData`, `FearGreedReading` — CoinGecko /
  alternative.me equivalents.
- Futures adds `markPrice`/`indexPrice` (`/futures/mark-price/:symbol`),
  `fundingRate` (`/futures/funding-rate/:symbol`), `openInterest` +
  `openInterestValue` (`/futures/open-interest/:symbol`) and
  `fundingIntervalHours` (`/futures/config`).

These types predate this document and were already clean; this work reused
them rather than inventing a parallel set.

**Freshness and availability now travel with the value.** `ProviderCache`
always tracked `fetchedAt`/`stale` internally, but until the gateway
existed that stopped at the service boundary — a two-minute-old
stale-served price reached the browser looking exactly like a live one.
`src/services/marketData/types.ts` defines the contract every gateway
answer uses:

```ts
type Availability<T> =
  | { available: true; value: T; source: DataSource; fetchedAt: number; stale: boolean }
  | { available: false; reason: UnavailableReason; detail?: string };
```

The second branch carries **no value-carrying fields at all**. That is not
a style choice: it is what makes it impossible for a client to plot an
absent metric as zero, because there is no field there to plot. The rule,
stated once:

| Situation | Result |
|---|---|
| A real zero | `0` |
| No data | `available: false` — never `0`, never null coerced to `0` |
| Provider failed, last good value inside the stale budget | previous value, `stale: true` |
| Provider failed, past the stale budget | `available: false` |

`DataSource` distinguishes `voltex` from every external venue, which is
what keeps reference derivatives data out of VOLTEX financial calculations
— see §15.

**A perp ticker deliberately has no market-wide open interest, funding
history from other venues, or long/short ratio.** Nothing in this system
sources them.

## 3. Caching: TTLs and why

`ProviderCache` (`src/services/marketData/ProviderCache.ts`) is the only
caching primitive. Every entry carries `fetchedAt`, every cache is bounded
(LRU), and every cache can serve its last good value for a bounded window
when a refresh fails.

| Data | TTL | Stale budget | Reasoning |
|---|---|---|---|
| Kraken asset pairs | 5 min | 60 min | A listing barely changes; an hour-old pair list beats an empty exchange. |
| Kraken tickers (all) | 5 s | 60 s | Trading-adjacent. A short grace covers one failed poll. |
| Kraken order book | 2 s | 10 s | Most latency-sensitive REST path; the WS feed is the primary one anyway. |
| Kraken candles | 5 s | 10 min | Only the newest bucket can change — see §7. |
| Kraken recent trades | 2 s | 30 s | Tape data, same profile as the book. |
| CoinGecko catalogue markets | 20 min | 24 h | 3 calls (3 × 250 coins). The moving half of the catalogue — price, cap, volume, 24h change. |
| CoinGecko category tags | 6 h | 24 h | 7 calls. Sector membership changes on the order of months; on the same TTL as the market walk it would have tripled the monthly bill for data that never moved. |
| CoinGecko `/global` | 5 min | 6 h | Headline market figures; a slightly old market cap beats a dash. |
| Fear & Greed | 15 min | 24 h | Republished once a day — a stale reading is usually still the current one. |
| Twelve Data CFD quotes | 60 s | 120 s | Paced to the 8-credit/minute budget. Trading-adjacent (the CFD order form prices against it), so the stale budget is short: one failed poll may be covered, a sustained outage may not. |
| Arbitrage opportunities | 10 s | 30 s | A spread past its budget is history, not an opportunity. |
| Asset catalogue (registry join) | 10 min | 6 h | A listing barely changes, and the join is the expensive part at 750 assets. |

**The CoinGecko budget, explicitly.** 3 market calls every 20 minutes is
6,480 a month; 7 category calls every 6 hours is 840. ~7,300 against the
free Demo plan's 10,000 — with headroom for restarts, which reset an
in-process cache. That headroom is the reason the two halves are on
different clocks: putting the category walk on the market TTL would cost
~22,700 a month and blow the plan. If the catalogue ceiling is raised
again, this arithmetic is what has to be redone first.

Cache sizes: 4 entries for singleton caches (pairs, tickers), 120 for the
per-symbol ones (order books, candle series, trades). Candle series are
additionally capped at 1000 candles each. Nothing is keyed by an unbounded
client-supplied value.

**No Redis, no queue, no extra service.** All of this is in-process, sized
for one small Render instance, and dies with the process — which is correct
for data whose whole purpose is to be recent.

## 3a. The Market Data Gateway

`src/services/marketData/MarketDataGateway.ts` is the single façade every
reference-market read goes through. It is an **orchestration layer, not a
fourth cache**: the provider services keep doing their own normalization
and keep owning their own `ProviderCache`/`ProviderHealth`. What the
gateway adds is the four things that were missing.

1. **Routing.** A caller asks for "candles for BTC/USDT", not for Kraken.
   When a second provider is added, the routing changes here and nowhere
   else.
2. **Provenance and freshness on every answer** (§2).
3. **Availability instead of exceptions.** A provider failure becomes
   `available: false`, never a thrown error a caller might paper over with
   a default. There is deliberately no `?? 0`, no `|| []` and no default
   value anywhere in the class.
4. **Declared capabilities.** Asking Twelve Data for an order book is
   refused in one place rather than discovered as six runtime 404s.

### Capability routing

| Capability | Provider | Transport | Key required |
|---|---|---|---|
| `asset_catalogue` | CoinGecko | REST | No |
| `tradable_markets` | Kraken | REST | No |
| `ticker` / `tickers` | Kraken | REST | No |
| `candles` | Kraken | REST | No |
| `order_book` | Kraken | REST | No |
| `recent_trades` | Kraken | REST | No |
| `market_overview` | CoinGecko | REST | No |
| `sentiment` | alternative.me | REST | No |
| `cfd_quotes` | Twelve Data | REST | **Yes** |

The table is data (`CAPABILITY_BINDINGS`), served by
`GET /market/status`, so the docs and the routing cannot drift apart.

### HTTP surface

Additive — every pre-existing `/market/*` route keeps its exact shape,
because shipped frontend surfaces depend on them.

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /market/snapshot` | Tickers + overview + sentiment in ONE payload. The endpoint the frontend polls. | Public |
| `GET /market/assets` | Canonical catalogue, `?tradable=true`, `?limit`/`?offset` (clamped). | Public |
| `GET /market/assets/icons?symbols=…` | Batched display metadata. Bounded at 500 symbols. | Public |
| `GET /market/tradable` | Executable VOLTEX markets. | Public |
| `GET /market/ticker/:pair` | One pair, with provenance. | Public |
| `GET /market/status` | Provider circuits, capability table, catalogue size. | **Admin** |

An `available: false` section is still HTTP **200**. It is a successful
answer to "what do you have?" — the answer is "not this". Reserving
non-2xx for genuine server faults keeps a provider outage from looking
like a bug in VOLTEX.

## 3b. The asset registry: identity, and catalogue vs tradable

`src/services/marketData/AssetRegistry.ts`.

Identity used to be the ticker string: `CryptoIcon` built a CDN URL out of
it, `avatarColor` hashed it, CoinGecko lookups matched on it, Kraken pairs
were split on it. That works until two coins share a ticker — which is not
hypothetical, CoinGecko's own top-500 contains collisions, and the previous
code resolved them by keeping whichever it saw first and **silently
discarding the rest**. A ticker is a label, not an identity.

Every asset now has a namespaced canonical id:

- `cg:bitcoin` — CoinGecko's slug, stable across renames and re-listings.
- `kraken:XYZ` — an asset VOLTEX lists that the catalogue does not cover.
  A deliberately different namespace: it says "this identity came from the
  venue, not the catalogue".

A collision is now **represented** (`ambiguous`, `collidingIds`) rather
than resolved by deletion. `resolveSymbol()` still answers a ticker-only
lookup — preferring the tradable, better-ranked asset — but the result
tells the caller it was a guess.

> ### The catalogue is not the tradable set
>
> `catalogue` is 500+ assets of market-wide reference metadata. Displaying
> one costs nothing and commits VOLTEX to nothing.
>
> `tradingPairs` is the executable set, and it comes from ONE place:
> Kraken's real tradable pair list, the same list the spot terminal and the
> matching engine already work from.
>
> **Growing the catalogue to 500+ assets must never grow the executable
> market set by a single pair.** An asset with `tradable: false` has no
> route to an order form, and nothing in the registry can invent one.
> `AssetRegistry.test.ts` and `CatalogueScale.test.ts` assert both
> directions, and `cryptoCatalogue.test.ts` asserts it again in the UI —
> including that the Spot and Futures pair-list modules are byte-identical.

If CoinGecko is unavailable the catalogue is built from the venue's pair
list alone: fewer assets, no logos, no ranks, `metadataComplete: false`,
`source: 'kraken'`. Degraded and labelled, never empty. If **Kraken** is
unavailable the failure propagates — a catalogue with no tradable set is
worse than none.

### Querying the catalogue

`AssetRegistry.query()` is the one entry point for search, sort, filter and
pagination, and it runs **entirely over the cached join** — no query
reaches a provider. `MarketDataGateway.queryAssets()` wraps it with the
same capability and availability handling as every other read, and
`GET /market/assets` exposes it behind an allow-list (`sort` must be one of
the seven known keys, `search` is bounded to 64 characters, `limit` is
clamped to 1000 and `offset` to 100,000).

Two rules in there are worth stating, because getting them wrong is how
this kind of table lies:

- **Nulls sort last in BOTH directions.** An asset with no reported market
  cap is not an asset with a market cap of zero. Sorting it as 0 would
  float every unpriced coin to the top of an ascending sort, which reads as
  a claim about them.
- **Rank inverts.** Rank 1 is the biggest asset, so the default `desc`
  direction has to mean "best first". Handled once, in `compareAssets`.

`AssetMarketSnapshot` deliberately carries **no sparkline**. 500+ assets ×
a 7-day series is roughly a megabyte on every catalogue load, to draw a
thumbnail nobody sorts by. Charts belong on the pages that ask for one
symbol at a time.

### Which pair a Trade action opens

`defaultTradingPair()` picks from the asset's REAL `tradingPairs` under a
fixed quote priority — `USDT, USD, USDC, EUR, BTC, ETH`, then
lexicographic — and returns `null` when the list is empty. It never
assembles a pair from a ticker. `${symbol}/USDT` is one string
concatenation away from linking a user to a market that does not exist;
this function is the reason that never happens, and it is mirrored
verbatim in `frontend/src/lib/catalogueStore.ts` so the two cannot drift.

The client applies the same gate before rendering an action at all: a
non-tradable asset gets a "data only" label, **not** a disabled Trade
button — a greyed-out control implies a market that might open later.

### The Markets page: one request for the whole catalogue

`frontend/src/lib/catalogueStore.ts` loads the full catalogue **once per
tab** (refcounted, in-flight-coalesced, one timer at 10 minutes — the
server's market half is cached for 20, so polling faster cannot return
anything fresher). Search, sort, filter and paging are then pure functions
over data already in memory: `filterAndSortAssets` mirrors the server's
semantics exactly, including the nulls-last rule.

That is what makes the search instant and free. A keystroke costs zero
requests, a sort click costs zero requests, and turning a page costs zero
requests — measured in a real browser, not asserted in principle. Only 50
rows are mounted at a time; 500+ rows are never in the DOM at once.

Favourites are keyed by **pair**, not by ticker, because that is the key
the spot pair list, the futures pair list and the homepage table already
share. A catalogue row therefore stars its default market, and an asset
with no market shows no star — there would be nothing to store.

### Icon pipeline

Resolution order, in `CryptoIcon`:

1. Canonical registry metadata (batched — see below).
2. A caller-supplied `imageUrl`.
3. The explicit overrides (TON).
4. The jsDelivr cryptocurrency-icons set.
5. A deterministic letter avatar.

Tiers 3-5 are the original pipeline, unchanged. Tier 1 is new, and it
replaced something worse: the spot and futures pair lists each downloaded
the **entire 500-coin CoinGecko rankings payload — including a 168-point
7-day sparkline per coin** — purely to build a symbol→image map and throw
the rest away.

`frontend/src/lib/assetMetadataStore.ts` batches: components declare the
symbols they are about to render, unknown ones are collected across every
component in the same 50 ms window and flushed as ONE request, and a
catalogue miss is remembered so it costs one request ever rather than one
per scroll. **A 500-row table costs one metadata request.** Proven in
`marketDataStore.test.ts`. The catalogue table needs even less: the logo
travels with the asset in the catalogue payload itself, so its rows make no
metadata lookup at all — only the letter fallback, for an asset the
provider gave no logo.

## 4. Request deduplication

`ProviderCache.fetch(key, loader)` keeps one in-flight promise per key.
N concurrent callers on a cold or expired key produce **one** outbound
request and all receive its result. Proven in
`src/services/marketData/__tests__/ProviderCache.test.ts` ("collapses ten
concurrent cold requests into ONE outbound load").

Before this, only Kraken's ticker walk deduplicated; order book, candles,
trades, CoinGecko rankings and Fear & Greed did not. Twelve Data and the
arbitrage venues were moved onto `ProviderCache` in the gateway work, so
every outbound provider read in the system now deduplicates.

### The frontend half

Server-side deduplication stops *providers* being asked N times. It cannot
stop **VOLTEX** being asked N times, and that was the real cost: one page
view ran six or more independent `setInterval`s against overlapping market
endpoints — the terminal ticker bar at 3s, the spot pair list at 4s, the
futures pair list at 4s, the futures ticker bar at 4s, the markets table at
5s, its rankings at 10s, its overview at 60s, the top-gainers strip at 15s.

`frontend/src/lib/marketDataStore.ts` is the client-side mirror of
`ProviderCache`:

- **ONE `setInterval` per tab**, however many components subscribe.
- **ONE in-flight request**; subscribers mounting mid-flight join it.
- **Reference-counted** — a tab on a page with no market UI polls nothing.
- Polls at the **fastest cadence any live subscriber asked for**, floored
  at 3s (below the backend's 5s ticker TTL, where faster polling cannot
  return fresher data).
- A late subscriber arriving at a populated store is answered **from
  memory**, with no request.

Measured in the browser, 30 s per route, same fixture backend
(`scripts/qa-market-data-gateway.cjs`), counting every market-data HTTP
request the page issued:

| Route | Before | After |
|---|---|---|
| `/trade` | 27 | **11** |
| `/futures` | 21 | **10** |
| `/` | 21 | **10** |
| `/markets` | 12 | **8** |

The per-pair `/market/external/tickers/:pair` endpoint disappeared from
every route: nothing polls it any more. The remaining counts are exactly
each page's cadence (spot 3s → 10 in 30s, futures 4s → 8, markets 5s → 6)
with no redundancy on top.

## 5. Stale-data policy

A refresh failure inside the stale budget serves the previous value
flagged `stale: true`, and logs one line (`[marketData] <provider> serving
stale <key>`). Past the budget the underlying error propagates — the API
returns 502 rather than presenting an arbitrarily old price as current.

The graded budgets in §3 are the policy: **descriptive data may be old,
trading-adjacent data may not.** A first-ever failure with nothing cached
always propagates; nothing is ever invented to fill a gap.

## 6. Retry, backoff and rate-limit safety

`HttpProviderClient` (`src/services/marketData/ProviderHealth.ts`):

- **Bounded retries** — 2 by default. There is no configuration that
  produces an unbounded loop.
- **Full jitter backoff** — `random() * min(maxDelay, base * 2^attempt)`,
  base 250 ms, ceiling 4 s. Full jitter (not fixed backoff) so clients that
  failed together don't retry in lockstep.
- **Retry-After is honoured** — both delta-seconds and HTTP-date forms. A
  429 whose `Retry-After` exceeds the retry budget stops immediately rather
  than being retried.
- **Only retryable statuses are retried** — 408, 425, 429 and 5xx. A 404 or
  400 is our request's fault; it fails fast and does **not** count against
  provider health.
- **Controlled concurrency** — Kraken's ticker walk still batches 40 pairs
  per call, 6 batches in flight, unchanged.

## 7. Candle caching

Closed candles are immutable; only the newest bucket is still forming. The
cache is one series per `pair:interval` (not per requested `limit`):

1. First request fetches the full window and stores it.
2. Later requests past the 5 s TTL fetch with Kraken's `since=<last closed
   candle>` — usually one or two candles — and merge. The previously-open
   bucket is replaced by its final closed form, so an incomplete candle is
   never kept as history.
3. `limit` is a slice of the shared series, so consumers asking for 300 and
   720 candles share one fetch.
4. A gap wider than 500 candles falls back to a full fetch rather than
   leaving a hole.

**Effect on the BTC → ETH → SOL → BTC navigation**: returning to BTC reuses
the cached series and asks for the tail instead of re-downloading ~720
candles. Proven in `KrakenMarketDataService.test.ts`.

## 8. Provider health and circuit breaker

`ProviderHealth` tracks `state` (CLOSED / OPEN / HALF_OPEN),
`consecutiveFailures`, `lastSuccessAt`, `lastFailureAt`, `cooldownUntil`
and `rateLimitHits`.

- 4 consecutive failures — or any single 429 carrying a `Retry-After` —
  opens the circuit.
- While OPEN, requests fail immediately with `ProviderUnavailableError`
  **without touching the network**; the cache serves what it has.
- After the cooldown (30 s, doubling to a 5 min ceiling on each failed
  probe) the next caller is a single HALF_OPEN probe. Success closes the
  circuit; failure doubles the wait.
- One log line per transition — enough to see a provider go down and come
  back in Render's logs, quiet enough to survive a bad hour.

Health is exposed only through the admin-gated `GET /market/status` and
`GET /analytics/diagnostics`. It is operational detail, not public data,
and the user-facing `/analytics/overview` has no access to the registry at
all — see §10.

## 9. WebSocket ownership and subscriptions

`frontend/src/lib/krakenSocket.ts` owns exactly one shared connection for
the whole app.

- One `WebSocket` per browser tab, shared by every consumer; `ensureConnected`
  refuses to open a second while one is connecting or open.
- Subscriptions are reference-counted per pair: a `subscribe` frame is sent
  only for the first listener of a pair, and `unsubscribe` only when the
  last one leaves. Switching BTC → ETH → SOL → BTC leaves no orphaned
  subscription.
- On reconnect, every active pair is resubscribed from the listener maps —
  and cached book state is cleared, so a book is never rendered from
  pre-disconnect deltas while waiting for the fresh snapshot.
- Reconnect uses jittered backoff (1 s, ×1.5, capped at 15 s), guarded by a
  single timer so a burst of close events cannot schedule several
  reconnects.
- Book deltas are coalesced and flushed at 300 ms; snapshots flush
  immediately so a pair switch paints at once.

### Server-side fan-out: NOT implemented, and why

The gateway work centralized every REST path. It did **not** move the
WebSocket behind VOLTEX, and this section records exactly why rather than
leaving the gap implied.

**The blocker is that there is no backend WebSocket infrastructure to
extend.** Not "a limited one" — none:

- `package.json` has no `ws`, no `socket.io`, no WebSocket dependency.
- `src/index.ts` ends at `app.listen(PORT)`. There is no
  `http.createServer`, so there is nothing an `upgrade` handler could
  attach to.
- `frontend/nginx.conf` has no `Upgrade`/`Connection` proxy headers and
  does not proxy `/api` at all; the frontend reaches the API by absolute
  URL.
- `render.yaml` declares no WebSocket configuration.

Building it means a new production dependency, replacing the HTTP server
bootstrap that every route currently hangs off, and proxy configuration
that **cannot be verified from this sandbox** (its egress proxy denies
CONNECT to every provider — see §16). Shipping an unverifiable rewrite of
the server bootstrap alongside a market-data refactor would put Spot
execution and the internal order book at risk for no measured benefit at
the current scale.

At ~100 simultaneous users the present cost is ~100 upstream Kraken
subscriptions for identical data. That is real, and it is the right next
piece of work — but as its own task, with its own verification.

**The interface it should implement**, so the migration is a substitution
rather than a redesign:

```
Kraken public WS
      ↓  ONE pooled backend connection
MarketStreamHub          refcounted per-symbol upstream subscriptions
      ↓  normalized shared state (the existing BookSnapshot/LiveTrade types)
VOLTEX WS fan-out        per-connection limits · backpressure · heartbeat
      ↓
many VOLTEX clients
```

`frontend/src/lib/krakenSocket.ts` already implements the client half of
exactly this contract — shared connection, reference-counted per-pair
subscribe/unsubscribe, resubscribe on reconnect, cached book state cleared
on disconnect, jittered reconnect backoff. Migration is therefore: build
`MarketStreamHub` server-side with the same semantics, add the upgrade
handler and proxy config, then repoint `krakenSocket`'s URL and frame
codec. No consumer component changes.

Until then the browser talks to Kraken directly. It carries no secret and
degrades honestly through `ConnectionBanner` (visible in the QA
screenshots, where the sandbox blocks the socket and the terminal falls
back to the REST book).

## 10. Analytics: what is real

`GET /api/v1/analytics/overview` — **admin only** (`requireAuth` +
`requireAdmin`, the same gate `/analytics` uses on the frontend via
`useAdminGate`). Each section is either `available: true` with real values
or `available: false` with a machine-readable `reason`.

**Supported today**

| Section | Source | Scope |
|---|---|---|
| `marketOverview` — total market cap, total 24h volume, BTC and ETH dominance, 24h market-cap change | CoinGecko `/global`, **through the gateway** | market-wide |
| `sentiment` — Fear & Greed value + classification | alternative.me, **through the gateway** | market-wide |
| `derivatives` — per listed contract: mark price, index price, open interest (base + USD), latest settled funding rate, funding interval, next settlement boundary | VOLTEX's own `MarkPriceService`, open positions and `FundingRateRecord` | **`scope: 'venue'`** |
| `contracts` — the contracts this exchange actually lists | `FuturesMarketRegistry` | VOLTEX |

Every section is the shared `Availability<T>` (§2): `available: true` with
a value, a `source` and a `fetchedAt`, or `available: false` with a reason
and no value-carrying fields. Each contract's fields are **independently
nullable** — a contract that has never settled funding reports
`fundingRate: null`, which renders as a dash. It does not report `0`,
which would read as "funding is flat".

`AnalyticsDataService` **constructs no provider client of its own.**
Market-wide figures come through `MarketDataGateway`, so they are the same
cached reads `/markets` already makes: opening Analytics costs no
additional upstream request. VOLTEX's own derivatives state deliberately
does NOT go through the gateway — the gateway serves reference data about
the outside world, and keeping the two on separate paths is what stops an
external venue's number ever standing in for one of ours (§15).

### Access

| Endpoint | Who | Why |
|---|---|---|
| `GET /analytics/overview` | any signed-in user | Ordinary exchange market information. Every figure in it is already visible on `/markets` or the futures terminal. |
| `GET /analytics/diagnostics` | **admin only** | Provider circuit state, consecutive failures, cooldowns, rate-limit hits. |
| `GET /market/status` | **admin only** | The same operational data, plus the capability table and catalogue size. |

Analytics was admin-gated until Analytics Live V1, for two reasons: the
page was an empty admin placeholder, and its payload carried provider
health. Neither is true now, so the gate moved to where the sensitive data
actually is rather than being dropped. The split is **structural**:
`getSnapshot()` has no reference to the health registry at all, so it is
not a field filter a later edit could quietly widen.

## 10a. Analytics Phase 2: the source matrix

Every Analytics metric, what it is, where it comes from and what it is
NOT. A metric may only appear on the page if it has a row here.

| Metric | Definition | Provider / venue | Endpoint family | TTL | Stale budget | Derived? |
|---|---|---|---|---|---|---|
| VOLTEX open interest | This exchange's own open positions, base units | VOLTEX | `FuturesPosition` aggregate | per request | — | no |
| VOLTEX funding | This exchange's last SETTLED interval | VOLTEX | `FundingRateRecord` | per request | — | no |
| VOLTEX mark / index | What the futures engine prices PnL and liquidation off | VOLTEX | `MarkPriceService` | per request | — | no |
| Tracked-venue open interest | Sum over the venues that answered — **not market-wide** | Binance, OKX | `GET /fapi/v1/openInterest`, `GET /api/v5/public/open-interest` | 15 s | 120 s | no (USD notional priced at each venue's own mark) |
| External funding | Each venue's current perpetual funding rate | Binance, OKX | `GET /fapi/v1/premiumIndex`, `GET /api/v5/public/funding-rate` | 30 s / 60 s | 300 s / 600 s | no |
| Long/short positioning | Three distinct Binance measures, never merged | Binance only | `GET /futures/data/{global,top}LongShort{Account,Position}Ratio`, `period=5m` | 60 s | 600 s | no |
| Perpetual premium (basis) | `(mark − index) / index × 100`, per venue, against that venue's own index | Binance, OKX | `premiumIndex`; `mark-price` + `market/index-tickers` | 30 s / 15 s | 300 s / 120 s | **yes** — formula above |
| Realized volatility | `stddev(ln(cₜ/cₜ₋₁)) × √(24×365) × 100`, windows 24h / 7d / 30d | Derived from Kraken OHLC | gateway `getCandles('1h', 720)` | inherits the candle cache | inherits | **yes** |
| Crypto correlations | Pearson correlation of hourly log returns, 720h lookback | Derived from Kraken OHLC | gateway `getCandles('1h', 720)` | inherits | inherits | **yes** |
| Sector rotation | 24h return per CoinGecko category, cap-weighted where every contributor reports a cap, else equal | Derived from CoinGecko catalogue | `CoinGeckoService.getRankingsWithMeta()` | 20 min (catalogue) | 24 h | **yes** |

### Limitations that travel with these numbers

- **Tracked venues are not the market.** Binance plus OKX is a large share
  of perpetual open interest and is not a market-wide aggregate. No free
  provider supplies a genuine one, so none is claimed — the payload names
  its contributors and the UI label is built from that list.
- **Positioning is Binance's, and its three measures are different
  things.** Global account ratio counts ALL accounts; top-account ratio
  counts the top accounts; top-position ratio is size-weighted over those
  accounts' position value. They are never averaged into one figure and
  never described as a market-wide crypto long/short ratio.
- **Realized is not implied.** Everything above is computed from prices
  that already happened. Implied volatility needs an options surface and
  stays unavailable.
- **Basis is not a term structure.** These are perpetuals. A curve needs
  dated contracts across expiries.
- **Correlation is crypto-only.** Equities, gold and oil are not
  integrated, so the module is labelled Crypto Correlation.
- **Minimum observations are enforced, not smoothed.** A volatility window
  with too few real returns reports `null` and its sample count; a
  correlation pair below the overlap minimum is omitted. Neither is
  extrapolated and neither becomes 0.
- **Sector weighting is stated per sector.** A constituent with no reported
  24h return is EXCLUDED from both the figure and the count rather than
  folded in as 0%.

### Partial-venue behaviour

Binance up and OKX down produces a value built from Binance alone, with
`venues` naming Binance alone. Both down is `available: false`, not an
empty aggregate. The contributor list is consumed by logs, admin
diagnostics and the test suite; since §17 it is not rendered anywhere in
the customer-facing UI, so the class of bug it guarded against — a label
still claiming a venue that contributed nothing — is now structurally
impossible on screen. Verified in a real browser at 1440 (see
`outputs/analytics-phase2/` and `outputs/no-provider-branding/`).

### Production verification required

The sandbox's egress proxy answers **403 to CONNECT** for
`fapi.binance.com`, `www.okx.com`, `api.kraken.com` and
`api.coingecko.com`, so **no live provider call was made and no live
verification is claimed.** All coverage is deterministic mocked tests plus
fixture-backed browser QA. These endpoint families must be exercised once
from Render, where the egress and the region are different:

1. `GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`
2. `GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT`
3. `GET https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`
4. `GET https://fapi.binance.com/futures/data/topLongShortAccountRatio?...`
5. `GET https://fapi.binance.com/futures/data/topLongShortPositionRatio?...`
6. `GET https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP`
7. `GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`
8. `GET https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP`
9. `GET https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT`
10. `GET https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT` — confirm `quoteVolume` is the USDT-denominated 24 h turnover
11. `GET https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP` — confirm `volCcyQuote24h` is present and quote-denominated, and that `volCcy24h` is the BASE amount the adapter refuses to use

What to confirm: the response field names used by the adapters, that no
region block applies from Render's egress, and the real rate-limit headers
(the TTLs above were chosen conservatively and may be relaxed once the
published limits are confirmed against actual traffic). `GET
/analytics/diagnostics` (admin) reports each venue's circuit state and is
the fastest way to see whether a venue is answering in production.

### Providers deliberately NOT integrated

No paid provider is used, required, or recommended, and none is needed for
anything on the page. Recorded here only so the gaps are legible:

| Module | Why it is unavailable |
|---|---|
| Recent liquidations | Binance's public liquidation REST endpoint (`/fapi/v1/allForceOrders`) is retired and no longer accepts requests; its remaining public feed is the `!forceOrder@arr` WebSocket stream, and this backend has no server-side socket infrastructure to consume it (§9). No verified free REST source. |
| Liquidation heatmap | Needs an aggregated position/liquidation-map dataset. Observed events are not a heatmap and are never extrapolated into one. |
| Implied volatility | Needs an options surface. |
| Futures term structure | Needs dated futures quotes across expiries. |
| ETF flows | Needs a creation/redemption dataset. Scraping a web page is not an API and is not done. |
| Exchange inflow / outflow | Needs on-chain address attribution. Trading volume is NOT a proxy and is never used as one. |
| Whale activity | Needs labelled on-chain addresses. Large exchange trades are a different concept and are not substituted for it. |

## 10b. The Futures header's two market-reference figures

`GET /market/derivatives/:baseAsset` — the only endpoint the Futures
header reads for market data. It is deliberately NOT the Analytics
snapshot: that payload is large, per-page and rebuilt for a dashboard, and
a header polling it every 30 s would drag the whole Analytics fan-out
along for two numbers.

| Cell | Was | Is | Provider | Unit |
|---|---|---|---|---|
| `Оборот за 24ч` | Kraken SPOT `quoteVolume24h` for the underlying pair | Summed tracked-venue perpetual quote turnover | Binance `GET /fapi/v1/ticker/24hr` → `quoteVolume`; OKX `GET /api/v5/market/ticker` → `volCcyQuote24h` | USD |
| `Открытый интерес` | VOLTEX's own `FuturesPosition` aggregate | Summed tracked-venue open interest | reuses `ExternalDerivativesService.getTrackedOpenInterest` | base units, or USD notional when no venue reported base units |

**Why the old figures were wrong questions.** The header sits above a
PERPETUAL contract. Kraken's spot quote volume describes a different
market entirely, and VOLTEX's own open interest answers "how big is this
book", not "how big is this market" — which is what a header metric
labelled *Open Interest* is read as.

**OKX turnover is `volCcyQuote24h`, and only that.** On OKX SWAP tickers
`vol24h` is contract count and `volCcy24h` is a BASE amount — not the
USD-equivalent some third-party summaries describe. Reading `volCcy24h`
would have published a BTC turnover of a few thousand dollars where the
real figure is billions. When `volCcyQuote24h` is absent the venue's
turnover is `null`; no conversion is invented from another venue's price.

**Units are never mixed.** Open interest sums base units only across the
venues that reported base units. If none did, it falls back to the USD
notional **and relabels the cell**, so the unit on screen is always the
unit of the number. A venue contributing to one metric is not credited on
the other: `turnoverVenues`, `openInterestBaseVenues` and
`openInterestUsdVenues` are three separate lists. Since §17 none of them
is rendered: the header shows the figure and its unit and names no venue.
The lists stay in the response for logs, admin diagnostics and tests.

**Load.** Server-side `ProviderCache` with a 30 s TTL and in-flight
deduplication; the frontend polls at 30 s, not the 4 s VOLTEX cadence,
because a rolling 24 h turnover does not move on that timescale. 100
concurrent header readers collapse to 5 upstream provider requests
(Binance `openInterest` + `premiumIndex` + `ticker/24hr`, OKX
`open-interest` + `ticker`), proven in
`ExternalDerivatives.test.ts`; a second wave inside the TTL adds zero.

**Outage is a dash.** An unavailable section carries no value-carrying
fields at all, so there is no path from "OKX is down" to "$0 turnover".
Symbol switching
clears the previous contract's figures before the new read lands, so BTC's
turnover can never sit under an ETH header.

## 11. Analytics: deliberately unsupported

Returned in the snapshot's `unsupported` map as
`available: false, reason: 'unsupported_metric'` with an explanation, and
**no value-carrying fields at all** so nothing can be plotted as zero. The
UI renders each as a compact "no source connected" row, which reserves the
module's place in the information architecture without pretending to be a
chart that failed to load.

| Module | What it would need |
|---|---|
| `liquidations` | A cross-venue liquidation feed. This venue records its own liquidations only. |
| `liquidationHeatmap` | Cross-venue liquidation observations. |
| `marketWideOpenInterest` | A derivatives aggregator; only this venue's own OI exists. |
| `longShortRatio` | Per-venue account positioning no provider exposes. |
| `etfFlows` | A dedicated vendor. |
| `exchangeFlows` | On-chain attribution data. |
| `whaleActivity` | Labelled on-chain address data. |
| `volatility` | A retained historical series this system does not yet keep. |
| `futuresBasis` | Dated futures quotes; this venue lists perpetuals only. |
| `correlations` | Equity and commodity series from a vendor. |
| `sectorRotation` | A sector-classified index series. |

Each would require a new paid or key-bearing provider. None is faked, and
none is scraped.

### The liquidity map, and what was left out

The archived Analytics branch (`origin/codex/analytics-v0-refine`) contains
a genuinely good liquidation/liquidity-map module: a bucketed histogram,
dual cumulative curves, wall/cluster/void classification, nearest-wall and
void distances, a ranked-zone table and a weighted cascade-risk score.

**Its data was entirely synthetic.** `liquidityModel.ts` generated the
whole market from a seeded PRNG over hardcoded prices (`BTC: 68420`) and
per-asset feature tables, behind a "Демонстрационный режим" checkbox.

None of that generator shipped. The module's SLOT is present — titled,
placed, and holding a compact unavailable state — so a real feed plugs
into the same position later. What is absent is any code path that could
produce a number for it. `frontend/src/lib/__tests__/analyticsLive.test.ts`
asserts that absence directly against the shipped source: no
`buildLiquidityModel`, no `cascadeRisk`, no `makeRng`/`hashSeed`, no
`Math.random`, no demo toggle, and no hardcoded market figures anywhere in
the Analytics sources.

### Frontend cadence

Analytics polls its single dataset on ONE timer at 30s
(`frontend/src/pages/analytics/analyticsStore.ts`), reference-counted and
cleaned up on unmount, with in-flight coalescing — the same shape as
`lib/marketDataStore`. There is no per-card polling: the workspace's only
`setInterval` drives the funding countdown clock and reaches no fetch.
30s rather than the ticker store's 3-5s because every figure behind it is
slow-moving (CoinGecko `/global` is cached 5 minutes server-side, Fear &
Greed is republished daily, funding settles on an 8-hour boundary).

## 12. Adding a provider safely

1. Confirm the gap is real: what exactly cannot be answered by Kraken,
   CoinGecko or VOLTEX's own book?
2. Confirm a legitimate documented API exists — **no scraping**, of
   CoinGlass, exchange sites, or anything else.
3. Add an adapter under `src/services/`, constructed with its own
   `ProviderHealth` (registered in `providerHealthRegistry`) and its own
   `HttpProviderClient`.
4. Give every cached resource a `ProviderCache` with an explicit TTL, a
   staleness budget matching how much an old value could mislead, and an
   entry bound.
5. Keep the response shape provider-neutral; the frontend must not learn
   the provider's field names.
6. Any key goes in an env var, documented in `.env.example` with no live
   value, read only on the server, and never logged.
7. Add deterministic tests with a mocked fetch. Unit tests never hit a real
   API.
8. Add a `CapabilityBinding` in `MarketDataGateway` and route the
   capability to it. The `/market/status` table and this document are
   generated from that list, so they cannot drift.
9. Record the metric in §10 or §11 of this document.

### A future Stocks adapter (NOT implemented)

Stocks are out of scope and nothing here anticipates them beyond keeping
the extension point honest. The gateway's shape means an adapter would
plug in without touching a consumer:

1. `StockMarketDataService` under `src/services/`, with its own
   `ProviderHealth`, `HttpProviderClient` and `ProviderCache`, normalizing
   to the existing `MarketTicker`/`MarketCandle` contracts.
2. `'stocks'` added to `DataSource`, so a share price can never be mistaken
   for a crypto price in a payload.
3. New capabilities (`stock_quote`, `stock_candles`) bound to it in
   `CAPABILITY_BINDINGS`. Deliberately separate capability names, not a
   widening of `ticker`: a stock is not a crypto pair and a caller should
   have to say which it wants.
4. A separate instrument catalogue keyed on a real security identifier
   (ISIN/FIGI), not a symbol — the ticker-collision problem is *worse* for
   equities, where the same ticker legitimately means different companies
   on different exchanges. `AssetRegistry`'s namespaced-id pattern applies
   directly.
5. Tradability stays a VOLTEX decision, exactly as for crypto: appearing in
   a catalogue must never imply an executable market.

Market hours, corporate actions and settlement have no analogue in the
current system and would need their own design. None of that is started.

## 13. Request-load impact

Modelled on one visitor doing: Homepage → Markets → BTC Trade → ETH Trade →
SOL Trade → BTC Trade → Futures → Markets.

The dominant change is not the single-visitor path (the old per-type TTL
caches already covered much of it) but **concurrency and repeat
navigation**:

- **Concurrent visitors on a cold cache**: previously *N* visitors ×
  (rankings walk = 9 CoinGecko calls) = 9N; now 10 total regardless of *N*
  (3 market pages + 7 category endpoints), and after the first 20 minutes
  only the 3 market pages recur — the 7 category calls are on a 6-hour
  clock. 100 concurrent catalogue consumers produce those same 10 calls;
  100 concurrent searches produce none, because search never leaves the
  browser.
  The same collapse applies to `/global`, Fear & Greed, order books,
  candles and trades — everything except the ticker walk, which already
  deduplicated.
- **Returning to a previously viewed chart**: previously a full ~720-candle
  OHLC download per pair per 5 s window; now a `since` tail of one or two
  candles. Over the eight-step navigation above, that is 4 full candle
  downloads before (BTC, ETH, SOL, BTC-again) versus 3 full + 1 tail after —
  and every subsequent revisit within the 10-minute stale budget is a tail,
  not a download.
- **During a provider incident**: previously every request went out and
  failed, indefinitely. Now 4 consecutive failures open the circuit and
  outbound requests stop entirely for 30 s at a time (doubling to 5 min)
  while cached data continues to serve — the difference between a bounded
  handful of requests per minute and one per user action.

Exact figures depend on traffic; the structural claims above are what the
tests assert.

## 14. Known limitations

- **Freshness reaches the client only through the gateway endpoints.**
  `/market/snapshot`, `/market/assets` and `/market/ticker/:pair` carry
  `source`/`fetchedAt`/`stale`. The pre-existing `/market/external/*`
  routes still return their original shapes, unchanged on purpose —
  shipped surfaces depend on them. They should be retired as consumers
  finish migrating, not changed underneath them.
- **The catalogue ceiling is 750, and it is a budget decision.** Three
  CoinGecko pages of 250. A ticker collision or a malformed row means the
  walk yields slightly under 750 canonical assets, which is why the ceiling
  is not 500 for a "500+" requirement. Raising it means a fourth page and a
  fourth of the monthly call budget — redo the arithmetic in §3 first.
- **The Markets table ships the whole catalogue to the browser.** ~750 rows
  of JSON on one request, then everything is client-side. That is the right
  trade at this size — instant search, zero per-keystroke load — but it
  does not scale indefinitely. Past a few thousand assets the query belongs
  back on the server (`AssetRegistry.query` already implements it and
  `/market/assets` already exposes it; only `catalogueStore` would change).
- **No sparkline in the catalogue payload.** Deliberate — see §3b. A
  future sparkline column needs its own endpoint and its own budget, not a
  field on this one.
- **`market_overview` and `sentiment` report their read time, not their
  fetch time.** `CoinGeckoService` and `FearGreedService` own those caches
  internally and do not expose a fetch timestamp, so the gateway stamps
  `fetchedAt: Date.now()` and never marks them `stale`. The value is at
  most one TTL old by construction (5 min / 15 min), but a stale serve
  inside those services is invisible from outside. Giving them
  `*WithMeta` accessors — as `KrakenMarketDataService` and
  `CfdMarketDataService` now have — closes this.
- **The browser talks to Kraken's WebSocket directly.** Moving it behind
  VOLTEX would need a production WS proxy (fan-out, backpressure,
  per-connection limits) — out of scope here, and the current path has no
  secret to leak and degrades honestly via `ConnectionBanner`.
- **Provider health is per-process.** On a single Render instance that is
  exactly right; if the backend is ever scaled horizontally, each instance
  will keep its own circuit and cache.
- **Candle tail-merge trusts Kraken's `since` semantics.** A provider that
  silently changed that contract would be caught by the 500-candle gap
  fallback, but not instantly.
- **No live-API verification from this sandbox.** Its outbound proxy blocks
  Kraken/CoinGecko/alternative.me, so provider behaviour is covered by
  deterministic mocked tests only — the same caveat the services already
  carried.

## 15. Reference market data vs VOLTEX execution and risk data

The single most important boundary in this system, and the reason
`DataSource` exists.

**VOLTEX financial values.** Mark price, index price, funding rate and
settlement, open interest, position state, margin, leverage, liquidation
price, PnL, balances. These are computed by the futures/CFD/spot services
against **VOLTEX's own book and VOLTEX's own positions**. They are the
numbers a user's money actually depends on.

**Reference market data.** Everything the gateway serves: what prices are
elsewhere, what the total market cap is, what an external venue reports.

Rules, in force and enforced by types:

1. **Reference data never enters a VOLTEX financial calculation.** Nothing
   in `MarketDataGateway` is reachable from margin, liquidation, funding
   settlement, matching or PnL. The one legitimate crossing is the *index
   price*: `MarkPriceService` reads Kraken spot as the index and adds a
   smoothed basis from VOLTEX's own book. That path predates this work,
   is unchanged, and is deliberate — a mark price built only from an
   internal book can be wicked to trigger liquidations.
2. **An external venue's derivatives metric is that venue's metric.**
   Binance open interest is Binance's. It is labelled with its
   `DataSource` and must **never** substitute for a VOLTEX financial
   value. The Futures header now shows tracked-venue turnover and open
   interest in its two MARKET-reference cells (§10b), unattributed on
   screen per §17 and attributed in the payload. VOLTEX's own
   open interest did not move: `GET /futures/open-interest/:symbol`, the
   `FuturesPosition` aggregate behind it and the Analytics VOLTEX section
   are unchanged; the header simply stopped answering a question about
   the market with a number about this book.
3. **Fallback is for availability, never for evasion.** A secondary
   provider may serve a metric only when it is *semantically equivalent*,
   and the `source` must change with it. Fallback must never be used to
   work around a rate limit or a geographic block, and history must never
   be stitched across venues — a candle series carries one provider's
   identity for its whole length. Averaging venues into a synthetic
   "VOLTEX price" is prohibited outright.
4. **No configured fallback exists today.** Each capability has exactly one
   provider (§3a). When one is down its section is `available: false`.

## 16. Live provider verification

**Not performed.** The sandbox this was built in denies outbound CONNECT to
every provider at the proxy — `api.kraken.com`, `api.coingecko.com`,
`api.alternative.me`, `api.twelvedata.com`, `api.binance.com` and
`www.okx.com` all return a 403 policy denial, and `wss://ws.kraken.com/v2`
is blocked the same way.

Provider behaviour is therefore covered by **deterministic mocked tests
only** — the same caveat every provider service in this repository has
always carried. No test in this repository contacts a real provider, by
design.

What that means for review: the retry, Retry-After, circuit-breaker,
stale-serve and deduplication behaviour is proven against mocked responses
that reproduce each failure mode exactly (`ProviderFailureMatrix.test.ts`),
but the assumption that a given provider *emits* those responses is
unverified from here. The Twelve Data credit accounting in particular is
read from its published documentation, not measured.

## 17. No provider branding in the customer-facing UI

**Rule.** The VOLTEX product surface names no upstream provider or outside
venue. Not "Binance", not "OKX", not "Kraken", not "CoinGecko", not
"Twelve Data", not "Alternative.me", and not the wording that implied
them — "tracked venue", "external venue", "external exchanges", "data
source connected".

**Where provenance still lives, unchanged.** This is a presentation rule,
not a data-contract change. Every `source`, `venues`, `turnoverVenues`,
`openInterestBaseVenues`, `openInterestUsdVenues` and `VenueAttribution`
field is still populated, still typed, still asserted by the test suite,
and still returned over the API. `GET /analytics/diagnostics` (admin)
still reports each venue by name with its circuit state. Server logs are
untouched. Nothing about attribution was deleted — it stops at the
network boundary instead of reaching the screen.

**What changed on screen.**

| Surface | Before | After |
|---|---|---|
| Futures header | `Оборот за 24ч (USD)` + `Рыночные данные: Binance + OKX` under each figure | `Оборот за 24ч (USDT)` / `Открытый интерес (BTC)`, value only |
| Analytics module meta | `CoinGecko · updated 12s ago` | `updated 12s ago` (`SourceTag` → `FreshnessTag`) |
| Analytics open interest | aggregate + one row per named venue | aggregate only |
| Analytics funding, basis | one row per named venue | a min–max **range** across the readings |
| Analytics positioning | `Tracked venues: Binance`, note "Binance statistics…" | no scope chip; note "Reference positioning statistics…" |
| Markets catalogue | `Market data · CoinGecko · 20s ago` | `Market data · 20s ago` |
| Arbitrage rows | venue name above each price | price only |

**Why ranges rather than anonymous rows.** A funding rate without the name
of the venue charging it is not information, and relabelling those rows
"Venue A / Venue B" would be obfuscation rather than removal. The
dispersion of the readings is real, needs no attribution, and is what
survives honestly — so the modules report a min–max range. Deliberately
NOT an average: an average of two venues' funding is not a rate anyone
can be charged, which §10a already prohibited.

**What the honesty rules still guarantee.** Removing the labels did not
weaken any claim the earlier phases made. The aggregate open interest
still says in words that it is *not the whole market*. The positioning
note still says it is *not a market-wide long/short ratio*. An outage is
still a dash and never a zero. Units are still never mixed: the Futures
open-interest cell relabels itself to the quote currency when no venue
reports base units.

**One leak no string edit can close.** The browser still opens
`wss://ws.kraken.com/v2` directly for the live spot feed, so the upstream
is visible in devtools' network panel to anyone who looks. Closing that
needs the server-side WebSocket fan-out recorded as not implemented in
§9 — it is an architecture change, not a copy change, and it is out of
scope here. Flagged rather than silently left unmentioned.

**Deliberately NOT removed.** Product copy that merely contains a banned
word without exposing infrastructure: KYC's "Under review" /
"Submit for review", the withdrawal "sent after review" notice, Copy
Trading's "Review their stats", the `/demo/*` API paths of the demo-
trading feature, and the country name "Демократическая Республика Конго".
Generic words like "exchange" and "market" are not provider names and
were left alone. Source comments and this document still name providers —
they are engineering references, not the product surface.
