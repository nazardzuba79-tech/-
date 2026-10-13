# Exact PR #512 account/HTTP phase diagnostic

This diagnostic is pinned to `06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb`. It does not edit runtime files or replace acceptance workloads. All 92 archived Stocks source files must match the allowlist, including financial logic, original reader, limits and I/O proof.

The final bounded CI data for this SHA contains 85 failed HTTP attempts (29/25/31), all `DEADLINE_3000MS` on `state`. History and chart reads did not fail in these repeats. Internal queue timeout counters (32/19/6) are separate events, not additional failed HTTP attempts. The SQL counter records two explicit COMMIT calls for two registration groups containing 49 accounts; the first account's standalone INSERT also autocommits under FULL. These counters are not total transaction/fsync counts. No quote commits occurred. This identifies a need to profile the worker queue/transport and projections. It does not establish that fsync or JSON serialization caused each request timeout.

## Invocation

Run on an existing approved disposable Linux runner with Docker and a verified disposable block mount; do not install infrastructure or use production:

```sh
STOCKS_PHASE_512_APPROVED=true \
STOCKS_PHASE_512_OUT=/path/to/artifacts/phase512 \
STOCK_REALISTIC_DISK=/path/to/disposable/mount \
STOCK_BENCH_DEVICE=/dev/verified-disposable-device \
BENCH_CPU=0 LOAD_CPU=1 \
node services/stocks/phase-trace-512/run.mjs
```

The runner archives the immutable source, transforms a disposable copy, builds pristine and shadow Node 24.21 fixture images without dependency install or migrations, proves disk limits using the unchanged direct-I/O probe, and runs three counterbalanced pristine/OFF/ON blocks (nine runs). Pristine executes the original archive with no fixture edits. OFF uses the same wrappers as ON with recording disabled. Service limits remain 0.05 vCPU, 256 MiB, 1 MiB/s reads and 128 KiB/s writes. Original 50 mixed users, 20 instruments, two-second state cadence, six-second chart changes, 30-second duration and three-second deadlines remain unchanged. The load generator and coordinator are on a separate CPU outside the service cgroup. CPU quota is a ceiling, not a reservation of physical compute.

## What is measured

- Existing queue and roundtrip durations by command type, all commands, reusing existing timestamps.
- One-in-16 samples of worker execution, synchronous `postMessage` in both directions (main/worker roles separate), ledger parsing/validation, read projection, HTTP serialization, auth and status waiting.
- Bounded shared-memory numeric counters; one writer per thread region. No AsyncLocalStorage, per-event disk writes, extra heartbeat or identity/body/price/SQL tracing.
- Existing worker SQL counters, including COMMIT wall/thread CPU; cgroup CPU/I/O/OOM and memory.peak, sampled process RSS, all reader errors and success-only versus all-attempt latency.
- Each block reports pristine→OFF wrapper overhead, OFF→ON recorder overhead and pristine→ON total overhead: CPU/attempt, throughput, p95, failed attempts and peak-memory changes. Material overhead invalidates causal extrapolation to uninstrumented acceptance. Host cgroup reads collect the actual memory peak without adding a process to the service container.

Do not sum nested phases or subtract sampled worker execution wall from unaligned all-command roundtrip totals. Async main-thread CPU spans may contain unrelated work during await; only synchronous CPU spans support attribution. Worker CPU is already included in process CPU. Queue/roundtrip CPU is not measured. COMMIT wall time is **not fsync syscall latency**, and cgroup IOPS are **not individual fsync counts**. These syscall metrics remain unavailable without separate syscall evidence. Shared-counter snapshots can include an in-flight sample; pending queue/worker metrics are retained.

`results.json` retains all nine runs, failed attempts and raw stage aggregates; unscheduled runs remain INCOMPLETE after abort. `receipt.json` hashes it. The runner never emits an acceptance PASS or a production capacity claim. Instrumented fixture-only data never enters a public catalog.
