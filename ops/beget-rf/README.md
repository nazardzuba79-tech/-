# VOLTEX Beget gateway — prepared, NOT deployed

Owner-authorized branch: `work/beget-rf-gateway-preflight-20261026`.
Baseline: `63d6b02cd38fe9ff52742c35ce46fa327827dd33`.
Evidence: `docs/qa/beget-rf/`. No exchange code, database or financial flag changes.

## Current blocker

The authorized Beget account is FreeHosting, balance 15,000 RUB. Its Cloud and
service-management pages return 403 in both the cloud browser and the owner's
ordinary browser. The visible “Services” page contains shared-hosting add-ons,
not VPS. Configuring the public VPS calculator (Saint Petersburg, 2 CPU, 2 GB,
30 GB NVMe, Ubuntu 24.04, IPv4) and clicking Create redirects back to FreeHosting
home; no order or VPS was created and the balance remains unchanged.

The calculator displayed 38.44 RUB/day + 5 RUB/day IPv4 = 43.44 RUB/day
(1,303.20 RUB/30 days, 1,346.64 RUB/31 days). This is a **quote, not a purchase**.
The fixed plans shown start above the owner's 1,500 RUB budget. No shared-hosting
upgrade, annual subscription, identity change or additional account was made.

Ask Beget to enable VPS ordering for the existing account/balance without buying
shared hosting. No message has been sent. Proposed support question:

> The existing funded FreeHosting account cannot open Cloud/VPS (403); the VPS
> calculator's Create action returns to FreeHosting home. How can VPS be enabled
> on this account using the existing balance, without a shared-hosting upgrade?
> We need one Ubuntu 24.04 server in Saint Petersburg, 2 CPU/2 GB/30 GB and IPv4.
> Please also confirm that a fixed-upstream HTTPS reverse proxy serving only our
> own VOLTEX application is permitted. It offers no VPN, CONNECT, arbitrary URL
> forwarding, public proxy accounts or general Internet relay.

## Provider boundary

Official sources checked 2026-10-26:

- https://beget.com/ru/cloud-rules-ru — restrictions on VPN/proxy services;
  no explicit exemption for this application topology was established.
- https://beget.com/ru/kb/how-to/vps/caddy-ustanovka-i-nastrojka-proksi-servera
  — Beget documents reverse proxying one's web application on Ubuntu 24.04.
- https://beget.com/ru/kb/manual/virtual-servers — hourly PAYG, separately billed
  IPv4, 30-day monthly display; actual calendar-month cost varies.

The generic reverse-proxy tutorial is not written approval for this specific
cross-border financial application. Resolve that ambiguity with Beget before
activating the gateway; do not bypass a provider prohibition.

## Architecture and limits

The dedicated Beget node terminates TLS for `ru.voltextech.net`; all targets are
fixed in `render.py`. Hetzner remains the only API/database authority. The
canonical frontend is read from `voltextech.net` at request time; no primary
frontend deployment or duplicate balances/users are needed.

Only HTML, JavaScript and CSS URL literals are rewritten. JSON, financial bodies,
amounts, timestamps and market payloads are not rewritten. No proxy cache,
private-response persistence or automatic upstream retry is enabled. Public
feeds and frontend requests strip Authorization/Cookie and suppress Set-Cookie.
API/KYC requests retain session credentials and are never logged with their
path, query, body or credentials.

| Browser route | Fixed upstream |
| --- | --- |
| `/api/v1/*`, `/health` | `api.voltextech.net` |
| `/_voltex/market/market/{display,listings,test-assets}*` | `market.voltextech.net` with gateway prefix removed |
| `/_voltex/market/cfd/display/*`, `/_voltex/market/health` | market Worker |
| `/_voltex/kraken/0/public/{Depth,OHLC,Trades,Ticker,AssetPairs,Time}` | Kraken public REST only |
| `/_voltex/{bybit,bytick}/v5/market/{tickers,kline,orderbook,recent-trade}` | fixed Bybit public REST hosts |
| `/_voltex/ws/kraken`, `/_voltex/ws/bybit` | fixed public WebSocket URLs |
| `/_voltex/catalogue/public/deposit-catalogue` | existing production catalogue Worker, GET only |
| `/_voltex/kyc/v1/{submit,confirm,materials}` | existing KYC Worker |
| all other ordinary GET/HEAD paths | existing primary frontend |

Market and API base URLs **must remain distinct**, because the existing client
classifies edge-owned markets by URL prefix. Market uses `/_voltex/market` rather
than sharing the API base. Numeric regex captures must not be used for upstream
paths: later method/origin regexes can overwrite them; named captures are tested.

TradingView widgets, external coin logos, social/explorer links and Cloudflare
analytics remain external. Their RF availability/usage rights were not proved.
Do not proxy third-party widgets or add fake prices to hide a failure. The native
chart transport is covered, but the real frontend bundle has not been exercised
through Beget. A public bundle download in the execution environment returned
403; source inspection is not a replacement for live browser validation.

Sessions/localStorage are origin-specific: users sign in normally at the RU
origin. Do not export tokens from the primary origin. Guest landing, existing
login, reload, logout/revocation, Spot/Futures/Markets/Wallet/Copy Trading still
require live browser verification after provisioning. Registration can be
checked with UI/validation only until a disposable test-account action is
explicitly agreed; no real account or financial write occurred here.

The upstream client-IP/trusted-proxy chain and API rate limit must be checked
read-only before activation. Beget replaces untrusted forwarded headers, but
the current Hetzner/Cloudflare chain may still rate-limit all RU users as one
address. Do not change Hetzner's proxy trust or API configuration under this work
order. Keep this as an activation blocker if the existing chain is incompatible.

## Reproduce isolated checks

Python 3 standard library, OpenSSL and Nginx with ssl/v2/sub modules are required.
Run `NGINX_BIN=/absolute/path/to/nginx python3 ops/beget-rf/test_gateway.py`.
It starts only local fixture/Nginx processes, uses synthetic credentials and a
one-day local certificate explicitly trusted by the client, and makes no
production request. It verifies actual TLS forwarding, filtering, query paths,
credential isolation, Origin/method denials, WebSocket, SSE, private no-store and
credential-free logs. The production upstream TLS verification remains enabled.

The tested Nginx was compiled locally from official 1.30.6 source; it was not
installed into any server. Tarball SHA256:
`3cf46f5ed7504d460125866b7bea99fb357f31d887e2e63b35503310e9b8b6c8`.
This does not prove compatibility with the future VPS's actual Ubuntu package.
Run syntax and the same isolated tests against that installed version before
application. Do not run fixture mode on a public interface.

Generate production and ACME-only configurations using `render.py` and
`render.py --bootstrap`. The checked-in generated files must match the renderer.
They are standalone **dedicated-node** configurations; never replace another
site's shared nginx.conf with them.

## Ordered activation — not executed

1. Resolve Beget VPS account access and own-app policy; enumerate existing VPS
   before purchase. Confirm final price including IPv4, no panels/extra disks,
   Ubuntu 24.04/RF location and budget. Record server ID/IP/quote privately.
   Any new binding terms require owner confirmation at the acceptance step.
2. On the new Beget node only, establish secure administration through Beget's
   authorized terminal, apply Ubuntu updates, install official nginx/certbot and
   verify modules/resolver. Never publish a root credential or add a key elsewhere.
   Limit inbound service exposure to 80/443 and approved administration; keep
   Beget console recovery available before tightening firewall rules.
3. Save the original Nginx tree, enabled services and checksum manifest in a
   root-only backup directory. Create `/etc/nginx/voltex-rf/{client,proxy}` with
   appropriate `www-data` access. Confirm `/etc/resolv.conf`/systemd-resolved
   actually supports renderer's `127.0.0.53`; set the verified resolver otherwise.
4. Verify public upstream GETs and TLS from the new node: frontend assets, API
   health, market listings/candles, catalogue, Kraken/Bybit public REST and WS.
   No auth registration, KYC upload, order, deposit or withdrawal is a health probe.
5. Export the current **ru record only** from Cloudflare into the private change
   record. Current UI: A/185.50.25.51/DNS-only/Auto; DoH observed TTL 300. Preserve
   apex, www, API, Workers, MX/TXT, nameservers and all other records.
6. Validate ACME-only config, then atomically enable it on Beget. Change only ru
   A to the verified VPS IPv4, DNS-only, TTL 300. Until TLS issuance succeeds the
   app intentionally returns 503. Obtain the certificate by HTTP-01 with the
   exact existing domain; no wildcard or global Cloudflare token is needed.
7. Check the full TLS config with the installed `nginx -t` (actual cert paths,
   permissions and DNS), then atomically switch and reload only Beget Nginx.
   If validation/reload fails restore the previous config; never restart Hetzner.
8. Test actual desktop 1440/mobile 390 UI, navigation/static assets, ordinary
   login/logout/reload, session rejection, Spot/Futures/native chart/Markets/
   Wallet/Copy Trading, WS/SSE and real quote freshness. Record network errors,
   TLS, 403/502/CORS/redirect loops without collecting tokens or account data.
9. Repeat safe public GET/HTTPS probes from RF datacenter probes and obtain an
   actual RF residential/mobile test without VPN. Do not label either Europe
   testing or a datacenter-only pass as all-Russia coverage.
10. Compare primary frontend bytes and API health/deployed SHA before/after.
    Install the prepared read-only monitor only on Beget, verify timer execution,
    log rotation/retention and certificate-renewal dry-run. No automatic restart,
    rollback, notification, financial request or billable external monitor.

## Updates, monitoring and rollback

Canonical frontend updates are fetched through the gateway without exchange
restart. Because all transformed frontend responses are no-store, content-hashed
asset URLs are not mixed by a gateway cache. Still verify a real reload after a
primary release; upstream CDN/runtime behavior and changed URL formats require
compatibility review. A provider hostname change needs a reviewed allowlist
update and local tests, not a catch-all proxy.

`monitor.py` and the systemd units are prepared, **not installed**. The monitor
checks the local TLS gateway and reports memory plus aggregate 5xx
counts only. Add logrotate before relying on bounded logs. Use included Beget
CPU/RAM/disk monitoring after VPS creation, without paid add-ons. Alert delivery
requires an agreed destination and is not configured here.

Rollback: restore the root-only saved Nginx config, validate and reload Beget;
restore the single saved ru DNS record if necessary. DNS rollback has propagation
delay and the old target is already nonfunctional; it is not a working fallback.
Leave the primary site untouched and direct users to it. Do not delete a newly
purchased server without an explicit decision (preserve diagnostics and billing
record). No rollback was performed in this task because nothing was deployed.
