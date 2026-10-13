# Matched initial-registration experiment

The three pristine-service client timelines at harness `ed3d1578b4abbe932d5cd35680fcf3e31839dfb3` found **89 failed attempts, all among the first50 state requests of each run**. Failed attempts started8.2–13.8ms into the run. The subsequent3552 requests had no errors. This supports testing an initial-registration scheduling hypothesis; it does not prove that SQLite alone caused the timeouts, and all three original workload gates remain FAIL.

Candidate: when an otherwise-idle queue is headed by `ensure`, dispatch-origin admissions share one `setImmediate` opportunity before the existing pump runs. Entries retain original timers, bytes, logical count and FIFO position. At dispatch the unchanged queue deadline check and max32 registration group apply. Worker completion, abort, timeout and close drains remain immediate; terminal lifecycle clears the scheduled callback. No wait-for32, queue allowance, provider budget, FULL durability, financial arithmetic, quote freshness, cancellation or idempotency rule changes.

Single or reopened owners can pay an extra turn without benefiting from grouped writes. Under5ms/100ms quota, this can cross a throttle boundary. Safety tests are necessary but do not establish a performance improvement.

The separate runner schedules **six** runs: baseline/candidate, candidate/baseline, baseline/candidate. All use identical bounded client capture and original **0.05vCPU,256MiB,1MiB/s read,128KiB/s write,50mixed users,20instruments,30seconds,3second deadline**. Existing phase and timeline runners and artifacts are unchanged.

```sh
STOCKS_REGISTRATION_512_APPROVED=true \
STOCKS_REGISTRATION_512_OUT=/absolute/new-empty-output \
STOCKS_REGISTRATION_CANDIDATE_SHA=<exact-checked-out-40-character-commit> \
STOCK_REALISTIC_DISK=/verified/disposable-mount \
STOCK_BENCH_DEVICE=/verified/backing-device \
BENCH_CPU=0 LOAD_CPU=1 \
node services/stocks/phase-trace-512/registration-run.mjs
```

Use disposable Linux Node24.21.0/Docker; choose distinct available CPUs. No production access or secrets. The image build uses no network; synthetic fixture providers issue zero external API calls. Disk ancestry, actual throttling proof, runtime cgroups, read-only container, cap-drop and no-new-privileges remain enforced. Output must initially be empty. Preserve host metadata afterward.

Baseline service source is immutable `06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb`. The full candidate commit's three service directories are inspected. Any runtime modification, addition or deletion outside `account-worker.mjs` is rejected. Its canonical hash must match reviewed `registration-sources.json`. Only exact-listed diagnostics/tests may differ; they are recorded and excluded from both service images. The resulting candidate image contains exactly the baseline92 files with one reviewed replacement. The client shadow is built separately from the baseline reader; neither service imports timeline capture.

Each run retains raw counters/timeline, explicit error codes, CPU, cgroup peak RAM/throttling, I/O, SQL stage counts and capture reconciliation. Matched pairs retain first50 and later errors, latency, explicit COMMITs and registration grouping. Infer standalone INSERT transactions carefully from source and actual observations; COMMIT wall is not an fsync timer. Unknown fsync count remains N/A.

Collection completeness and capture integrity are separate from workload acceptance. Any HTTP error or deadline remains FAIL. Capture overflow/mismatch fails the diagnostic; unstarted runs remain INCOMPLETE on abort. Cleanup/log errors cannot mask the original error. Prior89/113/85 error totals are separate baseline runs, not evidence of improvement.

Required evaluation: compare all three matched pairs, transaction/I/O counts, initial failures, late-started failures, CPU and p95. Keep the candidate only if evidence supports the intended benefit without safety/steady-latency regression. The original hard capacity and crypto-coexistence gates still apply; this experiment cannot certify the deployment.

Tests:

```sh
node --test services/stocks-global/account-registration-turn.test.mjs services/stocks-global/account-registration-batch.test.mjs services/stocks-global/account-registration.test.mjs services/stocks-global/account-worker.test.mjs
node --test services/stocks/phase-trace-512/registration.test.mjs services/stocks/phase-trace-512/timeline.test.mjs services/stocks/phase-trace-512/instrument.test.mjs
```

## Measured disposition

The candidate at `28aa7bac5c8a8d2cee53fb1a7c53765e6c9b9441` is REJECTED and removed from active runtime. Run38420023113/artifact11825992910 records baseline88 deadlines versus candidate89; steady p95 worsens in all three pairs. The exact candidate and its safety tests remain in that commit. Source-guard tests read the archived candidate, not the restored worker. Reproduce only by deliberately checking out that exact historical commit and following the original isolated instructions; do not run its experiment against the final restored runtime. Full measured comparison: `docs/qa/stocks/REGISTRATION-PAIR-28AA-20261013.md`.