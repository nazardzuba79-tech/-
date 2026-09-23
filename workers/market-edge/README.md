# voltex-market-edge

Cloudflare Worker (Workers Free) for **public** VOLTEX market-data fallback.

## Production design

Primary Futures display path does **not** use this Worker:

- order book + public trades: browser → Bybit public WebSocket
- candles: browser → Bybit public REST
- reference tickers: browser → Bybit public REST

The Worker is a fallback/cache for browsers or regions where direct public REST
is unavailable:

- `GET /market/display/futures-book/:symbol`
- `GET /market/display/futures-trades/:symbol`
- `GET /market/display/futures-tickers`
- `GET /market/display/futures-candles/:symbol`
- `GET /health`

The fallback never calls Render or Neon. If both public Bybit HTTP hosts reject
the Worker egress, it returns 503 rather than silently spending backend
bandwidth.

Order-book fallback snapshots are capped at 25 bids + 25 asks and cached at
Cloudflare's edge. No KV / Durable Objects / R2 are required for this phase.

## Security boundary

- Public market data only.
- Never proxy trading commands.
- Never forward cookies or `Authorization`.
- No balances / orders / positions / PnL / liquidation / ledger.
- Private trading and execution stay on the existing VOLTEX API.
- No writes to Neon.

## Domains

- custom domain: https://market.voltextech.net
- health: https://market.voltextech.net/health

## Deploy

Workflow: `.github/workflows/deploy-market-edge.yml`
Secret: `CLOUDFLARE_API_TOKEN`

A normal push verifies but does not deploy. Worker deploy runs only when an
approved branch commit contains `[deploy-market-edge]`, or via an approved
manual workflow run.

Commits on the isolated branch start with `[CF-Pages-Skip]` so the existing
Cloudflare Pages frontend is not rebuilt by Worker-only changes.


Fallback order-book recovery uses the existing collector-backed public API route only after both direct Bybit hosts fail. Normal production browser traffic never depends on this fallback.
