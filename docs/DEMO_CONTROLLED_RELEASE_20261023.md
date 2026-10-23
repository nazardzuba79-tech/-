# Demo Spot / Demo Liquidity: prepared release, NOT deployed

## Updated inactive-image preparation — 23 October 2026

This section supersedes the historical preparation gates below. The approved
code-only sequence #596 -> #599 is merged at
`a7593324be9118cfda91ee8fc6bad0b6ff3acba9`; exact-head CI passed 36/36 and 17/17.
Integration QA #605 passed 38/38 checks including 81/81 financial tests.
Do not repeat these merges or the production SQL audit.

The restricted API candidate is based on the previously prepared
`c86e47bfd8e19ced5527177eec07ac3adcb9a98a`, itself based on the current production
API `6f082a98d0c97c28215e6c5c8056b786d6fa6c99`. All eleven non-bootstrap runtime
modules match final merged main byte-for-byte; bootstrap retains the exact c86
demo-only wiring rather than importing unrelated main changes. The production
release identity source and regression match #606 exact head
`18dd73224d5ad02407a8635e51354e46da7228f2`; they were already present in the live
API and c86 candidate. Thus no identity downgrade or unrelated product update is
needed. #606 integration into main is a separate code-only operation; this
preparation does not merge it.

`package-demo-off-api.py` verifies these immutable correspondences, all protected
production source paths and dependency/schema preservation before packaging only
twelve JS modules and their maps. Its manifest records the exact candidate
commit and archive SHA-256. The inherited base layers retain every other runtime
module, generated Prisma client, schema and migration. Three server flags are
explicitly false. The CMD invokes Node directly, never migrations.

The owner authorized building and inspecting an **inactive** image, not starting
it. Build with `--network=none --pull=false` from the locally verified production
base image. Any inspection container must remain created/stopped, network none,
with no production mounts or credentials supplied, and be removed after file
hash comparison. Never run `docker start`, `docker run`, Compose up, migrations
or a production database test during this preparation.

Rollback before any feature activation is the exact existing image
`sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012` and the
unchanged active Compose chain / release SHA. A default-OFF candidate must keep
all existing networks, mounts, healthcheck, secrets and services, changing only
the agreed API image, release SHA, three false flags and direct Node command.
After demo trading is separately activated, rollback must instead stay on a
guard-capable API with `DEMO_WITHDRAWAL_GUARD_ENABLED=true`; never restore the
production database over newer transactions.

Final build/image/config/file-hash receipts are kept outside Git and their
digests reported in Issue #592. Image inspection is not a running API smoke:
runtime admission and public `/health` on the new image remain NOT_RUN until
the owner separately authorizes switching only production API.

## Immutable inputs

- Main reviewed: `f7aa444851060d19aaad46d56a9ec2d1895f9129`.
- #596: `2f2f19a8685bf774efb64512b74d6262bc746fa7`, final guard-switch update; exact-head CI must finish.
- #599: `a93b2d3c1f5a8816e0135a5ba6ab6e555d9b342f`, stacked on the exact updated #596 head; exact-head CI must finish. Earlier `319e5bf6` / `fe4a5f2c` checks were 36/36 and 17/17, NOT evidence for these new heads.
- Production API/base: `6f082a98d0c97c28215e6c5c8056b786d6fa6c99`.
- Production/rollback image: `sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012`.
- Read-only #604 tool: `bb66b7bf46bb67b4426c9c81f1e3b02d3d3c37ca`; script SHA256 `e5e2bae146f5761e1e7463bac45d93982da2b4d490c299999ba62f87feb0f8e1`.

## Actual Hetzner evidence (23 October 2026, 12:56 UTC)

The unchanged #604 audit was executed inside the current API container against its existing PostgreSQL connection. The target database is `voltex_stage`, NOT the container initialization database `postgres`, and NOT Neon. DNS and connected-server IP matched the running production DB container. A READ ONLY transaction and PostgreSQL 18.6 were verified before data queries. No migration, data change or restart was performed.

| Check | Actual result |
| --- | --- |
| Inconsistent active legacy DemoOrder | 0 orders / 0 pairs |
| Unblocked demo-credited accounts with ordinary funds | 2 |
| Ordinary funded accounts without demo credit | 1 |
| Unheld Cross withdrawals | PENDING 0 / APPROVED 0 |

Private identities and balances were saved with Windows DPAPI CurrentUser encryption, outside Git. Redacted review: one ordinary USER without demo credit; one demo-credited configured native USER with ordinary funds but no opened native account; one demo-credited configured native ADMIN with ordinary funds and an opened native account. These labels do not establish deposit provenance. None of these states was changed.

Owner must approve keeping both dual-ledger accounts on their ordinary terminal while ordinary funds exist. Demo balances are not moved, reset or reclassified. Existing ordinary Balance funds remain potentially withdrawable under the existing ordinary policy.

## Financial guard: updated by Claude during this preparation

The final #596 update removes the earlier always-on Cross-withdrawal policy. `DEMO_WITHDRAWAL_GUARD_ENABLED` is OFF by default. The initial release pins it false together with Demo Spot/Liquidity and the frontend flag, preserving the current Cross request/approval flow.

The guard is enabled by its own flag OR by `DEMO_SPOT_ENABLED=true`; it cannot be disabled while Demo Spot is active. With it ON, demo-valued Cross wallets show no withdrawable assets, new unheld requests are refused, and existing unheld PENDING/APPROVED requests cannot be approved or marked sent (only rejected). Held ordinary Balance requests are unaffected. No existing request is automatically rewritten or cancelled. This activation policy needs owner approval; the actual read-only preflight found no old unheld pending/approved claims.

CRITICAL: after Demo Spot has ever been enabled, pin the independent guard TRUE through any rollback of Demo Spot or Liquidity. Do NOT revert to a pre-guard API image then: it would restore the old demo-valued payout path. Post-activation rollback must stay on a guard-capable API; no DB restoration or ledger rewriting.

Ordinary `/orders` and `/orders/oco` gain optional account-scoped request-ID replay safety, and SpotBookTransaction is generalized with its ordinary default preserved. Those are reviewed real-Spot code changes, not a claim that flags OFF make every byte of API behavior identical.

## Gate A — code-only merge (owner approval REQUIRED)

1. Read current heads again. Stop if any immutable input above moved.
2. Cloudflare currently has GitHub `main`, `deployments_enabled=true`, `production_deployments_enabled=true`, previews `none`. Its actual canonical deployment was GitHub-push-triggered at main `f7aa4448`. A merge CAN auto-publish frontend.
3. With explicit owner permission, temporarily set only Pages production Git auto-build OFF. Verify it is OFF through the API, record the previous setting, and verify no pending deployment targets these demo changes. Skip markers alone are not a guarantee.
4. Verify no production Hetzner deployment workflow/hook was introduced. Current host has no deploy cron, deploy timer, Watchtower, Docker socket-mounted updater or repository webhook; existing images are immutable/manual Compose selections. Worker deployment workflows are branch/manual gated; none is to be run.
5. Merge exact #596 head into main using expected-head CAS. Preserve all current TYVN/ECLAVO/frontend changes. Do not squash the stack into an ambiguous dependency.
6. Retarget #599 from its #596 base to main; re-fetch mergeability, check the resulting narrow 10-file diff and wait for its exact-head checks on the NEW base. Merge with expected-head CAS only after those checks pass.
7. Do not publish, restart, enable flags, or run migrations. Do not re-enable Pages auto-build while doing so would queue an unapproved release. The preflight tool PR #604 is not silently bundled into the two financial PRs.

## Gate B — separate default-OFF production release (NOT authorized/executed)

Do not deploy full main as the API: relative to the live API, it also contains Stocks/Futures/native funding/history changes and TWO extra migrations. Those are outside this task. Do not use the root Dockerfile: its CMD runs `prisma migrate deploy` automatically.

This release branch starts at the exact live API commit and carries only the #596/#599 API delta. The eleven Demo/ordinary-service/router modules are exact final #599 source; `src/index.ts` applies only demo wiring and deliberately retains the production Stocks/Futures wiring. The production schema, migrations, dependency locks, private trading, Futures, listings, test markets and TYVN config remain byte-identical to the production base. Frontend is NOT copied into this API branch.

Prepared files:

- `release/demo-off/Dockerfile`: inherit exact production image; copy ONLY the twelve changed runtime JS modules plus their maps, never the whole `dist`; no network/install/schema operation; direct Node CMD; all three server flags explicitly false.
- `release/demo-off/compose.template.yaml`: override ONLY `api-production` image, exact release SHA and the three false flags. All existing Compose files, mounts, secrets, healthcheck, network and DB stay in place.
- `scripts/package-demo-off-api.py`: requires committed source, compares the eleven service/router modules with exact final #599 source, verifies all protected source trees are unchanged, compiles and creates a SHA256-manifested minimal context. No SSH, DB connection or deployment. The archive contains Dockerfile + 24 emitted JS/map files, no secrets, schema or migration.

After an explicitly approved, committed source is fixed, build an INACTIVE image using `--network=none --pull=false`, exact base image and exact `RELEASE_SHA`. Compare image config (entrypoint/user/workdir/mount assumptions), Prisma schema/client and protected modules with current production. Render Compose to private memory and verify its ONLY changes are the agreed API image/release SHA/three false flags/direct Node command. No `up` at preparation time.

Immediately before an approved switch, use the existing backup mechanism and independent restore check; preserve the current image/Compose chain as rollback. Reconfirm only the relevant data safety gates. Update `api-production` only, no dependencies/build/pull/migrations. Verify API commit/health, DB readiness and unchanged DB container. Run synthetic default-OFF admission/authorization/withdrawal regression without real orders or financial writes. A real finance smoke requires a separate synthetic-account approval. Failure stops release and rolls back ONLY API image/config, never restores the production DB over new operations.

Frontend publication is a separately approved last step from the reviewed merged main, with `VITE_DEMO_SPOT_ENABLED=false` explicitly fixed. Current Pages production has that flag absent (therefore OFF). Verify its build and session behavior, then decide separately whether/when auto-build may be restored. Do not start any Worker release.

## Gate C — activation (separate approval REQUIRED)

1. Owner approves tester identities and their intended ledger. A demo-topup audit grants demo admission; it does not turn an ordinary funded account into a demo-only account. No existing funds are cleared to force eligibility.
2. Choose a dedicated unblocked USER for liquidity: not ADMIN, not owner/native tester, no ordinary Balance available/reserved. None is created or funded by this preparation.
3. Approve pairs, inventory and pricing terms: defaults 10 bps spread, 1000 quote units per order, quote age <=10 seconds, reference spread <=100 bps. This is an internal backed counterparty, NOT external venue execution and NOT a guarantee that every MARKET fills.
4. Credit approved accounts only through existing demo-topup. Set the independent withdrawal guard TRUE first and verify new demo-valued requests and approval/sent paths are refused. Only then turn on Demo Spot/Liquidity and frontend flag after approved inventory is present and admin read-only liquidity status is OK.
5. Exact-head CI already proves synthetic MARKET BUY/SELL, denied unauthenticated/blocked/unfunded access, retries/concurrency, no minting/cash-out and 1440/390 browsers. Repeat activation smoke only on approved synthetic accounts: backed BUY/SELL, stale/empty inventory fail closed, ordinary ledger unchanged. Never issue external orders or real withdrawals.
6. Rollback activation by switching Demo Spot/Liquidity/frontend OFF, but KEEP `DEMO_WITHDRAWAL_GUARD_ENABLED=true` and a guard-capable API. Inventory and receipts stay intact; no payouts of traded demo funds and no DB restore.

## Current decision

- Production SQL/preparation: executed read-only; runtime unchanged.
- Source stack: compatible; final exact-head CI is required on the updated heads above.
- Code-only merge: WAITING FOR OWNER REVIEW and Pages auto-build isolation.
- Production release / activation: NOT RUN. No merge, deploy, migration, balance change or order was performed.

## Local restricted-API validation

Backend TypeScript compile PASS using the unchanged production Prisma schema/client. Selected regression: 9 suites / 146 tests PASS (DemoLiquidity, DemoTradingService, demo route, ordinary orders service/route, withdrawal service/route, simulation-only isolation and deletion gate). The first test command included a nonexistent `AdminUserDeletionService.test.ts` path; that invocation was NOT a full PASS. Its 8 actual suites / 144 assertions passed, then the corrected final suite list above passed. #604 mock safety tests also passed 3/3. Exact PR CI additionally ran isolated PostgreSQL and network-denied desktop/mobile tests; those remote results are not claimed as tests of a new production deployment.

After incorporating the FINAL Claude guard update, backend TypeScript compiled again and the expanded final regression passed **10 suites / 173 tests**, including admin withdrawal approval/sent safety, service-level guards, guard OFF preservation, explicit guard ON, and forced guard with Demo Spot ON. Both updated PR heads still need their own final exact-head CI reconciliation; no old green head substitutes for it.
