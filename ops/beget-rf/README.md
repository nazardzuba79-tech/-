## Current verification — 29 October 2026

See [Issue636 evidence and two nonfinancial GET proposal](../../docs/qa/beget-rf/verification-20261029.md). Named RF ISP probes:66 bounded HTTPS GETs. The prior five-rule/19-test proposal is superseded: Banking state GET accrues ledger entries and strategy GETs may append modeled history. The final candidate admits only config/referral GET|HEAD; production unchanged. Ordinary non-ADMIN full-session QA and separate approval for other side effects remain necessary. No API/DB/Worker/financial-code release.

# VOLTEX Beget — active opaque RU gateway

Recorded 27 October2026 on owner branch `work/beget-rf-gateway-preflight-20261026`.
Latest narrow Worker release is owner-authorized but BLOCKED before deployment
by lost authorized-browser context; see `kyc-worker-release-20261027.json`.
No main merge, primary frontend/API deployment, DB write, real KYC submission
or financial operation. Previous L7/blanket-KYC-block documents are historical.

## Actual route and trust

Browser TLS → Beget185.23.35.226:443 opaque stream + PROXY preamble →
Hetzner138.199.227.130:18444 TLS → existing API / fixed HTTPS providers.

- Existing SPb Beget node only:2CPU/1GB/20GB, Ubuntu24.04. Existing
  917.10RUB/30days plus Blog520RUB. No new purchase.
- Fixed RU SNI/upstream, no open proxy. Beget has no current TLS key, HTTP
  processing or JavaScript serving; it sees connection metadata and can deny
  service. No absolute certificate-misissuance/provider-backup guarantee.
- Certificate/key/renewal are on Hetzner. Old Beget certificate revoked;
  account-bound CAA and successful renewal evidence remain. Fingerprint:
  `c6136fc3f97d35677ac195d0eaab7cbc831892f9374378ddc40682091f6129e8`.
- TCP80 stays challenge-only to18080. RU A185.23.35.226 DNS-onlyTTL300/noAAAA;
  DNS unchanged during this correction.
-18444 requires PROXY protocol, TCP peer ACL remains Beget+loopback. HTTP
  client-IP headers are overwritten from the transport preamble, not trusted
  from browsers. Existing API trust1hop/login10-per15min/general limits stay.
  Distinct source IPs no longer share a Beget login bucket; actual NATs still do.
- Old18443 retained for draining/rollback, clears special KYC IP claim.
  Main vhost/API container/PG/balances/listings/financial code remain unchanged.

## Customer KYC and data visibility

Exact GET/HEAD `/api/v1/kyc/me` and POST/OPTIONS
`/_voltex/kyc/v1/{submit,materials,confirm}` restored. All other KYC,
administrative/internal paths remain denied. Explicit policy has154 entries,
including four missing deployed public display GETs.

Trusted Hetzner streams documents only to verified HTTPS
`kyc.voltextech.net`. Exact RU Origin maps to existing canonical Origin;
no new CORS grant/wildcard. Bearer, multipart Content-Length/body preserved.
Cookies stripped; no private cache/retry/body buffering/document access log.
Gateway4259840B cap preserves Worker's4MiB file cap. Auth/type/receipt/repeat
protections unchanged. Beget sees ciphertext; Hetzner terminates TLS and can
see HTTP. KYC Worker/existing recipient process documents; metadata API gets
signed metadata, not files. Trusted operators are not claimed unable to see data.

## Applied code, configuration and evidence

KYC: `cf3ee7e5fdfb03e622df9b5fa2e8a2ad05bb42df`.
Client-IP gateway + pending Worker candidate:
`dc236a3aaca436f4e670a0a4d3f7d08b3834da6c`.

Final snapshots independently match installed files:
- `nginx-ru-hetzner-final.conf` SHA256
  `12ff7c12a2039d6086affed9ab65adf71c69339936494f309d2dfaa2b02161f6`.
- `nginx-beget-stream-final.conf` SHA256
  `09afdb6c46e8abb76bcd298c1d04b5627ae90de43b305ab8b477b627c93e66d5`.

Receipts: Hetzner `/opt/voltex-rf-endpoint/customer-kyc-result.json` and
`client-ip-result.json`; Beget `/root/voltex-rf-relay/client-ip-result.json`.
Cutover2026-10-27T06:02:55Z, no rollback needed. Primary API remains
`89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`,
started2026-10-23T16:30:08.152Z.

Current sanitized evidence lives in `docs/qa/beget-rf/`:
`customer-kyc-result-20261027.json`, `customer-kyc-browser-20261027/`,
`deposits-20261027.json`, `customer-route-inventory-20261027.json`,
`home-rf-20261027.json`, `kyc-rf-20261027.json`, desktop/mobile JPEGs and
`customer-kyc-20261027.sha256`. No emails/IDs/addresses/balances/tokens published.

## Actually run

- Real Nginx1.24/TLS/stream/API-auth IP/rollout15/15 PASS. Forged HTTP IP ignored,
  clientA11th invalid login429 while clientB retains its independent bucket.
- Previous Worker39 existing contracts plus4 IP tests passed separately.
  Latest release preflight ran45/45 together:39 existing plus6 IP cases,
  including independent actual-core quota consumption and forged-header rotation.
  Two new actual API-router tests with synthetic storage/session/signatures pass:
  rotated metadata cannot reset account quota; a revoked session remains401.
  Generated client metadata was isolated under ignored output with no engine/DB;
  initial missing-metadata/config-path failures are preserved in the release receipt.
  KYC client17/17; two DOM cases (network-error recovery and actual deposit
  dialog/QR/clipboard/minimum/synthetic memo) PASS.
- Frontend tsc/Vite build PASS, existing chunk warning. Wrangler4.153.0 dry-run
  PASS; bundle SHA256
  `b488969684918cc484ed05107afdbd4caa9658b8ca1a39bef356ccec3c055cb2`.
- Real isolated ChromeHeadless156 + actual Nginx/Worker/signature verifier:
 19/19 PASS at1440/390. Metadata/session/email adapters SYNTHETIC, four local
  email-sink events, zero external connections/page errors/files in metadata API.
  Localhost-only alias/pinned synthetic certificate do not change production.
  Known font CSS fulfilled locally; six initial setup/assertion failures saved.
  Not production KYC submission or full API/PG execution.
- Actual ordinary production KYC upload form at1440/390; Spot/Futures charts,
  Wallet/Markets/CopyTrading/OTC/Card/Bots/settings render. Read/render only.
- All10 configured deposit/network choices matched primary catalogue; QR and
  existing minimum visible. No real address-copy notification/transfer/history
  insertion/crediting; clipboard/memo branches tested locally.
- Direct RF probes without VPN: home200 at MoscowDatacheap/NovosibirskMTS;
  protected unauthenticated KYC expected401 at NovosibirskMTS/MoscowSERV.HOST.
  Certificate matches. Not authenticated KYC from RF, every ISP or capacity GO.
- Deployed-router inventory: zero unreviewed ordinary registered routes.
  Future Banking/Stocks APIs not registered in deployed API were not activated.

Reproduce ONLY in isolation, explicit local tool paths, no DB:
```sh
VITE_KYC_EDGE_URL=/_voltex/kyc VITE_API_URL=/api/v1 npm run build --prefix frontend
NGINX_BIN=/path/to/nginx NGINX_STREAM_MODULE=/path/to/ngx_stream_module.so \
QA_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell \
QA_PLAYWRIGHT_MODULE=/path/to/playwright QA_OUT=/tmp/ru-kyc-proof \
node ops/beget-rf/qa_customer_kyc.cjs
```
Do not deploy this QA-only frontend bundle as primary frontend.

## Authorized Worker release — access blocked / limits

Owner granted the narrow release. Do NOT ask again for that same approval.
Last observed deployment was `b00aac7e` in the prior Cloudflare UI inspection;
the current active version/rollback target cannot be verified this attempt.
The connected browser returned an originating-context error twice, cloud fallback
has no session, and execution has no existing Cloudflare credentials. Public
health requests from execution returned403. No deployment/config write occurred.
The authorized change is ONLY `voltex-kyc-edge` clientRateIp/core calls and plaintext
`RU_GATEWAY_PEER_IP=138.199.227.130`. Trust claim only when Cloudflare-set peer
matches pinned Hetzner; validate/canonicalize IPv4/IPv6, otherwise use actual peer.
Spoof/malformed/fallback cases tested. Wrong pinning can misattribute quota.
Beget PROXY metadata is NOT cryptographic identity: a compromised relay can forge
it. Never use it for authentication/ownership/account/session exemptions. Actual
API session verification and account quotas remain independently authoritative.

Preserve existing signing secret, recipient, bindings, CORS,5/min binding,
8/10min isolate and10/user/hour API limits. NO key rotation/notification Worker
deployment/broad main-only workflow. Before release, refresh live script/settings,
record the full current deployment version and ensure same-Worker rollback.
Only use `b00aac7e` if freshly confirmed as the actual previous working version.
No live two-IP/fake-header canaries ran because release gate was not reached.

Frontend fallback is separate REVIEW CODE ONLY, not published. Added15s timeout
ONLY to KYC-status GET, abort on unmount/replacement and stale-response guards;
uploads unchanged. Three DOM tests and21/21 real isolated browser checks at1440/390
PASS, including stalled-read/error/Retry. Screenshots and `timeout-report.json`
are under existing `customer-kyc-browser-20261027/`. QA build is not a production
artifact. No primary frontend release is bundled with the approved Worker action.

Technical PASS is not legal permission. Beget rule9 bans mass VPN/proxy services;
fixed own-app relay is not an arbitrary proxy, but no written exception claimed.
CBR current guidance read27Oct2026; operator/licensing and PD/localization/
transborder obligations remain unverified. Official RKN legal-text fetch timed out.
Do not label lawful mass RF KYC/financial operation approved.
Primary sources: https://beget.com/ru/cloud-rules-ru ,
https://www.cbr.ru/explan/cryptocurrency/ ,
https://www.cbr.ru/develop/cryptocurrency/ ,
https://pd.rkn.gov.ru/registerOffenders/legalacts/ .

## RU-only rollback

1. Beget FIRST: `python3 /root/ri.py rollback-beget`;
   backup `/root/voltex-rf-relay/before-client-ip.conf`.
2. Hetzner: `python3 /root/ri.py rollback-hetzner`;
   restores working KYC18443 and removes only new18444/rule.
3. Optional KYC reversion AFTER those: `python3 /root/rf4.py rollback`.

Helpers guard exact hashes/backups. Full shutdown withdraws only RU A and uses
prior recorded hold procedure. Never restore Beget L7/TLS or touch primary
Nginx/API/PG. Existing bounded health monitor/certificate renewal remain active.
