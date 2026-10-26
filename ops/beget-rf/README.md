# VOLTEX Beget — owner security hold

**NO-GO for login, customer data or financial functions through Beget.**
The owner's urgent security order supersedes the former TLS-terminating design.
Do not follow the historical activation instructions from earlier commits.

Owner branch: `work/beget-rf-gateway-preflight-20261026`.
Fresh main: `63d6b02cd38fe9ff52742c35ce46fa327827dd33`.
Current evidence and route/trust analysis: `docs/qa/beget-rf/SECURITY_REVIEW.md`.
Actual server record: `docs/qa/beget-rf/security-hold-server-result.json`.

## Actual state

One existing `voltex-ru-gateway-01`, Saint Petersburg, Ubuntu 24.04.5,
2 CPU / 1 GB / 20 GB NVMe, IPv4 `185.23.35.226`.
VPS + IPv4 917.10 RUB/30 days; with owner-approved Blog 520 RUB/month,
combined 1437.10 RUB/30 days equivalent. No additional purchase.

On Beget, Nginx 1.24.0 is active only on HTTP 80. It returns a plain 503 for
**every** ru path. It serves no JavaScript, login, admin, API, KYC or ACME files.
There is no 443 listener, upstream or database. Logging is off in the hold config.
The old monitor and certbot timers are disabled; old activation scripts were
renamed `.disabled`. A root-only hold marker prevents operator confusion.

In authoritative Cloudflare DNS, the ru A record was withdrawn; no ru AAAA exists.
Only `ru CAA 0 issue ";"` was added, TTL Auto / public 300. This blocks new
issuance by compliant CAs; it does **not** revoke the already issued ru certificate.
Apex/www/API/Workers/mail/NS were not changed. The old A and configs are preserved
for evidence, not as an approved rollback target.

A ru-only certificate/key and ACME account remain inactive on Beget. The primary
VOLTEX key was never copied there by this work. Do not export these keys to the
trusted endpoint or assume deleting a file removes provider snapshots. Existing
ru certificate revocation and independent key generation are activation blockers.

## Code and checks

- `security_hold.py`: the actual Beget-only hold application and sanitized audit.
  Already executed once; refuses a duplicate result. This is not a deploy script.
- `nginx.conf` and `nginx-bootstrap.conf`: identical fail-closed hold config;
  SHA256 matches the actual server's active config.
- `render.py`: production/default/old bootstrap render only the hold.
  Former L7 code survives solely for isolated loopback regression fixtures.
- `stage1.py`, `stage2.py`, `activate_existing_tls.py`, `build_transfer.py`:
  historical implementation retained for provenance, now fails immediately
  with OWNER SECURITY HOLD before network, package installation or any write.
- `passthrough_proposal.py`: OFFLINE ONLY, requires an explicitly reviewed
  external IPv4. No production endpoint/default target, certificates, HTML or
  HTTP parsing. Unknown/absent SNI is rejected; no arbitrary target or CONNECT.
- `test_security.py`: 7/7 targeted synthetic tests, including endpoint certificate
  fingerprint/body preservation and certificate rejection. No production traffic.
- RenderTest: 5/5 focused hold/render checks. Python compile passed.
- Historical 17/17 L7 transport results are retained; they are not a security GO.
  No complete financial/PG/Docker/general CI or load test repeated.

Reproduce only locally, with Nginx stream + ssl_preread and OpenSSL:

```sh
NGINX_BIN=/absolute/path/to/nginx python3 -m unittest discover -s ops/beget-rf -p test_security.py -v
python3 -m unittest discover -s ops/beget-rf -p test_gateway.py -k RenderTest -v
```

Fixtures use loopback, synthetic data and their own one-day test certificate.
Fixture mode is single-process for this isolated runtime, never a public server
configuration. No production secrets, sessions or provider API responses used.

## No safe activation yet

Beget must relay opaque TLS to a separately trusted terminator outside Beget.
That terminator needs its own valid ru certificate/key, issuance controlled by
DNS-01 + restrictive CAA/account binding outside Beget, a protected frontend,
explicit HTTP route allowlists and denial of admin/KYC/finance until separately
reviewed. The relay cannot inspect HTTP paths or rewrite SNI/Origin/JS.

No trusted production terminator has been prepared or authorized under this
work order. No passthrough was applied to Beget, Hetzner or Cloudflare Workers.
Provider policy and applicable data-processing/crypto-service requirements remain
unresolved. Full RF app availability and real-user login are not passed.

## Rollback / next operation

Keep the hold and ru DNS withdrawal. Do not restore the former L7 proxy to recover
availability. Root-only original backup: `/root/voltex-rf-backup/20261026T174829Z`;
pre-hold config: `/root/voltex-rf-backup/before-security-hold.conf` (historical ACME
bootstrap, not a secure release). The security hold is a reversible Beget-only
configuration; restoring service requires the blockers in SECURITY_REVIEW.md.
The primary site/API/PG and exchange flags are untouched. Beget billing continues
while the existing VPS/Blog remain provisioned; nothing was deleted or purchased.
