# VOLTEX Beget — active opaque RU gateway

Current state verified on **27 October 2026**, on owner branch
`work/beget-rf-gateway-preflight-20261026`. The former L7 security hold is
historical; its disabled scripts must never be used to reactivate TLS on Beget.

## Active route

`Browser HTTPS → Beget 185.23.35.226 TCP443 → Hetzner 138.199.227.130:18443 TLS → existing API / HTTPS public providers`.

- Existing Beget node only: `voltex-ru-gateway-01`, Saint Petersburg,
  Ubuntu24.04, 2 CPU / 1GB / 20GB. No additional purchase.
- Beget Nginx stream accepts only the RU SNI and has a fixed destination.
  It holds no current customer TLS key and serves no frontend JavaScript.
- Separate RU certificate/key terminate on existing Hetzner. The old
  Beget certificate was revoked. Trusted-account-bound CAA and an actual
  HTTP01 renewal dry-run passed; Certbot renewal runs on Hetzner.
- TCP80 goes only to the trusted challenge-only HTTP18080 listener.
- DNS RU A is DNS-only185.23.35.226; there is no RU AAAA.
- Only the separate `/etc/nginx/conf.d/voltex-ru.conf` was installed.
  Existing primary Nginx vhost, API container, PostgreSQL and financial code
  were preserved. Beget-specific UFW rules allow18443/18080 only from Beget.
- Admin/KYC/internal paths are denied at the trusted endpoint. Private API
  methods are explicitly allowlisted; unknown paths fail closed.
  JSON financial payloads are not URL-rewritten, private responses are
  no-store, and upstream Alt-Svc is suppressed.

## Current code and evidence

- TLS endpoint and explicit149-method/path policy: `endpoint.py`,
  `user_routes.json`, `nginx-ru-hetzner.conf`.
- Opaque stream and bounded read-only monitoring: `relay.py`,
  `nginx-beget-stream.conf`.
- Existing separate certificate lifecycle: `endpoint_renewal.py`.
- Public listing route repair: `listing_routes.py`, code
  `ae531c476f807dd3dafd4e10aa0d010855718c90`. The installer checks the exact prior hash,
  creates a local RU-only backup, runs Nginx syntax validation, then15 live
  positive/negative HTTP checks; failed acceptance restores only RU.
- Actual new vhost SHA256:
  `8315cc827c51c457e848d483bb35e6cbc3cf4f695e8ab4bd665dd9c8991255b3`.
- Runtime receipt/backup pointer:
  `/opt/voltex-rf-endpoint/public-routes-result.json`.
- Sanitized current browser evidence:
  `docs/qa/beget-rf/authenticated-20261027.json` and matching chart/market
  crops/checksums. Real ordinary-account Spot/Futures/Wallet, reload,
  Market/Limit, mobile layouts, deposit-dialog read, and logout guards
  were checked. No order, transfer, copy-trade, deposit or withdrawal was executed.
- Prior independent RF TLS/home probes and initial12 targeted tests remain
  under `docs/qa/beget-rf/live-*`. They were not rerun or relabeled as an
  authenticated RF-session test.

## Operation and limits

Frontend assets follow the existing primary Pages deployment through the trusted
proxy; this work did not deploy primary frontend or merge into main.
New private API endpoints require explicit policy review. Public worker aliases
accept at most the one/two prefixes produced by the existing client and keep a
fixed upstream; they are not an arbitrary proxy.

The existing API sees relayed users as one Beget IP. Its per-IP quotas, including
the observed10 login attempts/15minutes, remain shared and unchanged.
Broad RF capacity and authenticated sessions from RF networks are not certified.
Successful new registration and real financial execution were not tested.
Existing public-feed ALTHEA change sanity warnings were observed.

## Rollback boundary

Withdraw only RU A if closing the entry. Stop the dedicated
`voltex-rf-relay-health.timer`/service and use `/voltex-relay.py rollback`
on Beget to restore its prior hold. On Hetzner, `/root/rf.py rollback`
removes only the matching RU vhost; its receipt hash was updated by the repair.
Remove only Beget-specific18443/18080 UFW rules if decommissioning the route.
Never restore the former Beget TLS/L7 setup or overwrite primary Nginx/API/PG.
Local backup directories are recorded on their respective nodes; no private
keys or backups are exported into this repository.
