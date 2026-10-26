VOLTEX RC50 diagnostic harness
Runtime source: 234437f8bb106cc576375ff7df9b817d3fbc01cc (#613, repinned 2026-10-26; was 6cb82e3d).
The pin is code preparation only. It does not authorize a run: the isolated
Linux scope still needs an owner-approved, unexpired host attestation, a
non-root process and a finite owned cgroup v2, and none of those is created
here. Thresholds, admission and invariants are unchanged.
This folder is test-only and is not imported by application startup.

Real implementation: current RC stocksTestCashRouter, DemoTradingService,
MatchingEngine, PostgreSQL authority, authority HTTP adapter and Stocks gateway.
Only market transport is synthetic and loopback. No echo/mock business API.

Admission: explicit scope/ack, unchanged RC runtime files, clean private-env
boundary, locked existing dependencies, fresh owned output and PG database,
127.0.0.1 only. No external target URL/DSN or production credential argument.
The launcher creates/stops only its own fresh portable PostgreSQL and Node
children; no Docker, remote server setup, software install or host changes.

Before the sole workload: static admission, source/runtime hashes, fresh
generated RC Prisma client, durable PG settings and short actual HTTP wiring
qualification. Qualification does not claim the workload run budget.
A persistent FINAL-50PLUS2-RUN-CLAIM.json is created before baseline setup.
No automatic repeat or retry is permitted.

Both arms: same Node/PG/settings, API worker heap cap, initial logical state,
5s crypto warmup, 20s fixed arrivals, 80 crypto cycles and 320 crypto requests.
Mixed: 50 distinct viewer sessions (one state/sec each, staggered), 50 direct
mutation denials, 2 allowlisted traders, 5 cycles each of Limit/cancel plus
Market buy/sell and exact intent replays. Source TTL and rate gates unchanged.
The shared DemoBalance is exercised concurrently by actual Demo Spot/Stocks.
Cash/order/receipt/viewer invariants and HTTP timeouts are checked independently.

The Windows result is LOCAL_DIAGNOSTIC only: shared unpinned host, Node24.22.0,
PG17.11, not a CX23/Node22/deployed-PG capacity certificate.
Existing financial restart/commit-before-ACK tests are referenced, not rerun.

Primary Linux wrapper: run-isolated-linux.cjs (Node syntax verified; runtime
not executed on Linux). It requires a pre-existing approved host attestation,
matching host/cgroup/runtime/expiry and finite non-root cgroup CPU/memory/PID
limits. It never creates those limits or starts Docker.
run-isolated-linux.sh is an optional equivalent shell entry; no Bash runtime
was available here, so automated Bash syntax/execution is NOT_RUN.
Do not repin/replay the older qualification-only B packet.

Run parameters, commands, hashes, qualification, workload outcome, cleanup,
known limits and the exact tested-file hash set are in the attached reports.
No owner PowerShell commands, passwords or foreground keyboard access needed.

#613 candidate pins (2026-10-26, Claude)
policy-613.cjs pins 234437f8 (reviewed #613 head, same RC as policy.cjs);
policy-613-after.cjs pins fb6577be (one-query Stocks session read). Local Windows
runs measured 783aeedd vs c010bc67, the same runtime on the PG path.
diagnostic-run-613.cjs is run.cjs with that pin, plus two opt-in flags:
--after selects the second pin; --cpu-prof writes a V8 profile of each
measured API worker and reports PROFILE_ONLY_NOT_A_P95_VERDICT. Plan,
driver, thresholds, admission and the one-shot claim are unchanged.
Each pin runs from a worktree at that commit, because admission rejects
any runtime change relative to the pin. The 613 pins add one scope,
ci-diagnostic (Linux on a GitHub-hosted runner only), used by
.github/workflows/stocks-613-50plus2-diagnostic.yml for interleaved
before/after pairs pinned to 2 vCPUs; summarize-613.cjs aggregates them.
Windows (LOCAL_DIAGNOSTIC) and CI results are diagnostics, never capacity
acceptance; the isolated Linux attestation path is unchanged.