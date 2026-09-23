# voltex-market-edge

Cloudflare Worker (Workers Free) for future **public** VOLTEX market data
(order books, tickers, Home market data, CFD display data).

Current state: `GET /health` plus public Futures display endpoints for order book and recent trades. The book is capped at 25 bids + 25 asks and cached at the Cloudflare edge; no private/trading route is exposed.

- workers.dev: https://voltex-market-edge.nazardzuba79.workers.dev/health
- custom domain: https://market.voltextech.net/health

## Rules
- Public data only. Never proxy trading commands, never read cookies or
  `Authorization`, no balances / orders / positions / PnL / liquidation / ledger.
- Private trading stays on Render. No writes to Neon.
- No KV / Durable Objects / R2 until explicitly approved.

## Deploy
Workflow: `.github/workflows/deploy-market-edge.yml` (secret `CLOUDFLARE_API_TOKEN`).
A push alone does NOT deploy. Deploy runs only when a commit on branch
`cloudflare-market-edge` contains `[deploy-market-edge]` in its message,
or when started manually after the workflow is on the default branch.

Commits on this branch must start with `[CF-Pages-Skip]` so Cloudflare Pages
does not build them.
Test deploy: 2026-09-23 (health only, owner-approved).


Current Worker release marker: `futures-edge-v2`.
The direct venue path falls back only to VOLTEX's public display snapshot through the direct Render service origin when the venue rejects the Cloudflare egress location.
