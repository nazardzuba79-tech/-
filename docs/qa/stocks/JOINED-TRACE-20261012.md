# Joined Stocks phase diagnosis (review only)

The last complete acceptance run, `38200427725`, tested application head
`010eb8716755c48aeb62baaf8602fb7ff837859f`. Its original bounded 50-mixed
scenario still failed with 82 client deadlines over three repeats. Full results
remain in the PR; this diagnosis neither supersedes nor converts those failures.

## Narrow execution path

The `stocks-phase-trace` label opts **only same-repository PR #497 on
`codex/stocks-integration-20261010`** into one diagnostic job. Other PRs and the
normal unlabeled path keep the existing performance gates. The explicit mode
does not repeat the unchanged broad performance matrix just to collect traces.
Functional, frontend, browser and bounded runtime checks remain enabled.
Remove the label after the investigation; any later acceptance run must use
the normal original gates. A successful diagnostic job is not capacity PASS.

The workflow has `contents: read`, no deployment commands or secrets, and
checkout credentials are not persisted in the diagnostic job. It uses fresh
disposable SQLite files and offline fixture responses. No runtime, database,
provider limits, trade rules, financial data or production settings are changed.

The commit prefix `[CF-Pages-Skip]` prevents the existing Pages integration
from creating another branch preview without changing its configuration.
This is the documented Pages-specific skip marker, not GitHub's generic
`[skip ci]`; review CI still runs.

## Compared application revisions

- Before: `de565eac17a8477e0dd4c50c2dc936b2bea21990`.
- After: `010eb8716755c48aeb62baaf8602fb7ff837859f`.

Both receive the same source-verified instrumentation in disposable copies.
The repository's runtime and original benchmark files stay untouched. The
workload remains 50 mixed users / 20 instruments / 30 seconds / 3-second
deadline, 0.05 vCPU, 256 MiB, 1 MiB/s reads and 128 KiB/s writes. Trace OFF
and ON controls each repeat three times per revision in balanced order.
All outputs are marked `diagnosticOnly: true` and `acceptance: false`.

The trace uses numeric generated correlation IDs and bounded fixed records.
It excludes principals, account IDs, headers, tokens, request/response bodies,
balances, prices and SQL text. It records phase timings and aggregate counts;
there is no per-event disk write. Dropped or missing data must be reported as
incomplete evidence. Instrumentation CPU, memory and latency overhead is
measured separately; instrumented timings are not unqualified acceptance data.

No optimization is inferred merely from average CPU or a queue wait. The
analysis must separate non-overlapping request wall phases from overlapping
SQL, worker CPU, event-loop and cgroup throttle observations, with an explicit
unattributed remainder. Physical batched SQL work is counted once.

## Existing release blockers remain

Original 50-mixed and some strict crypto coexistence gates fail. Backend/Admin
regressions remain reported, not disabled. MOEX/SBER is blocked, commercial
Bybit/Binance redistribution rights are unconfirmed, and current Hetzner peak
headroom has not been established. No merge, deploy or launch approval follows
from this diagnostic.

Sources for execution preflight:

- [GitHub manual workflow dispatch prerequisites](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Cloudflare Pages GitHub skip markers](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)

## Measured capture and analyzer repair

The 12 runs in workflow 38205520141 completed and produced immutable artifact
11726788451 at diagnostic head bdf8155ee437a3a819124d3dc6daea373ba0107f.
The first analysis job failed because its adapter treated zero-based repeat 0
as missing. Two other adapter defects reported deadlines from an absent field
and filtered out status-prefixed safe HTTP error codes.
The repair replays those exact raw records; it does not repeat or replace the
original acceptance tests. The `stocks-phase-replay` label, together with the
existing diagnostic label, selects this pinned read-only artifact replay.
Both labels are temporary and removed after investigation. The original
failed report remains in `analysis`; corrected output is `analysis-current`.

All 278 traced client deadlines are joined without dropped events: 219 are
dominated by the account queue and 59 by delay before HTTP arrival. CPU quota
throttles 296–310 of 300–313 observed periods. SQL wall time includes scheduling
and disk wait; these traces do not separately measure fsync duration. The
existing cancellation correction removes old post-close read dispatches
(1/10/2 across three runs) to 0/0/0, without curing original-budget capacity.

Tracing materially changes the workload: CPU per attempt rises 9.293% before
and 5.831% after. Therefore traced timings cannot certify capacity. OFF
controls still have 87 errors before versus 116 after across three runs
(87 deadlines versus 115 deadlines plus one ACCOUNT_BUSY). This comparison
does not demonstrate a throughput improvement. Across all 12 cases: 480
deadlines and 27 ACCOUNT_BUSY, no HTTP 422, no external calls.

Original acceptance failures and release blockers below remain unchanged.
