# Auth cancellation account-isolation follow-up

The runtime correction is already committed at `28e6f3bab18bad777f9b02e31851dfe8874f2b0e`. This follow-up strengthens the existing cancellation fixture only. Bob's response must contain the account ID derived from the fixture issuer and Bob's subject. After the Stocks server and its SQLite worker have closed, a read-only connection to the private temporary ledger must contain exactly Bob's account and no Alice account. Cleanup remains in `finally`; no shared or production database is opened.

Focused local result: **4/4 PASS**, no failures or skips, 328.3449 ms. Complete log SHA256: `aef7e6091ad878e4335c5dd12fa473ba5e289ed56f5b528d0a2925ed24fa55df`. This test result is separate from CI on the preceding commit. It does not establish concurrent-user capacity.

## Completed baseline CI

All 38 workflows for `28e6f3bab18bad777f9b02e31851dfe8874f2b0e` are terminal: 37 succeeded, Stocks failed. Both frontend jobs passed 263 suites and 4,247 tests with no skips. The isolated Stocks runtime/barrier command passed 207 tests; separate native/targeted, stage and public/package guard commands passed 24, 3 and 8 tests respectively. TypeScript and builds passed.

The full offline backend actually ran and remains **FAIL**: 251 suites = 234 passed, 5 failed, 12 skipped; 3,714 tests = 3,581 passed, 9 failed, 124 skipped. Exit code 1, no OOM, timeout or log overflow, source unchanged and no reported cleanup errors. Database acceptance is NOT_RUN. Evidence: run `38533286576`, job `115752113535`, artifact `11880028341`; ZIP SHA256 `621f2f054bdf1227cbcdb0f38e1c24296cf28c98c6fa297dcc643894a2c846c2`.

The five failing suites are `ProviderFailureMatrix` (5 assertions), `CfdMarketDataService` (1), `LiveFinancialIsolation` (1), `CanonicalSourcePreservation` (2), and `vtaNativeCoexistence.pg` (Prisma constructor failure during collection). Their five suite errors and nine assertion messages match the retained a9 artifact byte-for-byte; 13 related source files are unchanged. This comparison does not claim an equivalent full run on current main. Compiler prerequisite passed with 562 reported outputs. An independent artifact/source audit passed 81 checks, including 4,821 Git source bindings; audit v2 SHA256 `ea2a8452315e269706fe75d5a3ba83d976c6a4c6a4b4e73ff5ba959eb3f9630c`.

The browser prerequisite remains **FAIL** before Chrome executes or a browser launches: executable and parent permissions are unsafe. Evidence: the same run, job `115750950411`, artifact `11879126370`; ZIP SHA256 `5eee6f0a485202ba84f9cf5260f2cd1511f1f66c7dd9ab6eb141ccf9c2888f26`. No executable installation, permission change, sandbox/TLS bypass or browser rerun is part of this follow-up.

## Narrow scheduling and retained failures

The existing reviewed QA-only admission compares canonical Git blobs against the completed baseline. A named manifest binds each changed file, its classification and both hashes. Only the exact cancellation test, admission controls, workflow, this evidence document and an append-only handoff are eligible. Missing or stale evidence, unknown paths, runtime/frontend/lock/compiler changes, protected offline-backend helper edits and rewritten handoff require normal validation. The manifest is a reviewed inventory, not a cryptographic signature or an approval of its own contents.

Only same-repository PR #512 with exact accepted QA-only evidence may report backend and browser NOT_RUN for this follow-up. It retains both baseline FAIL records and `releaseGatePass: false`; NOT_RUN never means PASS. Other PRs retain ordinary browser behavior. Frontend and isolated simulator regressions still run. The original load selection, thresholds, finite auth experiment pins, provider limits, TTLs and runtime are unchanged.

## Release status

**BLOCKED.** Previous capacity and crypto-coexistence failures, six finite auth run failures, commercial data rights, browser/backend failures and incomplete passive production observation remain release gates. Cancellation correctness does not prove that the previous 45 compact-profile deadline failures are fixed. MOEX/SBER remain blocked, public admission remains fenced, and real funds are not used. No new benchmark, merge, deployment or production change is authorized by this scheduling evidence.
