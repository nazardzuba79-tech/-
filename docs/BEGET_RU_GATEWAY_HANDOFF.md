# VOLTEX — Beget Russian-entry verification handoff (2026-10-26)

## Scope and safety

Goal: reuse the **existing** Beget resource as a narrowly scoped Russian access gateway **without relocating** VOLTEX. Main Pages, Hetzner API + PostgreSQL, Cloudflare Workers, and all trading logic remain unchanged. No costs, DNS, Beget config, production deployment, database writes or `main` merge are approved by this branch.

**Evidence boundary:** Only an authorized Beget account settings page and its payment page were readable in the Chat-mode browser side panel on 2026-10-26; both showed a funded account. Neither page lists active sites, DNS zone records, Nginx/Apache state, VPS inventory, SSL, or server IP. The browser connection in Chat mode is read-only, so no panel navigation/writes/SSH or server deployment occurred. Do **not** infer that a working gateway exists.

Verified repo baseline: `main` at `63d6b02cd38fe9ff52742c35ce46fa327827dd33` (2026-10-25). No indexed GitHub code search result for `beget` and no PR/issue title matching Beget at that snapshot. `AGENTS.md` names `integration/claude-codex`, but that branch returned 404 on the checked repository; this isolated branch was made directly from verified `main` instead.

## Concrete frontend dependencies found in source

| Source | Browser dependency | Consequence for a new Russian entry host |
|---|---|---|
| `frontend/src/lib/api.ts` | `VITE_API_URL || '/api/v1'` | A separately compiled same-origin build can use `/api/v1`; an existing production bundle with an absolute API origin may still leak to the browser |
| `frontend/src/lib/marketEdge.ts` | Default `https://market.voltextech.net`, override `VITE_MARKET_EDGE_URL` **at build time** | A Beget gateway must offer an explicit Workers path or supply a separately built origin; serving the current JS unchanged does not reroute it |
| `frontend/src/lib/useLiveMarket.ts` | Cloudflare Worker host for `*.voltextech.net`, otherwise API base for market SSE | On a different domain, SSE may hit a different API route unless deliberately tested |
| `frontend/src/lib/krakenSocket.ts` | Browser `wss://ws.kraken.com/v2` | Direct browser socket remains a separate network dependency |
| `frontend/src/lib/futuresDepth.ts` | Browser `wss://stream.bybit.com/v5/public/linear` | Fallback is polled and must show real/stale/unavailable values, not a fabricated live book |
| `frontend/src/lib/directFuturesReference.ts` | Bybit/bytick REST then hardcoded market Worker | New-origin access is not solved by proxying HTML alone |
| `frontend/src/lib/futuresCandles.ts` | Production-host branch uses Bybit/bytick REST + Worker fallback; other hosts use API candles | A different host must be tested for fidelity of chart endpoints |
| `src/services/TelegramNotifications.ts` | Server-side `https://notify.voltextech.net` | Check whether any actual **browser** dependency exists before routing; do not expose server-only notification operations |
| `workers/kyc-edge/wrangler.toml` | Allowed Origins list is explicit | New origin may fail cross-origin/session/KYC flows. Do not spoof Origin headers as a substitute for reviewed CORS/CSRF configuration |

This is a targeted source map, **not** a complete audit of all lazy bundles/third-party resources.

## Preflight tool

Run from a known network only after an actual existing gateway URL is established:

```bash
node scripts/qa-beget-ru-preflight.mjs https://EXISTING-RU-ENTRY-FQDN
```

This performs only public GETs to the gateway's homepage, login/trade/futures deep links, `/api/v1/pairs`, `/market/listings`, and initial JS/CSS assets. It reports hardcoded external host hints in the directly referenced assets. A failing probe may mean either an unconfigured route or a changed application endpoint; investigate instead of declaring success or modifying trading services. Never attach account cookies, JWTs, API keys, or log full request bodies.

## Deployment gate (no changes executed here)

1. From Beget hosting/sites/DNS/SSL pages determine the **existing** service type (shared hosting vs VPS), host/IP, domain and current rules. Save a redacted snapshot and back up the actual configuration before edits. VPS provides root control; shared hosting does not automatically grant permission to edit global Nginx.
2. Verify provider policy and whether the existing service has reverse-proxy + WebSocket upgrade support. Do not purchase a VPS, IP or domain without a separate business decision.
3. Design a **closed allowlist**, not an open proxy: own frontend origin; `/api/v1/` to existing API; only required `/market/` display/listing paths to Worker; notification path only if genuine browser need is found. Validate upstream Host, SNI, TLS, forwarded client IP and Origin/CSRF behavior. Financial routes remain authorized by the API.
4. Pick an integration route only after mapping client bundles: a separately built RU frontend with appropriate existing compile-time flags **or** a rigorously validated content/routing gateway. Blind string rewriting of hashed minified JS is not a reliable release strategy.
5. Before applying, test HTTPS and DNS, API authorization/refresh/logout, SSE, direct-vs-fallback WS, Spot, Futures, Wallet, Markets, Copy Trading, F5, 390/1440 px, actual browser DevTools requests and regression on original `voltextech.net`. Do not execute financial transactions.
6. Use at least two distinct real RF ISP probes **without VPN** where available, record dates and ASNs, and separate availability evidence by provider. A European server pass is not Russian evidence.
7. Use atomic Nginx config rollout (`nginx -t`, reload), immediate smoke tests, and rollback to saved config on failure. Preserve original Pages/Hetzner/Worker and all finance flags.

## Confirmed blockers at time of handoff

- Existing Beget server/site/domain/IP, current reverse proxy configuration, SSL and plan cost were **not visible from the two available browser pages**.
- No authenticated Beget configuration write/SSH mechanism exists in Chat-mode tools. Use ChatGPT **Work mode** for browser panel interaction, or an explicitly authorized terminal integration.
- No real Russian probe or verified entry URL was available. Geographic accessibility, function coverage, maintenance cost, and upstream policy/legal compatibility therefore remain **unverified**.
