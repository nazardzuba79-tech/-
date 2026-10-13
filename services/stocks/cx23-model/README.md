# Disposable nominal CX23 model (B only)

This harness is independent of Issue #505's original acceptance workloads (A).
It does not increase an A budget, change any application timeout/queue/financial
rule, prove real Hetzner capacity, or authorize publication. Market data licensing
and MOEX remain NOT CLEARED. Every quote, identity and balance here is an explicit
local test fixture. No real provider, authentication or financial endpoint is used.

## What is actually exercised

- The existing `stocks-global/createServer`, account worker, SQLite FULL transactions,
  owner-only admission, real `MarketHub` quote/history parsers, caches, coalescing,
  original 100 starts/minute/provider and unchanged provider/HTTP budgets.
- One owner can submit USDT paper orders. Other principals issue only state/history
  reads and lease releases. Owner buy, duplicate idempotency replay, Wallet read,
  chart release/resume, partial/full sell, Limit reservation/cancel, unchanged USDC.
- Quote/FX transport is injected native provider protocol data, including an explicit
  fixture `USDCUSDT=0.999`; this is not a claimed market price. Quotes and histories
  use original adapters. Synthetic discovery pre-verifies only the 20 existing US
  fixture instrument identities. MOEX is never enabled.
- A separate **actual HTTP** process wraps unchanged `OrderService`,
  `FuturesPositionService`, `FuturesProtectionService`, and `MatchingEngine`. Every
  measured request invokes one named operation from the existing service-call
  comparator. Its PostgreSQL is initialized from the local Prisma schema in a new
  disposable container directory. It cannot connect outside loopback port 15432.
  This proves HTTP operation-adapter contention, **not** production Express routes,
  auth/middleware, collectors or actual production data/query sizes. It must not be
  described as complete production API capacity evidence.
- A 250-row **metadata-only** fixture is served by harness control `/metadata`.
  Its 230 inert IDs never enter Stocks' runtime instrument registry or catalogue.
  The 250 fixture components reside in the harness process even in idle/control
  cases. Those cases make **zero metadata HTTP reads**; active loaded cases make
  one control HTTP read. Resident metadata and exercised metadata reads are
  different measurements, recorded separately in `metadataCoverage`.
  This measures JSON metadata response handling, not browser rendering of 250
  cards or 250 simultaneously traded instruments. The 50-distinct-viewer case
  rotates over **20 unique existing US IDs**; actual cardinality is in each result.

## Reproducible execution

The environment must already have Docker/Linux. Do not install Docker/WSL, change
host security, or use a production host to run this harness. Use the existing CI
Node 24.21 toolchain to `npm ci`, generate Prisma and compile backend `dist` first.

```sh
docker build --build-arg SOURCE_SHA="$(git rev-parse HEAD)" \
  -f services/stocks/cx23-model/Dockerfile -t voltex-cx23-model .
CX23_IMAGE=voltex-cx23-model \
CX23_SOURCE_SHA="$(git rev-parse HEAD)" \
CX23_DISK="$RUNNER_TEMP/cx23-disk" \
CX23_OUTPUT="$PWD/.ci-output/stocks-cx23" \
node services/stocks/cx23-model/run.mjs
```

The image requires `SOURCE_SHA` and stores it in `org.opencontainers.image.revision`;
the runner rejects a missing/mismatched revision. CI must checkout the exact source
and retain its Git/tree proof alongside the image ID, not infer source from a tag.
Only new empty directories under the explicit disposable disk path are initialized;
startup rejects an existing PG_VERSION. The image uses its own entrypoint, never
the production Dockerfile or migrate-deploy/seed/collector commands. It executes
`prisma db push` solely against the hard-coded loopback disposable PostgreSQL.
Logs and results are preserved; upload the output directory even on failure.

One container cgroup caps **all** Stocks/SQLite-worker, crypto Node, PostgreSQL and
supervisor processes together at **2 vCPU and 4 GiB**, swap also capped at 4 GiB.
The harness verifies `cpu.max`, `memory.max`, `memory.peak`, and memory events,
failing closed if aggregate cgroup-v2 evidence is unavailable. PostgreSQL is not
outside the budget. CPU quota is a ceiling on a shared CI host, not a dedicated
physical-core guarantee. Host load generation is outside this cgroup but can
contend on the same runner CPUs; its CPU and peak RSS are reported separately.

This B model uses the runner's unthrottled disposable bind-mounted disk. That is
neither A's 128 KiB/s disk budget nor measured Hetzner storage. A remains unchanged.

## Workload and interpretation

`CX23_MODE=evidence-v2` selects a targeted follow-up: the ten original loaded
profiles, three repetitions each (**30 cases**). It schedules no crypto-only
controls and no instrumentation OFF/ON pairs. Crypto runs concurrently, but its
+5% coexistence comparison is **NOT RUN**. Never pair these rows with v1 controls.
The default `paired` mode retains the original 66-case plan and limits.

The targeted mode preserves a killed-child HTTP proof under `forced-interruption/`:
the local fixture sees the dispatched request, the child is terminated, and raw
journal reconciliation must show one `INTERRUPTED_UNKNOWN` with no settlement.
That expected failure is a journal regression, not a benchmark success or latency.

For each targeted case, explicit lifecycle releases happen first. Read-only state
requests without an instrument then verify actual `metrics.polling=false` for the
exact expected fixture roles from the plan (owner and every viewer; none for idle).
These reads do **not** release leases themselves. They cause SQL reads, all of
which finish before the drain barrier. Their HTTP metrics are separate in
`postReleaseProofHttp`; `timedStocks` excludes them. Aggregate CPU from initial to
activeEnd includes these proof reads and is labelled accordingly.

The barrier waits at most 5s for the live account queue, provider transport body,
MarketHub inflight maps and history queue to drain. A 3.4s window then samples fresh
metrics every 200ms, requiring zero active/pending work, unchanged cumulative queue
dispatch/provider-start counts, strictly advancing timestamps, and at least 3.4s
of source-clock coverage. Raw baseline/samples/final and expected-role proof are
retained in `finiteIdle`. This proves only that finite observed window. Cached SQL
snapshots remain diagnostic. Idle collector overhead is outside the active CPU
window and included in the separate idle delta. Missing metrics fail closed.

Execution completeness and functional outcome remain separate: any HTTP/source
error, missed crypto cycle, invalid journal or failed finite idle proof causes a
failed targeted outcome even if other contracts pass. Every scheduled row is
still retained; no criteria or runtime trading rules are relaxed.

Estimated targeted cost is 25–30 minutes on the same CI runner, based on the
startup-dominated 66-case run. This is a planning estimate, not a runtime guarantee.

Default duration is 20 seconds (same nominal 80 × 250ms crypto cycle schedule as
the historical comparator; each cycle has 14 HTTP operations). `CX23_SECONDS`
may explicitly select 20–60; the duration must be reported. Requests have the
unchanged 3,000ms client deadline. Slow work can reduce completed cycles; raw
scheduling and attempted requests, throughput and incomplete sequences are visible.
Unlike the historical comparator's alternating manual-close/TP-SL-trigger cycles,
this B model always executes manual close and retains TP/SL set/read/sweep calls.
It does not measure the stop-loss/take-profit trigger branch. Its HTTP latencies
must not be compared as identical operations to historical A service-call timings.

Each of these 10 profiles has **three repetitions** and its own adjacent matched
crypto-only control in a fresh container/DB: no active chart; owner/Wallet; and
5, 10, 20, 50 viewers × shared/distinct charts. Control still runs the same resident
Stocks service with no requests. Order is alternated by repeat. Viewers read every
3 seconds while active, switch among three timeframes, page history, release charts
for the middle sixth of the run, then reopen. They never send financial POSTs.
Owner's initial buy precedes viewers to avoid fabricating pre-visit cached quote
admission; a later resume explicitly waits for a post-resume quote before trading.
No mutation retries occur except the deliberate identical-idempotency replay.

After each profile, a 3.4s quiescent window records provider/SQL idle deltas.
The no-new-work gate is **UNVERIFIED**: these cached counter snapshots cannot
distinguish newly dispatched work from already-dispatched operations draining
after chart release. Even zero deltas are observations, not proof of that gate.
Three additional adjacent OFF/ON diagnostic pairs (20 shared viewers, alternating
order) measure the cached SQLite diagnostic overhead. Total planned containers:
60 primary + 6 overhead. Do not blindly rerun this full matrix after a docs change.

There are **no invented B acceptance thresholds**. Report functional contract
PASS/FAIL, every HTTP failure and embedded source failure, per-repeat crypto p95
change and the separately labelled original +5% comparison. No result replaces A.
Missing/interrupted scenarios are INCOMPLETE, never zero-error/PASS. HTTP attempts
equal successes plus HTTP failures; embedded source errors in a 200 response are
separate and are not added as a second failed HTTP attempt. Both success-only and
all-settled-attempt p50/p95/p99 are available. Unsettled requests have unknown
latency and are counted separately, never assigned zero or a fabricated timeout.

### Evidence methodology v2

Viewer success requires independently validated state **and** history before
hide and after reopen for every scheduled viewer. Validation checks the exact
instrument, source, currency, requested timeframe and valid chronological OHLC
rows. A response crossing the hide/reopen boundary cannot satisfy the other
phase. Linked validation records retain safe identity summaries, not auth or
private account payloads. Missing post-reopen success is a failed contract.
V2 also corrects lifecycle dispatch: if a state request crosses into hidden time,
the viewer issues no new history request, and waiting cannot skip the hide window.
This changes workload scheduling as well as evidence logging. Do not compare v2
performance directly with the 342 v1 run as if their workloads were identical.

Every request is journalled on dispatch and settlement with a unique ID and a
bounded allowlist of fixture context. The controller reconciles only after the
child exits. Unmatched dispatches are `INTERRUPTED_UNKNOWN`; malformed, duplicate
or missing evidence makes the case incomplete. Mixed legacy settlement rows and
unexpected row types fail closed; explicit versioned source-observation and graph
validation rows remain separate auxiliary evidence. Request deadlines stay unchanged.

The 342fab901c3ac305338b506aa07151f242190e9f run used methodology v1. Preserve
its original files: its settled latency/error records remain measurements, but
total viewer success cannot prove post-reopen correctness, response identities
and OHLC were not retained, and interrupted in-flight counts are unknown. V2 unit
tests do **not** retroactively validate those missing contracts. Mark them
UNVERIFIED instead of rerunning or silently reclassifying that matrix as PASS.

## Measurement limits

- `cpu.stat` is authoritative aggregate usage. Per-process `/proc` CPU deltas and
  Node CPU include worker threads already; **do not add SQL thread CPU again**.
  Short-lived PostgreSQL processes can disappear between samples; mark their
  per-process deltas unavailable, not zero. Aggregate remains accounted.
- `memory.peak`/OOM are actual cgroup counters and include startup/schema creation.
  The separate 250ms simultaneous sum of process RSS is a **sampled** diagnostic;
  shared memory may be counted in several processes. It is not physical peak or a
  sum of independently observed process peaks.
- Raw `io.stat` gives cgroup-attributed bytes/operations, not physical disk latency.
  Empty/unsupported I/O counters mean N/A. COMMIT wall time includes lock/I/O waits
  and is **not** direct fsync syscall duration. Physical fsync/latency is N/A because
  this harness does not install a privileged tracer.
- Native fixture starts/host counters and actual MarketHub cache metrics are
  reported. External calls are zero by injected transport, not inferred from low
  credits. Fixture starts do not establish commercial provider credits or rights.
- Browser rendering, real identity gateway, production route/middleware behaviour,
  live data rights and existing Hetzner headroom are not established by this model.

Local tests: `node --test services/stocks/cx23-model/model.test.mjs`. The local owner
unit has a tiny crypto stub because it tests harness/Stocks semantics on Windows;
it is explicitly not a Linux quota or real crypto-service acceptance run.
