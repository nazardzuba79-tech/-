# Copy Trading #641: exact packaged RC2 evidence

This branch is an isolated CI harness, NOT an application deployment branch. It contains no deploy job and uses no production credentials. It neither merges #641 nor rebuilds application code. A separate owner approval is required for any production operation.

Application identities:
- API feature source: 3ab2e32bf783c8d511469dbd38bbe71f85e79630
- Installed API base: 54a138f502003cd1fdea752f0440c970cd551af4
- Installed / rollback image: sha256:83ed7f06237e061064ee0b9a27f494ff87e9904a850426a50ef03357c7877cdf
- Frontend RC2: 97bbfa04d87bf912a76c14724891c86c4d6181cf
- Frontend base: 006f59ee8175f3afaf5ce3087488b37b529246d5
- Pages rollback: fa7cee64-c984-4d33-ab5a-a440fe2b94dc
- Migration: 20261029150000_copy_strategy_socials
- Migration SHA256: 6b22197bac2fb548c3f473532949f26772f35b613fe060208ca83504f9b63569

The Actions head identifies the harness; it is NOT the application source SHA. Inputs/SHA256.json pins the exact previously sealed application artifacts. The four compiled API modules/maps and generated client changes are overlaid on captured installed runtime bytes, retaining the Linux query engine and all 570 protected runtime files. The frontend audit checks all 341 emitted files, production origins, OFF conversion flag and unchanged RU routing. Source parity compares only the approved four API / six frontend paths against #641.

The database is a disposable PostgreSQL 18.6 service initialized with schema only and synthetic fixtures. No production rows are included. Focused tests cover the packaged policy/router, owner-only edits, administrator/cross-owner denial, expired/revoked sessions, URL validation, migration lock failure rollback and idempotence, all 63 table contents, old API/client with new nullable columns, old frontend with new API, and both owners at desktop1440/mobile390. Malicious social fields are injected for disabled catalogue identities only in isolated browser responses. No 4971-suite rerun.

Release artifacts are upload-only outputs. No production image is built or started here; exact runtime tests do not establish a deployed image. Production authenticated user acceptance is NOT_VERIFIED by this isolated harness.

After separate approval: validate fresh runtime/schema/configuration pins and backups; build only the overlay from the immutable installed image in isolation and smoke-test it; apply only the three nullable TEXT columns using the guarded SQL; cut over only API with unchanged configuration; publish only the sealed production frontend. Stop on drift. Wallet Conversion remains OFF in both components. No RU deployment, financial operation, bot/listing/timer change.

Rollback: return Pages to the pinned deployment, then API to the pinned image as needed; retain additive columns and social-link data. No DROP COLUMN or database restore. The complete private operator runbook and Compose pin set remain in the existing local RC2 checkpoint.
