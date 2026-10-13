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

After each profile, a 3.4s quiescent window verifies provider/SQL idle deltas.
Three additional adjacent OFF/ON diagnostic pairs (20 shared viewers, alternating
order) measure the cached SQLite diagnostic overhead. Total planned containers:
60 primary + 6 overhead. Do not blindly rerun this full matrix after a docs change.

There are **no invented B acceptance thresholds**. Report functional contract
PASS/FAIL, every HTTP failure and embedded source failure, per-repeat crypto p95
change and the separately labelled original +5% comparison. No result replaces A.
Missing/interrupted scenarios are INCOMPLETE, never zero-error/PASS. HTTP attempts
equal successes plus HTTP failures; embedded source errors in a 200 response are
separate and are not added as a second failed HTTP attempt. Both success-only and
all-attempt p50/p95/p99 are available, and raw NDJSON survives interrupted clients.

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
