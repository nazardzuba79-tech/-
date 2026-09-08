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
| CoinGecko rankings | 60 min | 24 h | Costs 9 calls per refresh against a 10k/month budget; descriptive metadata, never a price. |
| CoinGecko `/global` | 5 min | 6 h | Headline market figures; a slightly old market cap beats a dash. |
| Fear & Greed | 15 min | 24 h | Republished once a day — a stale reading is usually still the current one. |
| Twelve Data CFD quotes | 60 s | 120 s | Paced to the 8-credit/minute budget. Trading-adjacent (the CFD order form prices against it), so the stale budget is short: one failed poll may be covered, a sustained outage may not. |
| Arbitrage opportunities | 10 s | 30 s | A spread past its budget is history, not an opportunity. |
| Asset catalogue (registry join) | 10 min | 6 h | A listing barely changes, and the join is the expensive part at 500 assets. |

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
> `catalogue` is ~500 assets of market-wide reference metadata. Displaying
> one costs nothing and commits VOLTEX to nothing.
>
> `tradingPairs` is the executable set, and it comes from ONE place:
> Kraken's real tradable pair list, the same list the spot terminal and the
> matching engine already work from.
>
> **Growing the catalogue to 500 assets must never grow the executable
> market set by a single pair.** An asset with `tradable: false` has no
> route to an order form, and nothing in the registry can invent one.
> `AssetRegistry.test.ts` asserts both directions.

If CoinGecko is unavailable the catalogue is built from the venue's pair
list alone: fewer assets, no logos, no ranks, `metadataComplete: false`,
`source: 'kraken'`. Degraded and labelled, never empty. If **Kraken** is
unavailable the failure propagates — a catalogue with no tradable set is
worse than none.

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
`marketDataStore.test.ts`.

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
  (rankings walk = 9 CoinGecko calls) = 9N; now 9 total regardless of *N*.
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
   Binance open interest is Binance's. If such a feed is ever added it must
   be labelled with its `DataSource` and must **never** substitute for
   VOLTEX's own — see §10 of the Futures header rules: the visible
   "Открытый интерес" block is this venue's own book, in base units, and
   an external figure would need its own unmistakably source-labelled
   block.
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
