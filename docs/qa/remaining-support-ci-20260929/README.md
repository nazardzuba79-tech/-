# Support bundle gate and final release CI map

## Focused correction

Base: `c3223e6b570f8147da8c614bbde1fe253df863ac`. The old Support workflow rejected an intentional account-identity comparison in `frontend/src/pages/admin/DeleteUserDialog.tsx` as though it were a mail secret. The workflow now leaves that address to the unchanged exact source guard in `frontend/src/lib/__tests__/supportForm.test.ts`. It still rejects `SMTP_PASS`, `SMTP_USER`, `SUPPORT_ADMIN_EMAIL`, and `CLOUDFLARE_API_TOKEN` in every bundle, and additionally rejects `SUPPORT_FROM_EMAIL`. No source exception, runtime, Worker or deploy condition changed.

Actual verification: unchanged Support source suite **10/10 PASS, 0 skipped**; the old scan matched the current root bundle, the corrected scan did not; all five synthetic forbidden-marker probes were detected. YAML parsed and original trigger/deploy-job objects remained identical. `verification.json` records the evidence. The existing React act-environment warnings did not fail the source suite. No fresh build or remote CI run is claimed by this lane.

## PR `codex/remaining-20260929` → `main`

The read-only map compared released main `9742375b96aff614b690042e13111c1df1178ec5` with frozen integration `c3223e6`, then reviewed root's CI path follow-up `901fad3a49a362eb01e17fbb6e358fc2729bd231`. At the frozen checkpoint, checked-in path filters select **34 PR workflows**. The four priority gates all run for this target; none excludes this head branch. Repository branch-protection settings were not inspected.

| Changed area | Required execution / configured scope | Boundaries |
|---|---|---|
| Production frontend source, Wallet BTC display, account/Copy and source-contract repairs | `frontend-full-suite.yml` / `complete-suite`: locked installs, Prisma generation, frontend typecheck/build, every Jest suite under `frontend/src`, then explicit rejection of pending/todo/unsuccessful results | Ubuntu + Node 22; dummy unused loopback DB URL; no production secrets; PR and manual only |
| Browser lifecycle, display transports/stores/timers, chart and native terminal integration | `browser-idle-sleep.yml` / `idle-sleep`: backend/frontend builds, lifecycle/read-budget Node tests, real fresh PostgreSQL regressions, candidate-bundle browser budget and native cold restart | Windows + Node 22; embedded PostgreSQL; browsers explicitly use installed Edge. No production secret supplied |
| Separate mobile review entry/assets/config and unmounted Telegram verifier | `mobile-clients-review.yml` / `fixtures-only`: CI safety checker, 8 exact test suites including HMAC and review safety, normal bundle isolation, separate review build, Chromium browser/offline fixtures | Ubuntu + Node 22; PR targeting main, push main, manual; no secrets, DB service, deployment or production entry |
| CLI-only owner allocation receipt replay safeguard | `admin-listings.yml` / `verify`: **14 real-PG receipt cases + 14 unit cases**, existing config/routes/trading guards, workerd store/smoke tests and local Admin → Publish → Markets browser flow | Disposable **PostgreSQL 16** at exact `127.0.0.1/voltex_listing_test`; explicit `VOLTEX_LISTING_TEST_URL` enables PG cases. No allocation CLI runs against production |
| Support scan correction | Existing `support-form.yml` verification: Worker contract/dry-run, source tests, production secret scan, local browser fixtures | Deploy condition unchanged; see release effect below |

The PostgreSQL idle wrapper runs `nativeLivePostgres`, `nativeLiveProjection`, `nativeLiveLimit`, and `nativeTestAccounts` after applying migrations to a newly created `voltex_native_egress_test`. Its PG test creates a new Prisma client/repository/service to verify persistence. The browser cold-restart harness separately uses the file-backed ReviewRepository; it is **not browser-to-PostgreSQL E2E**. Browser URLs are local; the inherited native review server binds `0.0.0.0`, so do not describe its listening socket as loopback-only. Edge availability and the Windows commands still require actual CI execution.

Additional selected workflow families cover Admin/deletion, analytics, app shell, browser/read budgets, CFD/direct Spot/Futures, Copy/Card, deposit catalogue/minimum, home first load, KYC, markets movers, native/private/test markets, display/server budgets, Support and Worker verification. No changed runtime area relies solely on a historical branch-specific job.

## Concrete findings and release effects

- The demonstrated Support scan failure is corrected here without weakening its exact source guard or removing real secret markers.
- Root `901fad3` closes the initially found idle path-filter gaps for directly invoked scripts, fixture repositories, HTML/Vite/TypeScript/package inputs, Prisma, root build/Jest configuration and Copy service fixtures. No pending hole is claimed for those paths.
- Full frontend, idle and Admin Listings are PR gates; only the mobile priority gate also reruns on main push. A push of the feature branch alone does not replace opening the PR. No required status should be inferred from local success.
- **No Worker code redeploy is required by the application delta.** Every Worker source/config and its referenced shared-source closure is unchanged from main: market 16 files, deposit 5, KYC 3, notification 2, Support 1. The market closure's Listings/public simulation helpers and deposit schema/public helpers are unchanged; neither `ownerAllocation.ts` nor `telegramInitData.ts` is imported into any Worker. Dependencies and Prisma schema are also unchanged.
- **This workflow edit itself matches the existing Support main-push filter.** After merge, normal Support verification and its unchanged deploy job will therefore redeploy the existing Support Worker despite identical Worker source. Market/deposit/KYC/notification redeploys are not required or triggered by this change. The market workflow still runs PR verification and a read-only deployed-health/isolation smoke, with its deploy job skipped on PR.
- The four priority workflows have read-only repository permissions, nonpersistent checkout credentials and no GitHub production-secret references. Existing secret-bearing Worker deploy jobs retain their original event gates. Nothing was dispatched, merged, deployed or written remotely by this audit.
