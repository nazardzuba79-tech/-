# Admin practicality review evidence

Review only. No production database, user funds, migrations or infrastructure were used for these checks. The password column, password vault and auth contracts remain in place. PRs #403, #406 and #407 were merged by a concurrent session during this work; this agent did not merge them or initiate a deployment. The existing Cloudflare Git integration creates branch previews automatically. PR #408 remains the review candidate against main.

## Stack

1. Confirmed defects: PR #403, final reviewed head `b1825be1b355482f9124233a574e5f453c3cd77c`; externally merged as `f231431864faef057c1ab586e2c3d93d69bcd1e4`.
2. Bounded reads: PR #406, reviewed head `52ef08eaeca1b46d1e47ed3cba21756f45abc73d`; externally merged as `fa8535c71ec26e2c8b0fbf53b20b69201a057acc` during final validation.
3. Durable adjustment receipts: PR #407, reviewed head `c7c4134b035af1ebe6099f1e3c6972306d4e0955`, all eight workflows green; externally merged as `13b7685372a763fb9b44365db10cf206aea29ca4`.
4. Working views: PR #408, `codex/admin-workflows-20261003`, now against main after the earlier merges. See its GitHub PR for the final exact head and CI.

## Validation performed

- Frontend Admin/deposit/KYC/bandwidth suites and TypeScript: exact totals recorded in `ADMIN_WORKFLOW_VALIDATION.md` and the PR. Tests include timeout, cancellation, late-response identity, account replacement, unknown write outcomes and shared-summary invalidation races.
- Backend bounded reads: 58 targeted tests; a further 56 existing user/audit tests passed on current-main integration. Backend TypeScript build passed.
- Adjustment: 21 service/API tests and 10 actual PostgreSQL HTTP checks, including 20 concurrent repeats with one balance change, independent keys, response-loss recovery, rollback on audit failure and subsequent health response.
- Existing actual-build browser fixtures: access gate 26 checks; deletion 20 checks with a disposable PostgreSQL database and desktop/mobile views; deposit packages 30 scenario groups; copy log 71 checks; KYC 10 scenario groups with both PostgreSQL and memory fallback. Protected-document/Worker/CORS checks use synthetic data and a local mail sink, not a real mailbox.
- Independent final review reproduced an audit render crash for JSON-null metadata; null-safe result rendering preserves the original masked details. Regression includes null, string, number, boolean and array payloads. The test-only helper was moved out of Jest test discovery, without suppressing tests.
- Full Linux frontend CI passed 3,708 tests in 215 suites at head `29ce4c8445c0f7118bb8702fb994bfbec75be9d0`; the final head is checked separately on the PR. The deletion browser harness also exposed a debounce race in the test: it opened an existing unfiltered row before the filtered response replaced the list. A delayed-response fixture reproduced the old sequence three times; the corrected harness awaits the exact filtered response and rendered row, and asserts zero DELETE requests through cancellation. No deletion product behavior was changed for this test fix.
- Additional built workflow fixture: filtered Back navigation, one debounced search, bounded lazy history, 500/offline/retry retaining last data, keyboard focus, explicit 404, adjustment review/cancel with zero writes, and truncated committed-response recovery via GET without a second application POST.
- Screenshots: Users, detail, Deposits, Withdrawals, KYC, OTC, Wallets and Audit at 1920/1440/1366/390. Added an explicit mobile-card visibility assertion after a real CSS conflict was reproduced by deletion QA; checking page overflow alone did not detect that defect.

## Performance and reproducibility

- `ADMIN_READ_PERFORMANCE_20261003.md`: actual isolated PostgreSQL measurements, 3,420 final samples over 40/1,000/10,000-user datasets. `ADMIN_READ_INDEX_PROPOSAL.md` is a proposal only; no index migration was applied.
- `ADMIN_BROWSER_PERFORMANCE_20261003.md`: 1,080 built-browser fixture samples, cold and warm reported separately. Raw final samples are checked in as CSV. It explicitly reports slower cases and distinguishes UI fixture timing from actual SQL measurements.
- No claim of lower total SQL across all Admin activity: the new shared visible summary reads more counters every 30 seconds, whereas some old counters refreshed much less often. Lazy histories, bounded list responses, duplicate-summary consolidation and removal of the separate Deposits polling address different costs.

## Local comparison

Run `scripts/qa-admin-practicality.cjs` against each built bundle with `QA_VARIANT=before|after`; screenshots and raw browser results are written below `output/admin-practicality`. Copy `scripts/admin-practicality-comparison.html` to that output directory as `compare.html`. `QA_PREVIEW=1 QA_PORT=4402` serves the working fixture UI and `/__qa/evidence/compare.html`. No API request has a production fallback; the server binds only `127.0.0.1` and CSP confines the preview to local resources.

Before/after catalogue screenshots use different catalogue feature-flag modes and must not be represented as an identical-mode visual comparison. The comparison page therefore focuses on the other seven screens.

## Limits retained explicitly

- Pending financial intent is memory-only and session-scoped. Full reload/logout loses the frontend recovery pointer, though a committed Spot operation receipt remains durable on the server. Do not infer that an unknown outcome failed or start a new key without checking audit/balance.
- Legacy demo top-up does not gain durable idempotency in this change. Its unknown result remains locked in the current session for manual reconciliation. Execution/accounting stays unchanged.
- No production integration, real provider transfer, real mailbox delivery, browser crash persistence or real financial mutation was tested.
- Browser data is synthetic; small local timing differences are not a production latency guarantee. React profiler CPU and production DB plans were not measured.
- The pre-existing large frontend chunk warning remains; this review does not change the trading bundle architecture.
- `qa-admin-console.cjs` is an obsolete, unreferenced overview-design capture harness; it was not rewritten as part of current mounted-route/CI coverage.
