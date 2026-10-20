# Stocks Docker Build Only — f97b7f9c

Prepared for CTO request6291480864 in Issue558. NOT published or run.
No application, SQL, financial logic, release checks or production state changes.

## Exact source and first gate

Application: `f97b7f9c6cf9086887101db33c3daa9fb98101cc`.
Approved base: `59db30e27a9803a879ca1f714055b34093bbad2a`.

Work's public attested production FILE manifest is retained byte-for-byte at
`scripts/qa/fixtures/stocks-production-files-20261020.json`, SHA256
`ddc65bbfdc91263cb6e79c85de9de6b8818da976c139094c851e42902e3ea3fe`.
It contains hashes/lengths/EOL metadata, no SQL contents, customer data or secrets.

All **44/44** pinned Git SQL objects match both the corresponding production file
SHA256 and byte length after offline LF→CRLF insertion:
`EXACT_BYTES_DERIVED_AND_HASH_VERIFIED=44`, `RAW_MATCH=0`, `MISMATCH=0`.
These counts describe Git-to-production FILE equality. They are not the different
production-file-to-ledger relation of 2 RAW_MATCH / 42 VERIFIED_EOL_VARIANT.

The new helper rejects the first mismatch with its exact filename and expected /
actual hash and length. It checks all44+pending2 before creating an output context,
then stages the derived files through the **unchanged original strict package
checker from f97b7f9c**. Local strict result: PASS_FILE_REVIEW_ONLY,44historical+2pending.
Git migration files and production files are never rewritten; derived bytes exist
only in disposable build output. The two pending files retain their approved LF
hashes. No SQL is executed.

This is an explicitly authorized byte-equivalent reconstruction, **not an original
source-export/build-provenance receipt**. Historical KYC/OTC provenance, ledger/EOL
policy, restore, identities, licensing, capacity and release gates stay separate.

## Named workflow for separate approval

- Display name: **Stocks Docker Build Only — f97b7f9c**
- Path: `.github/workflows/stocks-docker-build-only.yml`
- Proposed review branch: `codex/stocks-build-only-f97b7f9c-20261020`
- Opt-in event: `pull_request: labeled`, exact label `stocks-build-only-approved`.
- Guard: exact repository, public visibility, same-repository head, exact review
  branch. No `push`, `pull_request_target`, schedule, workflow_call or dispatch.
- Opening/synchronizing the PR does not start THIS workflow.
- One standard `ubuntu-24.04` job,30-minute ceiling, no matrix/retries.
- `permissions: contents: read`; no environments, secrets, OIDC, packages-write,
  deployment actions, registry authentication/push, SSH or external trading calls.
- Official checkout/setup-node actions pinned to verified commit SHAs.
- Application checkout is f97b7f9c, explicitly asserted. Review helper checkout is
  the exact PR head SHA, also asserted and included in the receipt.
- Node22.23.3 on runner and Docker. Local reconstruction-only validation used the
  already installed Node24.22.0; no Node22 Docker execution is claimed yet.

Why a label instead of a new manual dispatch: GitHub requires workflow_dispatch
registration on the default branch. This new workflow is not on main; merging it
just to register is forbidden. An explicitly approved PR-label event provides a
review-branch run without merging. Applying/reapplying the label is a CI launch and
must wait for separate owner approval. Do not label the PR during publication.

Other existing workflows/provider hooks may react to branch/PR publication.
Their current bounded trigger preflight is required **before publishing**, even
though this new workflow itself has no deployment path. No approval for those
other side effects is inferred from this file.

Repository metadata was checked public on2026-10-20. GitHub documents standard
public-repository runner use as free; larger/self-hosted runners are not selected:
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch

No artifact/cache uploads are configured, avoiding image publication and retained
artifact storage charges. Only normal logs and a compact sanitized job summary
remain. Dependencies/base images are downloaded publicly; there is no production
network target or production credential. Runtime smoke uses `--network none`.

## One bounded build and image smoke

1. Reconstruct and verify exact44+2 in an ephemeral clone of the pinned candidate.
   Load original `stocks-release-package.cjs`; preserve its Docker RUN verification.
2. Resolve official `node:22.23.3-bookworm-slim` once; pin both FROM lines to that
   digest in a derived **build-only** recipe. Record original/pinned recipe hashes.
   Never edit the frozen source Dockerfile or use the root auto-migration recipe.
3. Build `api` and `gateway` locally on the runner with local default Docker builder.
   No remote daemon, push, exportable Docker artifact or deploy.
4. Inspect image IDs, CMD, inherited ENTRYPOINT, `USER node`, no exposed ports and
   Node22.23.3. Read/hash inherited docker-entrypoint.sh and reject migration text.
5. Four fresh gateway image probes: missing authority, forbidden SQLite, forbidden
   JSON and unreachable loopback authority. Require exact fail-closed code/exit1
   and no LISTENING message through the actual image ENTRYPOINT+CMD.
   Containers: no network, mounts, published ports or accounts; read-only root,
   all capabilities dropped, no-new-privileges,1CPU/256MiB/64PIDs,20-second ceiling,
   exact owned container cleanup. The unready-authority probe uses public internal
   fixture strings, never owner/Ksenia identities.
6. Positive PostgreSQL/image startup and real TLS ingress are explicitly NOT_RUN:
   this bounded smoke contains no PG authority or TLS fixture. It cannot be
   presented as complete integration, original50+2 capacity or production proof.
7. Temporary contexts/images disappear with the disposable runner. Retain only
   sanitized SHA/base/image IDs and PASS/FAIL/NOT_RUN summary.

## Local preparation evidence (not a repeat of existing application tests)

- New exact-byte guard tests:5PASS,0FAIL/0SKIP.
- All44 historical hashes AND lengths:PASS; both pending hashes:PASS.
- Original strict package checker on the newly prepared context:PASS44+2.
- New image helper Node syntax:PASS.
- Workflow YAML parse and runner/permissions/triggers/no-deploy contract:PASS.
- Existing Jest146, PG/browser suites and load scenarios were NOT rerun.
- Docker/CI:NOT_RUN. No image digest yet.

## Next bounded decision

Review the exact local control commit/bundle (SHA supplied in delivery, avoiding
a self-referential commit hash). After separate owner approval, recheck deployment
hooks for the precise proposed branch/PR; publish only the reviewed control SHA
and create its Draft PR if those triggers are safe. After explicit run permission,
apply `stocks-build-only-approved` once. Do not substitute an existing deploy
workflow, weaken a failed check, rerun automatically or buy resources.

No merge, deploy, production migration/restore, identity/balance change or feature
activation is authorized by this preparation.
