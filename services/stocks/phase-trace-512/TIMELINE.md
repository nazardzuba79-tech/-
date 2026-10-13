# Targeted pristine-service request timeline

This optional follow-up answers a question that the nine-run phase diagnostic cannot answer: when do failing attempts start and finish? Existing aggregates discard timestamps. A late timeout is not proof that a request started late.

Only three exact-source runs are scheduled. The service image is built from unchanged `06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb`. Its HTTP, worker, SQLite, financial rules, original reader source and acceptance files are not modified. The client uses a separately guarded shadow of the original reader with capture/export additions only. The earlier pristine/OFF/ON artifacts remain separate and unchanged.

Run only on a disposable Linux Node **24.21.0** CI host with Docker. No production access, secrets, broker calls or external provider requests are needed.

```sh
STOCKS_TIMELINE_512_APPROVED=true \
STOCKS_TIMELINE_512_OUT=/absolute/new-empty-output \
STOCK_REALISTIC_DISK=/verified/disposable-mount \
STOCK_BENCH_DEVICE=/verified/backing-device \
BENCH_CPU=0 LOAD_CPU=1 \
node services/stocks/phase-trace-512/timeline-run.mjs
```

`BENCH_CPU` and `LOAD_CPU` are examples; choose distinct available CPUs. The coordinator and reader are pinned outside the service cgroup. The existing validated block-ancestry check accepts a mounted partition backed by the configured parent disk, and rejects unrelated disks. Direct I/O proof and runtime cgroup checks retain **0.05 vCPU / 256 MiB / 1 MiB/s read / 128 KiB/s write**. All three runs retain **50 users / 20 instruments / mixed / 30 seconds / 2-second state cadence / 6-second chart changes / 3-second deadlines**. No queue limit, provider limit, TTL, durability or workload threshold changes.

The runner enables the client only with both `STOCKS_TIMELINE_512=1` and `STOCKS_TIMELINE_512_FIXTURE=isolated-issue505`. These gates are passed explicitly to the child; inherited application environment is discarded. The pristine service receives neither gate.

Each bounded row contains attempt number, relative start/end milliseconds, route class, actual HTTP status, outcome, allowlisted transport/public error code, observed client cancellation and response-complete flag. Headers may arrive before a body times out; response-complete is required to reconcile the original summary's status counts correctly. No headers, user/account/instrument IDs, URLs, bodies, payloads or arbitrary exception text enter the timeline. There are at most **2048** rows and no per-attempt disk writes. Capture overflow, missing attempts, invalid chronology, mismatched counters or unmatched all-attempt latency quantiles are **CAPTURE_FAIL**. Raw original aggregates and failures are retained.

Results include separate bins by attempt start and end: 0–3, 3–6, 6–12, 12–30 and 30+ seconds. Reconciliation reports capture integrity separately from original workload acceptance. Collection completion never turns HTTP errors or timeouts into PASS. Unscheduled runs after abort remain INCOMPLETE. Logs and cleanup errors cannot mask the initial failure; receipts hash final results even on incomplete collection.

Client capture overhead is not assumed to be zero just because the client is outside the service cgroup. These runs provide temporal attribution, not new capacity certification. They can distinguish failures of attempts started during initial registration from failures of later attempts; they cannot alone prove that registration, SQLite fsync or one CPU stage caused an individual timeout. Actual fsync count/latency remains N/A without syscall proof.

Validation:

```sh
node --test services/stocks/phase-trace-512/timeline.test.mjs
```

Focused loopback fixtures check byte-preserved service/financial source, source/anchor rejection, original-vs-shadow aggregate agreement, real three-second cancellation after HTTP headers, safe ACCOUNT_BUSY/RATE_LIMIT/unknown422 codes, chart failures, history pagination, response-size cancellation, gating, privacy, overflow and failed reconciliation. Their short validation workload is not a replacement for the three original-budget CI measurements.
