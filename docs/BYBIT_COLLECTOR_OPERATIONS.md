# Live reference collector: deployment preparation

This change is prepared for review only. No service has been deployed and no production environment variable has been changed.

## Topology and region

Run one standalone collector in **Render Frankfurt**. The existing exchange API stays in Oregon and connects to the collector's HTTPS origin. Render services in different regions do not share a private network; use its HTTPS service URL with the shared bearer secret. Do not point Oregon directly at the Bybit public WS feeds. Bybit regional refusal is a provider failure, not an invitation to rotate hosts or proxies.

The collector uses the repository's `BybitMarketDataService`, `MarketUniverse`, `ProviderCache`, `HttpProviderClient` and `ProviderHealth`. There is no Redis, database, migration, trading API key, account secret or new cache framework. `LiveFeed` and `BybitTickerBook` hold streaming state rather than duplicating REST caches.

## Exact standalone settings

| Setting | Value |
| --- | --- |
| Service type | Render web service, Docker runtime |
| Region | Frankfurt |
| Repository root / Docker context | `.` |
| Dockerfile | `Dockerfile.market-data` |
| Build | Dockerfile runs `npm ci --ignore-scripts` and `npx tsc -p tsconfig.collector.json` |
| Start | `node dist/marketDataCollector.js` (Docker CMD) |
| Listener | `0.0.0.0`, `PORT` supplied by Render; default `10000` |
| Health path | `/health` |
| Required secret | `MARKET_DATA_COLLECTOR_TOKEN`, generated outside the repository and supplied at runtime |
| Optional endpoint overrides | `BYBIT_REST_URL`, `BYBIT_SPOT_WS_URL`, `BYBIT_LINEAR_WS_URL` |
| Default REST | `https://api.bybit.com` |
| Default spot WS | `wss://stream.bybit.com/v5/public/spot` |
| Default linear WS | `wss://stream.bybit.com/v5/public/linear` |

Do not set `DATABASE_URL`, `DIRECT_URL`, exchange JWT keys, wallet keys, or provider trading keys. The collector entry does not load `.env` files. The Docker build and start commands do not run Prisma generation or migrations. The container runs as the unprivileged Node user. No Render Blueprint or existing deployment configuration was modified.

The Dockerfile reuses the locked root dependency set, so the image contains some unused packages; runtime imports are limited to the collector graph. An image-size reduction can use a dedicated package lock later. Docker is unavailable in the development environment: the dedicated TypeScript graph was compiled, but the image itself was not built here.

For a later, separately approved API configuration change, set **both**:

- `MARKET_DATA_COLLECTOR_URL`: collector HTTPS origin, with no credentials, query or fragment.
- `MARKET_DATA_COLLECTOR_TOKEN`: exactly the same runtime secret as the collector.

If either is missing, the connector is disabled. Invalid URLs are rejected without logging the URL or token. HTTP is accepted only on loopback for tests. Redirects are not followed with the secret. No collector secret is exposed to browser code or SSE.

## Endpoints and transport

- `GET /health`: public liveness and coarse status. It remains HTTP 200 during provider outages so a region block does not trigger an automatic restart storm.
- `GET /internal/v1/snapshot`: bearer-authenticated normalized snapshot.
- `GET /internal/v1/diagnostics`: bearer-authenticated counts, connection health and provider circuit state.
- `GET /internal/v1/stream`: bearer-authenticated WebSocket. Initial snapshot, then changed-symbol batches and state heartbeats. A maximum of 32 internal connections is admitted.
- `GET /api/v1/market/live`: public VOLTEX SSE. One shared connection per browser tab, independent of component count. Snapshot first; then `delta` and `state` events. There are no replay queues. Sequence/epoch gaps trigger a fresh snapshot via reconnect.

The API connector first reads the HTTP snapshot, then gets an authoritative initial WS snapshot to close the race between the read and subscription. It owns one upstream connection per API process, not one per end user. Both streaming legs retain last-good data during disconnection and mark it stale. Backend validates normalized frames before applying them.

## Load, freshness and limits

Only `Trading` instruments become reference rows. Instrument refresh checks run every minute through the existing 15-minute provider cache. Actual listing changes rebuild subscriptions and publish a new full snapshot, removing inactive rows. A failed refresh preserves the last-good universe.

Initial bootstrap uses bulk tickers by category and all instrument pages. Linear instrument pages retain `limit=1000`. Topics are deduplicated and packed by JSON-encoded args length, capped at 21,000 characters per connection. Spot sends at most 10 topics in each subscribe request; linear sends one packed request per connection. Normal live validation required **two** provider connections.

Spot ticker WS does not publish bid/ask. A **single spot bulk REST snapshot every five seconds**, through the existing ticker cache, refreshes those supplied values. There is no per-symbol orderbook or REST fan-out. Linear receives supplied bid/ask and derivatives fields in its ticker stream. Reconnect obtains a REST snapshot through the same cache before resubscribing. Cached REST data cannot overwrite a newer WS event.

Missing delta fields preserve earlier supplied fields; missing values remain null and genuine zero stays zero. Provider event time and per-instrument sequence reject older updates. Fields not supplied in spot WS, such as REST bid/ask, retain their most recent REST observation; they are not claimed to update at the WS tick frequency. Rows without accepted updates for 30 seconds become stale. A quiet asset can therefore be conservatively labelled stale even while its connection is healthy. No stale quote is silently presented as fresh in the catalogue.

Bybit application ping runs every 20 seconds, with pong timeout and subscription-ack checks. Reconnect uses exponential backoff with jitter, a nonzero floor and a 30-second maximum. The retry exponent resets only after a stable minute, not after a short-lived handshake. Stop cancels timers/sockets and prevents late asynchronous bootstrap from reopening them.

The chosen default batch interval is **250 ms**, compared locally with 200 and 500 ms. Only dirty symbols are transmitted, as complete normalized rows (not all 500+ rows on each tick). Individual frames are capped at 20,000 rows / 16 MB at the API connector. SSE and internal WS retain no historical event backlog. Slow SSE writers receive one latest snapshot on drain; blocked clients are closed after 30 seconds. Internal WS similarly discards superseded batches and resynchronizes. Public SSE admits at most 2,000 concurrent connections per API process; capacity must be load-tested against the actual API instance before increasing traffic.

## Operational checks after an approved deployment

1. Verify `/health` is reachable, then authenticated diagnostics: loaded instrument/ticker counts, two expected connections, bounded subscription args, provider circuit healthy.
2. Check the API's single collector connection and browser SSE initial snapshot, deltas, heartbeat and stale behavior.
3. Verify reverse-proxy SSE buffering is disabled. The route sends `X-Accel-Buffering: no`, `no-cache, no-transform` and keepalive frames; cross-region proxy behavior was not tested here.
4. Disconnect the collector temporarily in a staging environment: existing polling, metadata and executable markets must remain available; restore it and confirm a new snapshot.
5. Size the service using actual RSS/CPU and ticker rate. Local fixture evidence reports the entire measurement process (provider fixture + collector + connector + frontend store), not isolated collector RAM. The live serialized ticker book was about 0.89 MB. No unmeasured production capacity or latency promise is made.

## Authoritative sources

[Bybit connection limits and heartbeat](https://bybit-exchange.github.io/docs/v5/ws/connect), [ticker snapshot/delta fields](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker), [instrument pagination](https://bybit-exchange.github.io/docs/v5/market/instrument). Runtime smoke results and deterministic measurements are in [QA evidence](qa/bybit-live-market-data/README.md).
