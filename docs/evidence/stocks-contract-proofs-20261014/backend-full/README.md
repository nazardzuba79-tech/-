# Full backend verification — retained attempts

## Main integration, a9d5: FAIL

Commit `a9d5b9bd85fe96e8dcb31ec7a6b315f9730d2900` integrates main `d694b2a0c493c0fad7d496ae47a15ad8eb0429a6`. [Run 38516409918 / job 115698882650](https://github.com/nazardzuba79-tech/-/actions/runs/38516409918/job/115698882650) executed the full inventory: **251 suites: 234 passed, 5 failed, 12 skipped; 3,714 tests: 3,581 passed, 9 failed, 124 skipped**. No assertion or test was removed. The original 249 test blobs are unchanged; two upstream Futures refusal-code suites add six passing tests.

[Raw result](linux-a9d5-result.json) and [independent audit](linux-a9d5-review.json) preserve the terminal failure. Artifact `11872862433` has SHA256 `5fd75f0efc2cb1fc1cb1328fa077add416a791a5c304b9dd563c99a52485e029`; raw Jest SHA256 is `9bee3895ba524386b9212083e52a7851c692943297390e724240df08c05fde0a`. All five failure messages and 13 related source files match the prior 03bd attempt byte-for-byte. The TypeScript prerequisite passed and recorded 562 outputs. All 4,811 canonical source bindings, complete inventory, isolated execution and owned cleanup were audited. No OOM, timeout or log truncation occurred. Matched-main execution and database acceptance remain **NOT_RUN**.

The next scheduling manifest may reuse this result only for the exact individually reviewed QA fixture, workflow and evidence bytes. Any runtime/backend/auth/financial code, original test, schema, lockfile, compiler, build prerequisite, unknown path or unreviewed byte change still requires FULL. A reused result means **NOT_RUN with prior FAIL preserved**, never a release PASS. This does not waive the separate browser, durability, capacity, coexistence or data-rights blockers.

## Prior Linux result after the build prerequisite: FAIL

Commit `03bdc89fa802e958b80d85a8add8a952f522b890`, [run 38512859056 / job 115685235180](https://github.com/nazardzuba79-tech/-/actions/runs/38512859056/job/115685235180), completed naturally: **232 passed, 5 failed, 12 skipped suites; 3575 passed, 9 failed, 124 skipped tests (3708 total)**. The direct locked TypeScript prerequisite passed in 9.771 seconds and recorded 560 emitted files. The formerly missing native-review modules now exist and all seven native-review tests pass. No timeout, OOM, output overflow or cleanup failure occurred.

[Original result](linux-03bd-result.json) is unchanged; [derived review](linux-03bd-review.json) binds raw Jest and build-proof hashes. The nine assertion failures in provider behavior, CFD naming, collector isolation and canonical Copy Trading hashes remain, as does the opted-out PostgreSQL suite constructor failure. All five failing test files match current main bytes; matched-main execution remains **NOT_RUN**. Database acceptance, browser acceptance and production capacity are not established.

Original Windows and `0dd1c1d5` evidence below remains retained. A later exact reviewed preparation-only change may skip repeating this backend workload while preserving this **FAIL**; unknown/runtime/compiler/lock/test changes must require full execution.


## Linux exact-head result: FAIL

Commit `0dd1c1d5edf51593ef28896bfee4af8ed9e56b26`, [run 38507741590 / job 115669010443](https://github.com/nazardzuba79-tech/-/actions/runs/38507741590/job/115669010443), completed naturally with exit 1. All 249 backend filenames have terminal results: **231 passed, 6 failed, 12 skipped**. Tests: **3568 passed, 9 failed, 124 skipped**, 3701 total. No timeout, OOM or log overflow occurred. Database acceptance is **NOT_RUN**; cleanup succeeded and canonical source stayed unchanged.

[Original result](linux-0dd-result.json) is copied byte-for-byte. Its empty `skippedSuites` list is a reporting bug, not an absence of skips. [Derived review](linux-0dd-review.json) binds the raw Jest and artifact hashes, lists all 12 skipped suites, and separately records 13 pending assertions in the partly skipped `service.integration.test.ts` suite. The original counters and failures are retained.

The six failing suites are ProviderFailureMatrix (5 assertions), CfdMarketDataService (1), LiveFinancialIsolation (1), CanonicalSourcePreservation (2), vtaNativeCoexistence.pg (Prisma construction during skipped-suite collection), and nativeReviewHarness (missing compiled `dist` prerequisite). The six failing test files and 13 inspected source files are byte-identical to main `055f88a945c8253b2736877b52f32d028c895086`. This is a source comparison; a matched-main full-backend execution was **NOT_RUN**.

The follow-up QA helper corrects skipped-result classification and prepares a direct locked TypeScript compilation of canonical source in the inspected offline container before Jest. It requires fresh `dist`, bounds output and execution, verifies required native-review modules and unchanged source, and preserves raw compiler diagnostics. It runs no npm lifecycle hook, server, migration or database opt-in. This changes a build prerequisite, so full-backend admission must remain **FULL**, never a report-only skip. The compiler and full Jest execution of this follow-up are **NOT_RUN** until the reviewed change reaches CI. It does not repair or waive the nine assertion failures in unrelated modules.

## Retained Windows first attempt

Source: `3fb092dc1475543240059556fb0cf033c7f967b3`. This is additional backend coverage work, not a Stocks capacity test.

The single Windows canonical-source attempt exited naturally after 90.444s (exit 1). It logged 29 PASS and 10 FAIL suite lines; 210 of the 249 backend suites had no terminal result. No terminal Jest JSON was produced. **INCOMPLETE; no full-backend PASS claim.** All canonical source hashes remained unchanged.

Two QA-boundary compatibility problems were observed: explicit loopback binding made Supertest's immediate server.address() unavailable, and the strict native-addon path guard rejected bcrypt. Separately, module-scope PrismaClient construction initialized its native engine asynchronously even in an opted-out database suite. The native-engine fence rejected that load and the unhandled initialization rejection terminated the combined run. The rejection was not suppressed; the database/engine was not mocked into success. Four passing finite guard selftests did not prove full Jest compatibility.

The shared generated Prisma 5.22.0 client was not regenerated for this exact schema. Its provenance and the full raw stdout/stderr, command, guard, source manifest and denied-operation journal remain outside Git at the relative evidence location in windows-r1-incomplete.json. That file binds their SHA-256 values. Logged PASS/FAIL lines are partial observations, not aggregate Jest counts or proof of database integration. No process was manually killed and no product/test source was changed to obtain a pass.

The proposed replacement is a separate Linux QA image with fresh lockfile dependencies and schema generation, followed by an inspected Docker network=none test container. It preserves the original Jest config and all 249 backend filenames, permits real native libraries only inside that network namespace, supplies test-only environment values, and leaves all database opt-ins disabled. Native library loading is not database acceptance. Its implementation/guard tests are review evidence; a genuine terminal CI result is still required.

The final finite helper guard suite passed 10/10 on local Windows Node24.21.0 (139.5886ms); zero skips. `offline-helper-guards.txt` is the raw result and `offline-helper-source-manifest.json` binds the reviewed helper, Dockerfile and tests. These checks cover source/path identity, exact249 inventory, namespace/egress/mount/env boundaries, output isolation, and the false-PASS artifact edge. They do not execute Docker or substitute for the pending Linux backend workload.
