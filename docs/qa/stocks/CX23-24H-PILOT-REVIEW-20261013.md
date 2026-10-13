# VOLTEX CX23 — finite passive resource pilot

**Status: revised source for review; no sampler launched by this change.** No application deployment, database connection, financial operation, host reconfiguration, subscription or tariff change. A complete resource trace is not Stocks capacity acceptance.

Related: PR #515, PR #512, Issue #505.

## Evidence and finite execution

The original source could start a sample at the 24-hour deadline, catch up missed slots, finish a non-divisible window early, sleep through SIGTERM, and classify zero samples plus an end marker as complete. The original virtual-clock reproductions remain outside the repository. They are not host observations.

Schema 2 samples a fixed grid strictly before the monotonic deadline. A 24-hour/60-second plan has exactly 1,440 slots, starting at 0 through 86,340 seconds. It waits the remainder after the last sample; timer wakeups are rechecked against actual monotonic time. Late wakeups or overruns skip slots and record gaps, without catch-up traffic. Start tolerance is min(1,000 ms, interval / 10). Fractional requested durations round upward to the nearest millisecond.

SIGINT/SIGTERM interrupts sleeps, setup and collection. Setup/sample work has a 12-second bound or the remaining duration, whichever is smaller. The internal watchdog starts after private output creation, terminates at duration + 2 seconds and stays active during evidence close. A separate OS watchdog is mandatory: JavaScript cannot terminate itself while its event loop is blocked. The outer timeout covers the whole launch, including output setup and the process group (Docker descendants); do not use --foreground. A killed or truncated trace is incomplete.

The report independently validates schema, actual UTC start/planned/end times, elapsed duration, slot count/order/timing, required metrics, requested container/process identities, gaps/errors and output bound. Missing, malformed, legacy or interrupted coverage cannot pass. Sampler and report exit nonzero on incomplete evidence. Partial numeric observations remain available with actual sample counts. Sub-microsecond floating point representation does not fabricate an evidence gap.

## Privacy and bounded output

Output is a new exclusively-created 0600 regular file in an owned 0700 directory. Existing files are not overwritten; existing permissions are not changed. Symlinked output directories/ancestors and multiply-linked files are rejected. The parent of the new private directory must already exist. Use a new private directory per run.

Default output limit: 16 MiB, configurable only within 64 KiB–64 MiB. Terminal evidence has a reserved 2 KiB allowance inside the limit. The output-filesystem free-space floor is at least 64 MiB and is checked before every record. Hitting either bound stops collection and cannot produce success; the end record itself can be unavailable when space is exhausted. Root-filesystem capacity and output-filesystem free-space checks are distinct.

Host reads are limited to aggregate proc CPU/memory, optional PSI and filesystem capacity. No HTTP probes, provider requests, databases, wallets, application logs, process command lines or environments are read.

Docker is opt-in and requires 1–20 explicit containers. The executable is pinned to /usr/bin/docker. Every command uses --host=unix:///var/run/docker.sock, a newly-created empty private Docker configuration and a sanitized environment. Ambient DOCKER_HOST, DOCKER_CONTEXT, user credentials/configuration and PATH cannot select a remote daemon or executable. ID-only inspection pins full immutable container IDs; later stats must return exactly those IDs. Only container inspect and stats --no-stream --no-trunc are used, with a 12-second timeout, 256 KiB output cap and SIGKILL on timeout/cancellation. Missing data remains unavailable, never zero.

Optional --pid pins PID, proc starttime and a hashed cgroup identity. PID reuse, cgroup changes, process/task races and unavailable data fail closed. Descendants are discovered from every TID's children file, bounded to 64 processes and 256 tasks per sample plus the shared deadline. Task sets and identities are checked before/after. This is a bounded snapshot, not an atomic Linux process-tree history. Threads are included in each process, never added again; RSS can contain shared pages. Cgroup-v2 counters describe the entire cgroup, potentially including other processes. Raw cgroup paths are not exported.

Reports retain per-identity process RSS, thread counts and CPU tick counters, and per-cgroup memory, CPU and I/O counter observations. Docker I/O rates use monotonic elapsed time, not wall-clock timestamps affected by NTP. They do not infer CPU tick frequency. Kernel cgroup peak can predate the sampling window. Invalid counters/membership fail closed; an empty cgroup io.stat explicitly reports unavailable I/O and incomplete requested coverage, not zero activity. Physical fsync latency is UNAVAILABLE: no syscall tracing or artificial writes are performed.

Measured sampler overhead is its own CPU microseconds, RSS/max RSS and collection wall time. CPU accounting starts after output setup and ends before terminal write/close, so it is not whole-launch CPU. Docker-child CPU is UNAVAILABLE. Total monitoring overhead and a monitor-off comparison are UNMEASURED. Collection wall time includes waits and must not be presented as CPU. These observations cannot prove a <=5% crypto impact or 50-user capacity.

## Runtime and guarded operator procedure

Requires Linux, Node 22+, /usr/bin/timeout, and /usr/bin/docker only for Docker metrics. No npm dependencies, package install, new service, cron or public port are needed. Transfer four reviewed scripts together: cx23-24h-readonly.mjs, cx23-24h-platform.mjs, cx23-24h-report.mjs, cx23-24h-readonly.test.mjs. Verify exact review SHA and file hashes before any start. Do not checkout a production repository.

1. Freshly verify the authorized host identity, resources/free space, explicit container IDs and optional process. Record source SHA, hashes, runtime hash/version and exact launch command privately. Do not read client records.
2. Resolve a verified existing Node executable. Do not assume node is on PATH. A separately approved pinned /proc/PID/exe can be used after PID starttime and executable hash verification. Its process.execPath may be invalid in the host namespace: the sampler never spawns Node through that value. Reverify if the source PID changes; do not install a runtime or alter live containers.
3. Use a new 0700 output directory under an existing operator-owned parent with umask 077. Tests use fixtures only. Run only after exact-source review.
4. Launch with an external watchdog and a minimal sanitized environment as below. In particular, inherited NODE_OPTIONS/NODE_PATH must not load unreviewed code before the sampler. Keep logs 0600 in the same private directory; preserve timeout exit status. Exit 124/137 is not success. An approved existing transient launcher may detach from SSH, without installing a scheduler.

```bash
# Placeholders below require fresh verification; not an approval to start.
/usr/bin/env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C \
  /usr/bin/timeout --signal=TERM --kill-after=2s 86402s "$NODE_ABSOLUTE" \
  "$SCRIPT_DIR/cx23-24h-readonly.mjs" --hours=24 --interval-seconds=60 \
  --tag=pilot --docker=true --containers=EXPLICIT_API_ID,EXPLICIT_DB_ID \
  --pid=VERIFIED_PID --out="$PRIVATE_OUT/resource.ndjson"
# After termination, using the same reviewed source:
/usr/bin/env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C \
  "$NODE_ABSOLUTE" "$SCRIPT_DIR/cx23-24h-report.mjs" "$PRIVATE_OUT/resource.ndjson"
```

Start/end timestamps are actual UTC ISO values written by a run, not invented in advance. A passive day observes only the workload actually present. It does not create a Stocks workload or establish a live Stocks trading test.

Operational completion requires **sampler exit 0 AND complete report coverage**. Preserve the sampler/watchdog exit in a separate private sidecar. The end record is written before closing the file: a later close failure or watchdog kill can leave a complete-looking trace, which must not override a nonzero or missing process exit. The report alone cannot verify that external exit evidence.

## Validation and release limitations

The first actual host sample failed coverage: its valid Linux CPU counter `core_sched.force_idle_usec` was rejected by the original flat-key grammar. First attempt status is **FAILED / STOPPED**, with owned launcher/watchdog/collector absent and cleanup complete. The failed trace SHA256 is `d58f1965e5de589fd27a5c4be05ae1dc28bd83ef68ba3f8750f7435425775a2a`; it is preserved and is not relabelled as a successful run. The shared CPU parser now accepts well-formed dotted extension counters while requiring `usage_usec`, `user_usec` and `system_usec` exactly once as safe nonnegative integers. Missing, duplicate or malformed values still fail closed in both collection and independent reporting. An actual-field-shape fixture failed before the correction; the expanded local suite passes 26/26, and the previously recorded host counter text is accepted locally. This source correction itself does not relaunch or validate a new host run.

Local tests use synthetic proc fixtures and virtual clocks, not market quotes or production measurements. They cover the full virtual 24-hour plan, a real one-second monotonic timer regression, deadline/remainder/no catch-up, interruption, collection/watchdog bounds, partial writes, output budgets, malformed/missing evidence, PID reuse/task churn/nonleader children, local Docker identity and Linux permission/ownership guards. Actual 0600/0700 assertions run on Linux; Windows tests exercise Linux mode predicates through fixtures and native exclusive output creation. The handoff records exact final count and runtime; Windows execution is not claimed as Linux testing.

Existing acceptance gates remain unchanged: original Issue #505 resource criteria FAIL; B v2 has 24/30 PASS with 334 HTTP RATE_LIMIT failures and 347 embedded observations counted separately; no matched control proves <=5% crypto p95 impact; commercial data redistribution rights are NOT CLEARED; MOEX/SBER remains blocked.

Any tariff decision needs actual app traffic/errors, provider budgets, crypto p50/p95/p99, cache behaviour and a matched control. Idle host metrics are insufficient. Provider limits and missing rights are not fixed with RAM. No merge, application deployment, financial action or server upgrade is authorized by this document.
