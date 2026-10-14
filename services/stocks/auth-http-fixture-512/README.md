# Compiled-auth HTTP diagnostic for PR512

**Review implementation, NOT LAUNCH READY. No production endpoint or capacity acceptance is created here.** The existing targeted HTTP workload and its recorded failures remain unchanged. This fixture has no workflow that starts its workload automatically.

The current verified baseline (`03bdc89fa802e958b80d85a8add8a952f522b890`) passes the finite principal contract, isolated Stocks and frontend tests. It fails full backend and the strict browser prerequisite. Historical 20/50-user capacity and crypto coexistence criteria remain unmet. Cheap fixture guards cannot clear those release gates.

## What the comparison measures

P uses the freshly compiled existing `accountRouter` profile response with a near-1 MiB fixture avatar. C uses the same compiled `requireAuth`, session/contact policies and asynchronous route handling, then a second user-existence lookup selecting only `id`. C is a QA-only alternative projection. It is not installed in the application API and introduces no authentication or revocation cache.

Both pass through unchanged Stocks identity resolution, local proxy, HTTP service and SQLite account worker. This paired comparison changes projection, serialization, transport and parsing together. It cannot attribute differences solely to JSON parsing or real SQL. Authority queries use isolated in-memory fixture records, not a database; their counters must be labelled accordingly.

Resource measurements include fixture instrumentation, private control messages and drain sampling. A slower variant can require more drain observations. These costs must remain visible; the result cannot be presented as instrumentation-free production capacity.

The only account operations are registration and state reads for 50 disposable principals. Bootstrap uses the existing account-worker API and unchanged default test balances: 10,000 USDT and 10,000 USDC per principal, zero reserve, fee zero, no orders, positions, fills or adjustments. The closed seed is validated, hashed and copied per variant. No public balance reset or trade command is used. FULL durability and order/idempotency behavior remain in the unchanged runtime and their existing regressions.

## Bounded plan

Three paired repeats use P/C, C/P, P/C order. Cohorts rotate 5/20/50, 50/5/20, 20/50/5. Each cohort has three waves; the next starts only after all requests terminate and all handler, authority and account work drains. Both sets of 52 direct/resolver contract requests must pass before either timed variant in each pair. Each timed variant also passes 17 gateway safety requests.

The paired prechecks use a separately measured idle namespace keeper and sequential fresh P/C authorities. The keeper opens neither Stocks nor SQLite, has the original service resource limits, adds no HTTP requests, and is removed before timed variants. Its cost is retained as prerequisite overhead. Each timed variant then gets a fresh service, authority/session map and closed seed copy.

- Ordinary attempts: 225 per variant run, **1,350 total**, three-second deadline, no retries.
- Separate scheduled abort attempts: 5 per run, **30 total**, scheduled at 250 ms. Completion before an abort is reported honestly; no actual admitted abort means coverage is not proven.
- Warm-up state reads: **300**. Gateway safety: **102**. Direct/resolver contract calls: **312**.
- Initiating requests: **2,094**, plus at most **240** startup health probes. Nested authority calls are separately correlated and not counted twice.

This is a finite closed-loop diagnostic, not fixed-rate capacity or 20/50 active traders. Service, gateway and SQLite share the original 0.05 vCPU / 256 MiB / no-swap budget with 1 MiB/s read and 128 KiB/s write limits. Authority and driver have separately measured 0.5 vCPU / 256 MiB budgets on another CPU. There is no same-core crypto coexistence claim. Startup/bootstrap, measured work and tail-drain costs are reported separately.

## Safety and freeze requirements

The runner requires Linux, reviewed exact source/build/lock/native-library hashes, an immutable official image reference, and a reviewed launch manifest. These inputs are not supplied by this directory. A marker or locally invented manifest is not approval.

Before execution, independently verify the compiled dependency closure, exact seed principal IDs and balances, container identity/environment, no-network namespace, non-root identity, read-only filesystem, capabilities, quotas and actual backing-device I/O limits. Only owned service/authority cgroup subtrees may be mounted read-only for measurement; no whole-host cgroup mount is allowed. Fixture tokens stay in a private file and private IPC; headers, tokens and profile bodies are excluded from evidence.

The source and pure-guard review must also prove monotonic deadline classification, actual asynchronous-handler drain after disconnect, bounded IPC, hard watchdogs, child exit/OOM handling, observed versus unmeasured durability metrics, complete request reconciliation and owned cleanup. Missing provenance or incomplete accounting is **INCOMPLETE**; a safety assertion failure remains **FAIL**. Neither becomes PASS because the runner exited.

No broker, provider quote/history endpoint, real database, production account, server, collector or deployment is accessed. MOEX/SBER remain blocked and commercial redistribution rights are unresolved. The fixture must not be used to waive those release blockers.

## Cheap checks only

`node --test services/stocks/auth-http-fixture-512/authority.test.cjs services/stocks/auth-http-fixture-512/fixture.test.mjs`

These checks exercise pure guards and disposable local fixtures; they do not start the workload, Docker, a compiled authority or an HTTP trading session. Any future load result must carry its own exact source/image/resource manifest and raw failures. Prior evidence is retained separately.

## Separate preparation-only CI

The PR512 preparation job runs only after all existing Stocks jobs terminate and its required admission, isolated-stage, frontend and bounded-runtime prerequisites pass. It does not call the old stage main or the disabled auth runner. It downloads the successful same-run/same-head stage ZIP and checks its artifact digest, source SHA, stage PASS report, original Node22 compiler proof, canonical source bytes and six emitted authority modules. Node24.21.0 runtime/image identity is separate from that compiler provenance.

The explicit `--prepare` command creates an allowlisted context, installs locked dependencies with lifecycle scripts disabled, and creates one closed 50-account SQLite seed through the unchanged account-worker API. This setup is outside the timed auth experiment. It records dependency/native and Node identities, seed integrity/ledger hashes and setup costs. The actual worker connection synchronous pragma remains UNMEASURED; source-configured FULL is not mislabeled as an observed runtime query.

Only new owned context paths receive public read modes; installed browser/system permissions and security policy are untouched. Execution containers are nonroot, read-only, network-none or the owned namespace, with no capabilities, no-new-privileges, explicit CPU/RAM/no-swap and original disk limits. Owned idle cgroup/backing-device evidence is configuration proof and must be rechecked before a later load test. No authority, HTTP request driver, quote provider, broker, browser, production database or financial request runs during preparation.

All operations are bounded and owned containers/images are removed. The immutable image archive, closed fixture seed and hashed reports are retained as QA artifacts; no image is pushed to a registry. The output is **PREPARED_NOT_AUTHORIZED**, never a launch authorization or capacity PASS. A separate review must still freeze the actual prepared image, compiled/npm/native closure, seed, source manifest, request counts, limits and cleanup contract before any auth HTTP measurement. Existing release failures remain failures.
