# KYC #530 — Hetzner preflight, 2026-10-16

Preparation only. No merge, production migration, API restart, Worker or Pages
deployment. No balances, orders, trading positions or real KYC documents changed.
Existing mail-to-Telegram forwarding and all production configuration preserved.

## Source and delivery gates

- Fresh main: `de73bab8f1c3c6f4450c93f7540356940dee9c4a`.
- Initial PR #530 head: `310924b7adafca2ade2b6793d85c946eee6cc1a1`.
- Open/Draft, mergeable; no review threads; 34/34 exact-head checks successful.
- KYC API/browser job `116864796383` and Worker job `116864796501` succeeded,
  including disposable PostgreSQL, builds and 12 additional-material browser scenarios.
- These check results apply to the initial head; rerun CI for the preparation commit.
- Pages `voltex-exchange` auto-publishes `main`. Use the documented
  `[CF-Pages-Skip]` prefix on the **merge commit**, then verify the old deployment
  remains active. Publish the exact merged frontend only after API/Workers pass.
- PR's Worker workflow does verification only on push; actual deploy requires
  workflow_dispatch, exact live API SHA and explicit migration confirmation.
- `kyc-workers-production` does not yet exist as a protected GitHub environment.
  Do not treat it as a configured reviewer gate. Owner approval is still required.

## Actual production, unchanged before/after checks

| Item | Verified value |
|---|---|
| API commit | `57a154a0322c25afe91641592084c5fc9f88fe8a` |
| API container | `256d915d9adf921bc348174a6568598b161a412f49a7da5768f8928219c8d38e` |
| API StartedAt / restarts | `2026-10-09T16:28:53.068563842Z` / `0` |
| DB container | `cc41ada75685c2e97660d4572f2ba17d27c9e1269510c5a5390d9f273ffac5d6` |
| DB StartedAt / restarts | `2026-10-06T15:23:56.311654501Z` / `0` |
| DB | PostgreSQL 18.6; `voltex_stage`; role `neondb_owner` |
| API / DB | `/health` OK; unauthenticated `/api/v1/kyc/me` 401; pg_isready accepting |
| Compose | `/opt/voltex-precutover`, project `voltex-cutover`, profile `cutover` |
| API service / port | `api-production`, `127.0.0.1:13020` → 3000 |
| Disk | approximately 15.8 GiB free; refresh at release |

Compose files, in order: `compose.yaml`, `compose.runtime.yaml`,
`compose.cutover.yaml.inactive`, `releases/hotfix-487-57a154a/compose.hotfix.yaml`.
Current image is also the immediate rollback:
`sha256:594d20f45f48775be9698793c32de273744bb4c4d7c57f73c4a4087fb896aec1`.

The runtime bootstrap ignores supplied command arguments and launches the API.
The preparation adds a migration-only runner; use an explicit `--entrypoint node`.
No existing bootstrap, configuration, password or secret was modified.
Effective Compose also pins `VOLTEX_RELEASE_SHA` to the current `57a154a0…`.
Future release overlay must update both the immutable image and this non-secret
release identifier; all other effective configuration stays unchanged.
An in-memory `docker compose config` comparison of this proposed overlay PASS:
only those two fields differ, every other effective setting identical. No config
file or running container was changed by this check.

## Existing backup: real restore PASS

- Existing job: `voltex-pg-backup.service` / `.timer`,
  `/opt/voltex-precutover/backup-local.py`. No new backup system or retention changes.
- Snapshot: `/opt/voltex-precutover/backups/local-20261016T032049Z`.
- Encrypted custom dump: 236224078 bytes; AES-256-GCM + RSA-OAEP-SHA256.
- Encrypted SHA-256: `344634b93413294bf314e05c9f3faf152d81b4399dc8adced334baf3061a25ca`.
- Plaintext SHA-256: `1001a7bf04ce37a5cb9eb27578c88ce66a7dcaa1a0c991f4980010d5683b3c3f`.
- Authenticated decryption performed on operator machine; private key never left it.
  No plaintext dump saved, no private key/connection URL/password printed or committed.
- Full `pg_restore --exit-on-error` into isolated PostgreSQL 18.6: exit 0.
- Exact snapshot manifest: **63/63 tables, 7349 rows, all counts and row hashes match**.
- Successful verification completed at `2026-10-16T09:29:47Z`.
- Test container had no network or ports; protected temporary data directory only,
  no production volume mounts. Exact temporary container/directory removed afterward.
- Earlier attempts: SSH timeout; insufficient 768 MiB test tmpfs. Both were test
  environment problems, not treated as proof of restore. Final proof is the successful
  disk-backed isolated restore above. Existing production backup files were untouched.

Before actual migration obtain a fresh snapshot via the existing service and repeat
verification. A successful preflight snapshot is not permission to migrate later
without an up-to-date backup. Never restore the whole production DB as an automatic
KYC rollback: doing so would discard intervening financial/customer writes.

## Migration and inactive image

- Production ledger: 43 applied, no failed; KYC table absent.
- Candidate: 44 migrations; only `20261015090000_kyc_material_requests` pending.
- Historical `session_remembered` checksum matches the deployed CRLF bytes. No ledger
  edit, migrate resolve, or historical migration rewrite was performed.
- Exact new SQL tested on network-isolated PG18.6 with synthetic data: table/indexes,
  OPEN default, unique clientRequestId, restrictive FK, child-first deletion PASS.
  The harness was corrected to handle PostgreSQL 18's `restrict_violation` condition
  (in addition to `foreign_key_violation`); the KYC SQL itself was not changed.
- Migration-only runner: eight local safety/redaction tests PASS; included in existing CI.
  The CLI catch boundary also suppresses unexpected raw SDK/filesystem exceptions.
- No-network candidate build using existing dependency base: Prisma generate and backend
  TypeScript build PASS. No npm download, production secrets or DB mounted for the build.
- Inactive test image: `voltex-kyc-preflight:310924b7`,
  `sha256:f56c0ebb0e3d8f50729b497221ac1d2676973f18e95af8578ff34fa27bfa3130`.
  It contains PR application source plus the preparation runner, not a final release.
- Read-only `migrate status` from that image passed the expected pending-only gate
  (CLI exit 1 because one migration is pending). No API/collector was started.
- Actual release must rebuild/relabel from the final approved merged SHA and pass
  runtime checks. No production API container was switched to this image.

## Mail, Workers and rollback

- Cloudflare destination `voltex.crypto@gmail.com`: Verified.
- KYC `KYC_MAIL` destination unchanged; signing secret name exists; health configured.
- Notification health `CONFIGURED`; existing GitHub Cloudflare token name present.
- KYC rollback version: `63ae9935-b121-4b04-81c8-9697b484f759`.
- Notification rollback version: `484c4eac-2623-4ff0-9d07-5dc5ae012468`.
- No signing-key rotation, R2, paid service, Telegram bot or forwarding rule added.
- Actual new material email/Telegram receipt NOT tested in production. Health and mocks
  are not delivery evidence. After approval and rollout, use a synthetic marked test,
  confirm mailbox receipt and existing forwarding separately, never a real passport.

## Approval still required

Owner must approve merge (with Pages skip), a fresh verified backup, migration,
API switch, manual Worker deployment and final frontend publication in that order.
Keep additive KYC table on API rollback; preserve current immutable API image.
No automatic destructive database recovery. Stop on source/runtime drift or failed gates.
