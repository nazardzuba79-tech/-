# VOLTEX Market Data Architecture

How market data gets from an external provider into a VOLTEX page, and the
rules that keep that path cheap, honest and hard to break.

```
external providers (Kraken · CoinGecko · alternative.me)
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
service (Kraken/CoinGecko/FearGreed) — normalization lives here
        │
        ▼
VOLTEX REST API (/api/v1/market/*, /futures/*, /analytics/*)
        │
        ▼
frontend (lib/api.ts) — never talks to a provider over HTTP
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
| **VOLTEX itself** | Futures funding rates, open interest, mark/index prices, internal order books, internal candles. | — | An exchange is the only authoritative source for its own book. |

**No other provider is configured**, deliberately. Adding one is a decision
with an ongoing cost (budget, secrets, failure modes) — see §12.

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
them rather than inventing a parallel set. Freshness metadata is carried
internally by `ProviderCache` (`fetchedAt`, `stale`) rather than being
bolted onto every response shape — see §5.

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

Cache sizes: 4 entries for singleton caches (pairs, tickers), 120 for the
per-symbol ones (order books, candle series, trades). Candle series are
additionally capped at 1000 candles each. Nothing is keyed by an unbounded
client-supplied value.

**No Redis, no queue, no extra service.** All of this is in-process, sized
for one small Render instance, and dies with the process — which is correct
for data whose whole purpose is to be recent.

## 4. Request deduplication

`ProviderCache.fetch(key, loader)` keeps one in-flight promise per key.
N concurrent callers on a cold or expired key produce **one** outbound
request and all receive its result. Proven in
`src/services/marketData/__tests__/ProviderCache.test.ts` ("collapses ten
concurrent cold requests into ONE outbound load").

Before this, only Kraken's ticker walk deduplicated; order book, candles,
trades, CoinGecko rankings and Fear & Greed did not.

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

Health is exposed only through the admin-gated analytics route. It is
operational detail, not public data.

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

## 10. Analytics: what is real

`GET /api/v1/analytics/overview` — **admin only** (`requireAuth` +
`requireAdmin`, the same gate `/analytics` uses on the frontend via
`useAdminGate`). Each section is either `available: true` with real values
or `available: false` with a machine-readable `reason`.

**Supported today**

| Section | Source |
|---|---|
| `marketOverview` — total market cap, total 24h volume, BTC and ETH dominance, 24h market-cap change | CoinGecko `/global` |
| `sentiment` — Fear & Greed value + classification | alternative.me |
| `funding` — latest settled rate per listed contract, interval, next settlement boundary | VOLTEX's own `FundingRateRecord` + real configured interval |
| `openInterest` — per contract, in base units and USD, explicitly `scope: 'venue'` | VOLTEX's own open positions |
| `markPrices` — mark and index price per contract | VOLTEX `MarkPriceService` |
| `providers` — per-provider circuit state and health | `ProviderHealth` registry |

## 11. Analytics: deliberately unsupported

Returned as `available: false, reason: 'unsupported_metric'` with an
explanation, and **no value-carrying fields at all** so nothing can be
plotted as zero:

- `liquidations` — no cross-venue liquidation feed is configured.
- `longShortRatio` — needs per-venue account positioning no provider exposes.
- `marketWideOpenInterest` — needs a derivatives aggregator; only this
  venue's own OI exists.
- `etfFlows` — needs a dedicated vendor.
- `exchangeFlows` — needs on-chain attribution data.
- `whaleActivity` — needs labelled on-chain address data.

Each would require a new paid or key-bearing provider. None is faked, and
none is scraped.

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
8. Record the metric in §10 or §11 of this document.

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

- **Freshness is not yet surfaced in HTTP responses.** `ProviderCache`
  tracks `fetchedAt`/`stale` and logs stale serves, but the market routes
  still return their existing shapes unchanged (deliberately — changing
  them would break frontend contracts this task was told to preserve). A
  future change can add an `X-Data-Freshness` header or a `meta` block.
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
