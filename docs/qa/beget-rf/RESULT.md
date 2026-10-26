# Beget RF gateway — blocked activation, tested preparation

Date: 2026-10-26 UTC. Baseline main/working branch fetched from GitHub:
`63d6b02cd38fe9ff52742c35ce46fa327827dd33`.

## Actual external state

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

Status: **BLOCKED — not a live PASS.** Cloudflare login is resolved; Beget account
Cloud/VPS access and policy clarification are the next actionable dependencies.
