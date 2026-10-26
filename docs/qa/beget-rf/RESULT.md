# Beget RF gateway — blocked activation, tested preparation

Date: 2026-10-26 UTC. Baseline main/working branch fetched from GitHub:
`63d6b02cd38fe9ff52742c35ce46fa327827dd33`.

## Update — VPS actually provisioned; activation still incomplete

On 26 October 2026 (Europe/Kyiv), after the owner's explicit follow-up purchase
authorization and their personal submission of Blog's monthly contract form,
Beget completed its internal hosting-account transfer and enabled Cloud.
Inventory had no VPS before creation. One server was created and reached Running:

- Identifier/name: `voltex-ru-gateway-01`.
- Location: Russia, Saint Petersburg.
- Ubuntu 24.04, 2 vCPU / 1 GB RAM / 20 GB NVMe.
- Public IPv4: `185.23.35.226` (ru DNS has **not** been changed to it).
- VPS 767.10 + IPv4 150 = **917.10 RUB per 30 days**; with monthly Blog 520:
  **1,437.10 RUB**. For a 31-day VPS period plus Blog: 1,467.67 RUB.
- Provider uses PAYG from the current balance; monthly UI is a cost equivalent.
  No annual/multi-month prepayment or new payment method. Six free hosting days
  were canceled as required by Beget before Cloud creation. Last UI balance:
  15,000 RUB; no full-month debit was observed at creation.
- No second server, paid panel, additional disk, exchange account, balance or
  financial configuration was created/changed.

Provider file manager authenticated to the new node and displayed its root
filesystem. The built-in console displayed Ubuntu 24.04.5 and tty login; input
methods did not reliably enter text, and no successful root login or command
execution is claimed. No new server file was written. Then browser control failed
with: “Browser access requires the originating browser context. Open ChatGPT in
the browser with the connected extension and try again.”

The canonical VOLTEX home was also actually opened in the owner's ordinary
browser: guest navigation, visible BTC/USDT chart and populated market quotes
rendered. This resolves the earlier environment-only liveness uncertainty for
the home UI, not authenticated wallet/trading or the RU gateway.

The 17-test Nginx suite was run again after a new, demonstrated compatibility
fix: existing KYC rejects RU Origin. The new stricter fixture reproduced **403**
on the prior gateway (`kyc-origin-before.txt`), then the gateway's exact RU to
canonical private-upstream Origin mapping produced **17/17 PASS**. Incoming
foreign Origin and unsafe requests without Origin remain rejected before
forwarding. No Worker/API allowlist or financial code changed.

Current status: **VPS PURCHASE/RUNNING CONFIRMED; RU GATEWAY NOT DEPLOYED**.
Nginx, cert issuance, backup, monitoring, actual upstream checks from Beget, RU
DNS cutover and full desktop/mobile/RF QA remain pending. No rollback occurred.
Resume browser management of this one node; do not repeat purchase or create
replacement keys. Historical preflight measurements follow and are not current
claims about Cloud access or server inventory.

## Earlier preflight external state (before owner activated paid hosting)

| Check | Actual result |
| --- | --- |
| Local-browser Cloudflare session | Authorized, DNS and Pages settings read successfully |
| Cloud-browser Cloudflare Google login | Returned “Unable to sign in”; not retried after local session became available |
| Authoritative nameservers | lana.ns.cloudflare.com / thomas.ns.cloudflare.com |
| Existing ru record | A 185.50.25.51, DNS only, UI TTL Auto; public resolver TTL 300 |
| Existing hosting | FreeHosting; existing domain and ru subdomain, no duplicates created |
| Beget balance | 15,000 RUB, unchanged |
| Beget Cloud/VPS access | 403 in both browsers; shared Services page is not VPS inventory |
| Official VPS ordering path | Calculator Create returns to FreeHosting main, not a VPS order |
| Quoted eligible VPS | Saint Petersburg, 2 CPU/2 GB/30 GB, Ubuntu 24.04, IPv4; 43.44 RUB/day incl IPv4 |
| Actual purchase | None; 0 RUB spent; no VPS ID or allocated new IP exists for this work |
| RF HTTPS probe 1 | Moscow / Timeweb AS9123: connection refused to 185.50.25.51:443 |
| RF HTTPS probe 2 | Saint Petersburg / Selectel AS49505: same connection refusal |
| RF home/mobile ISP | Not tested; datacenter probes do not prove residential availability |
| Ordinary browser ru navigation | Failed with net::ERR_TUNNEL_CONNECTION_FAILED; not substituted for RF TCP evidence |
| Screenshots | ru-desktop-blocked.jpg at 1440x900, ru-mobile-blocked.jpg at 390x844; both show failure before app load |
| Desktop/mobile functional QA on ru | BLOCKED before page/TLS load; no login, trade or account write attempted |
| Primary site/API before check | 200; API deployed SHA 89c3ac003b44a6a0e7630d2ecbe5d7164e85b683 |
| Primary site/API after recheck | Execution environment returned 403 for all three public GETs; current liveness could not be reconfirmed from that environment |
| Production changes / rollback | None / none |

The execution-environment ru GET returned 503 from an intermediary; it is not
proof that Beget generated a 503. The RF probes directly identify the failed
TCP connection and resolved target. Public measurement:
https://api.globalping.io/v1/measurements/2HbIrXZ25HNMOca8n00021O9O
created 2026-10-26T15:58:00.004Z. Sanitized results are saved here because public
measurement retention is limited.

## Actual tests and scope

`gateway-tests.txt`: **17/17 PASS**, executed with real Nginx 1.30.6, TLS and
loopback HTTP/WebSocket/SSE fixtures. No production calls in that test suite.
All initial failures were fixed before the final run: isolated Nginx user setup,
overwritten numeric captures, distinct market/API URL bases and health-query
forwarding. No assertion was disabled. Initial failures are recorded in the
session's tool results; the committed result is the final actual run.

Covered: generated-file consistency, fixed path/query forwarding, unchanged
synthetic financial JSON/body, one upstream POST only, public credential stripping,
private no-store, Origin/method rejection, unknown targets/Host, KYC fixed path,
first SSE chunk before stream completion, real WS upgrade/frame, credential-free
logs, ACME-only fail-closed config and input validation. Python compile and diff
checks are also run. No full frontend/backend/PG/Docker/financial suite was run
or claimed. No GitHub Actions workflow was dispatched.

Prepared files: renderer, dedicated-node Nginx and ACME config, local test suite,
read-only monitor/systemd timer, log rotation and activation/update/rollback
runbook in `ops/beget-rf/README.md`. These are **not installed** in Beget and
are not an assertion of live gateway compatibility.

Source inspection identified direct API, market Worker, catalogue Worker, KYC,
Kraken/Bybit REST and two public WS dependencies. The prepared allowlist covers
these without arbitrary proxy targets. External TradingView/assets remain an
explicit compatibility gap. The primary compiled bundle could not be downloaded
from the execution environment (403); no live frontend-through-gateway QA is
claimed.

## Branch publication safety

The authorized local Cloudflare UI showed `voltex-exchange` production branch
main, Automatic deployments Disabled, and no deploy hooks; deployments page
showed paused/skipped deployments. No setting was edited. At the fetched source,
the primary Pages publication workflow is manual and main-only; Worker deploy
push triggers target main or cloudflare-market-edge, not the Beget branch. The
prepared commit changes only ops/docs and uses CF-Pages-Skip, skip render and
skip ci markers. No merge or workflow dispatch is part of this publication.
This is not a fresh audit of unrelated Render/Northflank services.

## Remaining activation gates

1. Beget must expose VPS ordering on the existing funded account; check inventory
   before purchase so an unavailable inventory is not mistaken for zero servers.
2. Confirm own-application reverse-proxy policy, then confirm the final checkout
   price/terms within the owner's existing spending authorization. Do not buy
   shared hosting or open a new account as a workaround.
3. Provision the single approved node, inspect its actual Ubuntu Nginx, verify
   upstream TLS/connectivity and trusted client-IP/rate-limit behavior read-only.
4. Follow the backup, ACME, single-record DNS, atomic Nginx reload and rollback
   sequence; all other production services/configurations remain untouched.
5. Perform real ru desktop/mobile auth/navigation/quotes/WS/logout QA, safe RF
   probes plus an actual RF home/mobile check. Keep financial writes excluded.

Historical status at that snapshot: **BLOCKED — not a live PASS.** The update
above supersedes the old account-access/purchase blockers; live activation still
has not occurred.
