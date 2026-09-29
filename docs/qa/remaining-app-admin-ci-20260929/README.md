# App shell and Admin CI fixture corrections — 2026-09-29

Both assigned failures were in the verification fixtures. This lane changes no application runtime, access policy, account data, trading behavior or production service.

## Source and exact failed gates

The approved isolated base is `e92951c794d1a05faa1576723170d8284521cbd8`, the same tree as PR #345 head `b343c355` (`89edcb0c`). The two implementation commits are:

- `bfa6ffb5f98674faae9404e2dea59819319b2b2f`: `.github/workflows/app-shell-recovery.yml`.
- `79b20941bfe184330b6fc0312d4e3d6844722cee`: `scripts/qa-admin-gate.cjs`.

| Gate | Failed run / job | Observed cause |
| --- | --- | --- |
| App shell and chunk recovery | 36604258453 / 109529122059 | Both builds succeeded and emitted different real entry files. The workflow's alphanumeric-only grep excluded underscores, producing two empty strings and incorrectly reporting identical builds. |
| Admin access gate and Users loading states | 36604258622 / 109529122636 | Eight mobile scenarios passed. The next scenario advanced an unattended tab by one hour and expected an hourly activity read. The real five-minute idle policy correctly suspended that read, so the stale-state selector timed out. |

The decoded original CI logs are retained in the ignored local `output/ci-app-admin/` directory. Run/job IDs above identify the original records; this evidence does not claim a subsequent remote result.

## Changes and retained assertions

The shell guard now extracts `index-[\w-]+\.js`, matching the existing browser harness and Vite's complete hash alphabet. It requires a nonempty entry for each build before requiring different filenames. It does not bypass either build or any recovery scenario.

The Admin hourly fixture sends trusted pointer input every four virtual minutes, allowing the actual idle deadline to run. It asserts that the tab stays active, then retains the existing requirements: exactly one hourly activity read, visible stale-state feedback, and the last successful deposit data retained. No activity singleton is stubbed or forced active.

A separate scenario at both viewport widths waits for the actual sleeping notice, advances a full unattended hour and requires unchanged account-read counters. A trusted wake click must cause exactly one session validation and one activity refresh. A failed refresh must keep the last successful data and show both the page's stale state and the global failed-resume state. The explicit `en-US` browser locale avoids the local host's invalid default locale; application copy is unchanged.

All prior gate assertions remain: no privileged reads before access confirmation, refusal on 401/403, preserved route and retryable errors on server/network/malformed responses, no retry storm, a bounded hung-request timeout with closed sockets, unknown initial activity instead of fabricated zero values, session revocation, and refusal after replacement with a customer token. All accounts and bearer values are synthetic fixture inputs.

## Validation actually run

| Check | Result | Evidence |
| --- | --- | --- |
| Two real production builds | PASS; A `index-gAizF_5B.js`, B `index-ClWgg_OL.js`, matching the original CI outputs | `verification.json` records complete bundle fingerprints. |
| Corrected workflow entry guard | Different builds pass; identical builds fail; missing entry fails | `entry-guard-report.json` |
| Unchanged complete shell recovery harness | PASS, 10 scenario groups, no findings, exit 0 | `app-shell-report.json`, `app-shell-browser.log` |
| Complete corrected Admin browser harness | PASS, all 24 scenarios at 390/1440, exit 0 | `admin-gate-report.json`, `admin-gate-browser.log` |
| Focused Jest scope | PASS, 66 tests in 4 suites, no skipped/todo cases, natural exit 0, 13.196 seconds | `focused-jest.json`, `focused-jest.log` |
| Syntax and whitespace | Both QA scripts pass `node --check`; `git diff --check` passes | Local commands recorded below. |

The Jest suites were `futuresColdOpenRecovery`, `adminConsoleInteractions`, `adminUsersActivity` and `renderBandwidthBudget`. The unchanged recovery harness covered stale desktop/mobile shells, a poisoned entry, a poisoned route chunk, interrupted reload, permanently stale content, ordinary crashes, offline behavior and fresh routes. The existing fixture's host/cache model is also validated.

The full Admin result includes the four changed/new activity checks and every original security/error scenario. The 15-second hangs timed out after 15 seconds at both widths, with zero remaining hung sockets. Active hourly activity and failed wake activity each issued exactly one read. Representative recovery, mobile stale-data and desktop failed-wake screenshots are included and were visually inspected.

### Local execution detail

Local runtime: Node 24.19.0, Playwright 1.62.1, Chromium 153.0.8010.0. The original CI used Node 22, Playwright 1.56.1 and Chromium 141.0.7390.37. Browser traffic used local fixture servers; no production account or service was contacted.

The shell check used the complete frozen A and B builds. Early Admin attempts were invalidated when build B's HTML was present beside build A's assets in the generated `frontend/dist` path. The observed CSS `ERR_CACHE_MISS` was a boot-guard cache probe; it was not evidence of a Chromium or access-control defect. No cache, browser interception or static-host workaround was retained.

The final complete Admin run therefore used a temporary copy of the exact committed script with only two path expressions changed: resolve `root` absolutely, and set `dist` to the complete frozen `output/ci-app-admin/buildA`. A byte-for-byte comparison confirmed no other script difference. Every scenario, route interception, fixture response, trusted input, clock operation and assertion remained intact. The committed CI script continues to use its freshly built `frontend/dist` and runs the full gate. The preliminary focused run also passed all four changed/new checks; the complete 24-case result supersedes that narrower evidence.

Commands, with the local Playwright module supplied through the harness's existing environment variable:

```sh
npm run build --prefix frontend
node scripts/qa-futures-cold-open.cjs
node output/ci-app-admin/admin-full-frozen.cjs
npx jest --runInBand --runTestsByPath \
  frontend/src/lib/__tests__/futuresColdOpenRecovery.test.ts \
  frontend/src/lib/__tests__/adminConsoleInteractions.test.ts \
  frontend/src/lib/__tests__/adminUsersActivity.test.ts \
  frontend/src/lib/__tests__/renderBandwidthBudget.test.ts \
  --json --outputFile=output/ci-app-admin/focused-jest.json
node --check scripts/qa-admin-gate.cjs
node --check scripts/qa-futures-cold-open.cjs
git diff --check
```

Build B applies only the workflow's temporary `data-build="b"` marker to `FuturesPage` to obtain genuinely different build assets. That source edit was restored after the build. No frontend runtime difference is included in these commits.

## Remaining release gate

The exact updated PR head must run both full CI workflows before release. This lane performed remote reads only and did not push, rerun CI, merge, deploy, or change a production API, account or database. Root owns integration and final release decisions. Source blobs, bundle digests and evidence hashes are in `verification.json`.
