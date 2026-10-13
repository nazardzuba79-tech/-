# Targeted HTTP attribution — PR512

This is an explicitly selected, offline diagnostic. It does **not** replace Issue505, certify 20/50-user capacity, measure crypto coexistence, or prove production integration. No load runs execute merely by importing modules or running the focused tests.

The retained earlier A and ModelB fixtures do not exercise all of owner-only 40-item projection, the real HTTP identity adapter, and repeated Wallet-native quotes. A new `targeted-http` plan ID on PR512 enables only this job. An unchanged ID, report-only change, or another PR cannot repeat it; other PRs keep their original gates. The committed review plan remains unchanged until review/freeze authorization.

## Exactly 30 runs

Each profile has three matched pairs in `control,target / target,control / control,target` order. All images derive from one exact candidate Git SHA; only the single reviewed helper/callsite changes in disposable control copies. Every reviewed hash is checked before any pair, including target-first pairs. All three source-root file hashes and measured image IDs are retained.

| Profile | Measured requests per run | Narrow comparison |
|---|---:|---|
| Projection20 | 20 nonowners × 5 waves, 2s cadence | Existing empty-view projection vs original full-snapshot helper; 40-item catalogue |
| Projection50 | 50 nonowners × 5 waves, 2s cadence | Same; no financial mutation |
| Wallet | 5 duplicate readers × 5 waves, 2.1s cadence | Wallet native quote vs only its `includeUsdc:true` callsite; Bybit AAPLX and Binance AAPLB holdings |
| History | Five repetitions of three cases; 25 attempts, 15 deliberate aborts | Only HTTP signal argument removed in control; cancellation before native start, live duplicate, already-started native request |
| Identity | 5,20,50 concurrent `/state` cohorts, 75 attempts | Current resolver with small vs near1MiB `/me`; a body-size cost comparison, not an optimization control |

Setup is separate: durable account creation and two fixture Wallet buys occur before timing; Wallet releases its chart lease and waits **15.1s** for the unchanged FX/source TTLs to expire naturally. Measurement hashes the entire durable ledger, including used capacity, before/after. Wallet response positions/USDT financial projections must match across variants. USDC enrichment is an expected response-only difference. A separate post-measurement normal viewer read checks dual-currency capability and an owner no-id read proves no chart lease; neither enters the measurement or ledger window. Existing `wallet-fx-scope.test.mjs` remains mandatory financial-regression evidence.

History has unique nonoverlapping historical keys, no cache reset. Fixture-only barriers hold two slots or native response delivery. A client abort must be acknowledged by server response close. The pre-release barrier is bounded to 1700ms, below the unchanged 2s queue deadline; an incomplete barrier is INCOMPLETE, never retried with a longer deadline. A started native request finishes and a live duplicate receives the exact native OHLC page. The known negative control's extra provider start is retained explicitly; its expected count is a diagnostic control contract, not a claim that obsolete behavior meets a release gate.

## Resources and isolation

Service: 0.05vCPU, 256MiB, no swap; 1MiB/s reads and 128KiB/s writes on the verified backing device of its disposable SQLite directory. Cgroup limits, CPU placement, I/O counters and memory/OOM events are required, not inferred from Docker flags. Missing evidence is INCOMPLETE. The service uses `network=none`; authority and client join only that namespace. Every listener is loopback. No production path, credential, database, migration or broker is used.

Authority and client each use 0.5vCPU/256MiB/no swap on a separate load core. This is load-generation capacity, not an asserted production requirement. Their process/cgroup CPU and memory evidence are separate. Host snapshot probes execute inside the authority cgroup; service snapshots do not spawn service child processes. Docker context is denied by default and includes only three service roots. Synthetic subjects and native-protocol fixtures are explicitly labeled; they are never displayed on a public site or claimed as market-data evidence.

The native numeric fixture rule is identical for both variants. Actual wall-clock event IDs/timestamps differ across runs and are retained; only monotonic durations and numerical contract equivalence are compared. Per-request quote event IDs/times reconcile with native-start events. Provider trace retains logical request, observed admission at injected fetch entry, native start/completion/error/cancellation, safe endpoint/symbol, timestamps, HTTP tag and URL hash. Admission is observed after the unchanged adapter budget check, not independently timed inside it. The fixture seeds discovery metadata: this excludes production discovery network work equally in both variants, and is explicitly not a live-provider benchmark. Native-start budgets remain 100/host/minute; these selected profiles stay far below that limit by construction. Unknown endpoints and non-GET native calls fail closed.

## Evidence and execution

HTTP deadline remains 3s. Final elapsed-time checks catch delayed timer callbacks. Every planned attempt and deliberate abort is journaled; ordinary timeout/error and source error counts remain separate. Failed client stdout/stderr survive JSON parse failure. Fixed waves never overlap/catch up; lateness from the original cadence is retained. Service CPU includes fixture tracing and a bounded post-request queue drain; same instrumentation in both variants means this measures matched whole-process cost, not zero-instrumentation CPU. Cached worker SQL counters include observed timestamp/age and worker liveness; they are not refreshed by an extra SQL query. SQL physical fsync latency is not measured. Cgroup peak RAM covers the fresh container's lifetime including setup, while sampled RSS and CPU windows are separately labeled.

A five-user real-HTTP/resource configuration preflight precedes all 30 runs; any setup or cleanup failure stops before measurement. Row PASS means only complete diagnostic contracts. FAIL and INCOMPLETE are retained and make the runner nonzero; no result can grant capacity acceptance. No automatic host or production action exists.

Focused tests (no Docker/load run):

```sh
node --test services/stocks/targeted-http-512/targeted.test.mjs services/stocks/review-plan.test.mjs
```

The reviewed GitHub job supplies the exact SHA, verified disk/device and CPU IDs. The gated command is:

```sh
TARGETED_HTTP_512_APPROVED=true TARGETED_SOURCE_SHA=<exact-head> \
STOCK_REALISTIC_DISK=<disposable-directory> STOCK_BENCH_DEVICE=<verified-backing-device> \
BENCH_CPU=<service-core> LOAD_CPU=<different-load-core> \
node services/stocks/targeted-http-512/run.mjs
```

Do not run this on a production host. It requires a reviewed/frozen source and an explicitly changed PR512 plan. Reports retain per-run attempts, CPU/attempt, p50/p95/p99, errors, source counts, SQL/queue deltas, I/O bytes/operations, memory, image/source provenance, control manifests and cleanup results. Comparison percentages are descriptive; they do not replace strict original thresholds or justify guarantees about existing Hetzner capacity.
