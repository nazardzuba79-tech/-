# Compiled-auth HTTP diagnostic for PR512

**Finite CI diagnostic; no production endpoint or capacity acceptance is created here.** The existing targeted HTTP workload and its recorded failures remain unchanged. A separate serial job can invoke the explicit launcher only after same-head preparation and exact source, policy, image, seed and resource admission. A preparation PASS alone does not authorize execution or establish capacity.

The current verified baseline (`03bdc89fa802e958b80d85a8add8a952f522b890`) passes the finite principal contract, isolated Stocks and frontend tests. It fails full backend and the strict browser prerequisite. Historical 20/50-user capacity and crypto coexistence criteria remain unmet. Cheap fixture guards cannot clear those release gates.

## What the comparison measures

P uses the freshly compiled existing `accountRouter` profile response with a near-1 MiB fixture avatar. C uses the same compiled `requireAuth`, session/contact policies and asynchronous route handling, then a second user-existence lookup selecting only `id`. C is a QA-only alternative projection. It is not installed in the application API and introduces no authentication or revocation cache.

Both pass through unchanged Stocks identity resolution, local proxy, HTTP service and SQLite account worker. This paired comparison changes projection, serialization, transport and parsing together. It cannot attribute differences solely to JSON parsing or real SQL. Authority queries use isolated in-memory fixture records, not a database; their counters must be labelled accordingly.

Resource measurements include fixture instrumentation, private control messages and drain sampling. A slower variant can require more drain observations. These costs must remain visible; the result cannot be presented as instrumentation-free production capacity.

The only account operations are registration and state reads for 50 disposable principals. Bootstrap uses the existing account-worker API and unchanged default test balances: 10,000 USDT and 10,000 USDC per principal, zero reserve, fee zero, no orders, positions, fills or adjustments. The closed seed is validated, hashed and copied per variant. No public balance reset or trade command is used. FULL durability and order/idempotency behavior remain in the unchanged runtime and their existing regressions.

## Bounded plan

Three paired repeats use P/C, C/P, P/C order. Cohorts rotate 5/20/50, 50/5/20, 20/50/5. Each cohort has three waves; the next starts only after all requests terminate and all handler, authority and account work drains. Both sets of 52 direct/resolver contract requests must pass before either timed variant in each pair. Each timed variant also passes 17 gateway safety requests.

The paired prechecks use six additional fresh seeded service lifecycles (P/C for each pair), each with its own authority, closed seed copy and observed account-worker connection. Both prechecks complete before either timed variant. They retain exactly 52 authority/resolver cases per variant, 104 per pair; no health, provider or other HTTP cases are added. Their whole-initialization wall/cgroup costs and cleanup are reported separately, within the original overall time cap. Each of the six timed variants subsequently gets a different fresh service, authority/session map and seed copy.

- Ordinary attempts: 225 per variant run, **1,350 total**, three-second deadline, no retries.
- Separate scheduled abort attempts: 5 per run, **30 total**, scheduled at 250 ms. Completion before an abort is reported honestly; no actual admitted abort means coverage is not proven.
- Warm-up state reads: **300**. Gateway safety: **102**. Direct/resolver contract calls: **312**.
- Initiating requests: **2,094**, plus at most **240** startup health probes. Nested authority calls are separately correlated and not counted twice.

This is a finite closed-loop diagnostic, not fixed-rate capacity or 20/50 active traders. Service, gateway and SQLite share the original 0.05 vCPU / 256 MiB / no-swap budget with 1 MiB/s read and 128 KiB/s write limits. Authority and driver have separately measured 0.5 vCPU / 256 MiB budgets on another CPU. There is no same-core crypto coexistence claim. Startup/bootstrap, measured work and tail-drain costs are reported separately.

## Safety and freeze requirements

The runner requires Linux, reviewed exact source/build/lock/native-library hashes, an immutable official image reference, and a reviewed launch manifest. `launch-policy.json` pins the canonical Git inventory and observed immutable dependency/native baseline. The independently reviewed workflow pins the policy SHA256 literal and supplies same-run/head GitHub artifact receipts. Review metadata is not a cryptographic signature or a substitute for source review.

Before execution, independently verify the compiled dependency closure, exact seed principal IDs and balances, container identity/environment, no-network namespace, non-root identity, read-only filesystem, capabilities, quotas and actual backing-device I/O limits. Only owned service/authority cgroup subtrees may be mounted read-only for measurement; no whole-host cgroup mount is allowed. Fixture tokens stay in a private file and private IPC; headers, tokens and profile bodies are excluded from evidence.

The source and pure-guard review must also prove monotonic deadline classification, actual asynchronous-handler drain after disconnect, bounded IPC, hard watchdogs, child exit/OOM handling, observed versus unmeasured durability metrics, complete request reconciliation and owned cleanup. Missing provenance or incomplete accounting is **INCOMPLETE**; a safety assertion failure remains **FAIL**. Neither becomes PASS because the runner exited.

No broker, provider quote/history endpoint, real database, production account, server, collector or deployment is accessed. MOEX/SBER remain blocked and commercial redistribution rights are unresolved. The fixture must not be used to waive those release blockers.

## Finite launcher and actual durability observation

The launcher consumes one immutable image and one closed seed from the separate preparation job. It never builds, installs dependencies or seeds again. It hashes the exact GitHub ZIPs and fixed members, reconstructs canonical source from clean Git plus the same-head compiled-stage bytes, and verifies the entire prepared context before the first Docker call. Runtime Node 24.21.0 and compiler Node 22.23.3 remain distinct. Any provenance drift, unknown source or incomplete image/native inventory stops execution.

Three exact review/control files are excluded from the mutually dependent policy inventory: the policy itself, `stocks-review.yml`, and the backend admission review manifest. Their final canonical bytes are independently reviewed before push. The workflow contains executable inline orchestration and is a reviewed trust-root exception, not a policy-pinned file. The executable admission controller and every runtime/QA source file remain pinned; the scheduling manifest is never a runtime configuration input.

The consumer derives its own backing device, UID and cgroups. Preparation's idle resource proof is not reused as proof for another runner. Before any functional, health or timed HTTP request, actual service/authority limits and a fresh connection proof must pass. The fixed Node preload observes the original SQLite configuration once, restores its exact descriptor, and reads `synchronous=2` and `journal_mode=delete` on that same worker connection. It does not alter account logic. A private proof binds the run, variant, service container, image, source/context, runtime and closed seed. Missing, duplicate, mismatched or failure proofs stop admission.

Whole-init wall/cgroup accounting begins before stock initialization and includes proof writing/fsync and validation. It is not presented as isolated observer CPU or fsync cost. Original timed request windows, quotas, deadlines, request counts and all trading rules remain unchanged. PRAGMA/schema setup calls are distinct from ledger writes; every instance must close with the same seed and zero ledger/transaction mutations.

The direct `run.mjs` CLI remains disabled. Only `launcher.mjs --launch <absolute-config>` may call its exported entry after the reviewed checks. It invokes the three pairs once, with no automatic retry or fallback, preserves safety FAIL over cleanup/reporting errors, and retains INCOMPLETE for missing evidence. Strict browser, original capacity/coexistence, full-backend and data-rights failures remain independent release blockers.

## Pure checks

`node --test services/stocks/auth-http-fixture-512/authority.test.cjs services/stocks/auth-http-fixture-512/fixture.test.mjs services/stocks/auth-http-fixture-512/prepare.test.mjs services/stocks/auth-http-fixture-512/durability-observer.test.cjs services/stocks/auth-http-fixture-512/launcher.test.mjs`

These checks exercise pure guards and disposable local fixtures; they do not start the workload, Docker, a compiled authority or an HTTP trading session. Any future load result must carry its own exact source/image/resource manifest and raw failures. Prior evidence is retained separately.

## Separate preparation-only CI

The PR512 preparation job runs only after all existing Stocks jobs terminate and its required admission, isolated-stage, frontend and bounded-runtime prerequisites pass. It does not call the old stage main or the disabled auth runner. It downloads the successful same-run/same-head stage ZIP and checks its artifact digest, source SHA, stage PASS report, original Node22 compiler proof, canonical source bytes and six emitted authority modules. Node24.21.0 runtime/image identity is separate from that compiler provenance.

The explicit `--prepare` command creates an allowlisted context, installs locked dependencies with lifecycle scripts disabled, and creates one closed 50-account SQLite seed through the unchanged account-worker API. This setup is outside the timed auth experiment. It records dependency/native and Node identities, seed integrity/ledger hashes and setup costs. The actual worker connection synchronous pragma remains UNMEASURED; source-configured FULL is not mislabeled as an observed runtime query.

Only new owned context paths receive public read modes; installed browser/system permissions and security policy are untouched. Execution containers are nonroot, read-only, network-none or the owned namespace, with no capabilities, no-new-privileges, explicit CPU/RAM/no-swap and original disk limits. Owned idle cgroup/backing-device evidence is configuration proof and must be rechecked before a later load test. No authority, HTTP request driver, quote provider, broker, browser, production database or financial request runs during preparation.

All operations are bounded and owned containers/images are removed. The immutable image archive, closed fixture seed and hashed reports are retained as QA artifacts; no image is pushed to a registry. The output is **PREPARED_NOT_AUTHORIZED**, never a launch authorization or capacity PASS. A separate review must still freeze the actual prepared image, compiled/npm/native closure, seed, source manifest, request counts, limits and cleanup contract before any auth HTTP measurement. Existing release failures remain failures.

## Retained first finite launch: INCOMPLETE

Commit `405b7103491f188800e1486c9868adbee697c05b`, run `38521884772`, job `115716962365` stopped during pair 0/P service initialization with `FIXTURE_COMMAND_FAILED` (service exit 1, OOM false). The report has `runs=[]`, safety NOT_EVALUATED and no worker connection proof. Its 10.739651166-second duration is not a cohort latency measurement. Artifact `11875125835` SHA256 `8dae76229a71f9f9a29b25dd22efcf367620d6a55708be518a488c74b2568af0` is retained outside Git with the complete job log. Cleanup removed the image, owned containers and private scratch.

The same-version Node bootstrap source and a separate built-in-only worker probe expose a QA assumption error: inherited worker preloads run before Node inserts the worker script filename into `process.argv`. The targeted correction distinguishes the bootstrap argv from the actual worker argv at SQLite configuration interception. Exact executable, worker data, source, binding and runtime checks remain mandatory; there is no account, SQL, resource or request-plan change. The recorded Linux error was masked, so the missing exception code is not retroactively invented. Bounded safe failure evidence must be collected before cleanup on any subsequent incomplete initialization.

Official source: https://github.com/nodejs/node/blob/v24.21.0/lib/internal/main/worker_thread.js (module preloads precede script filename insertion). The failed launch remains INCOMPLETE regardless of later focused guards or a repair attempt.
