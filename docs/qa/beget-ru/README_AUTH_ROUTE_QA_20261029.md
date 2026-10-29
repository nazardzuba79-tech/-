# VOLTEX #636 — read-only RU gateway auth route QA

This tool is intentionally **NO-AUTH / GET-ONLY**, **OFFLINE-testable**, and **NOT an Nginx configuration change**.

## Actual independent observations, 2026-10-29

- `ru.voltextech.net/api/v1/banking/state` displayed **nginx HTML 403 Forbidden** in a Cloudflare external browser. The Cloudflare Browser Rendering API returned HTTP 200 because it rendered the error page; do not confuse these.
- `ru.voltextech.net/api/v1/me` returned JSON `{ "error": "Missing bearer token" }` as the Express authentication layer requires.
- `ru.voltextech.net/api/v1/copy-trading/identities` returned public JSON `identities` for `VX-001`, `VX-KSENIA`.
- Actual Beget API: VPS `voltex-ru-gateway-01` RUNNING; Nginx present, 2 vCPU, 1GB RAM, ~2.35GB disk used. This is NOT evidence of live Nginx routing configuration or remote-Russian-ISP access without a VPN.

## Usage

From a network with permitted access:

```sh
node scripts/qa-ru-gateway-auth-contract.mjs
node --test scripts/qa-ru-gateway-auth-contract.test.mjs
```

Capture only JSON summary. All requests are unauthenticated; expected private endpoint reply is `401` JSON `Missing bearer token`. An Nginx HTML `403` is a **likely edge/route-denial**; exact root cause requires read-only `nginx -T` on the real Beget VPS and comparison with the actual Hetzner API route. Redirects aren't followed. No cookies, JWT, KYC documents, wallets or trading operations are accessed.

## Production plan (NOT performed)

1. Verify Nginx effective config, TLS termination and whether provider can alter HTML, JS or displayed deposit addresses. **Do not just open banking/financial routes on an L7-terminating untrusted proxy.**
2. Prefer dedicated TCP 443 TLS passthrough from Beget to an owner-controlled Hetzner TLS ingress **if** verified supported; keep the `ru.voltextech.net` certificate and private key exclusively off Beget. Obtain explicit approval for topology changes and verify rollback.
3. When end-to-end TLS is proven, allow the required same-origin `/api/v1` routes to Hetzner under the existing application authentication and rate limits. Keep admin, deposits' signing logic, DB, KYC secrets and wallet keys off Beget.
4. Verify with a real Russian ISP/ASN **without VPN**. Public 401 checks do NOT prove authenticated Wallet, Banking, Copy, Spot, Futures or KYC works. A separate authorized QA is needed with no financial mutations.

No DNS, TLS, Nginx, server, database, Cloudflare worker, or code deployment is authorized by this read-only test commit. No new PR needed until a reviewed gateway fix is available.
