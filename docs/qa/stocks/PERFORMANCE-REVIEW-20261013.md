# Stocks performance review — 2026-10-13

## Verdict: BLOCKED for publication

This is owner-authorized work in Draft PR #512 only. Measured baseline main was `c205ca3ce64f087b490bae11b2a285791f11f052`. Fresh fetch before the targeted-v2 push found main advanced externally to `c1a9a8d9b1e13b5b22be04ff75fda370db8e2c15` (PR513, Spot-only CSS and its regression). PR #497 remains `2f6fa3f7ec152a1849fb12c3694854963694af14`; PR512 stays stacked on that branch. The newer Spot change is not overwritten or claimed tested by this branch. No merge, deploy, production access, real funds or infrastructure changes.

The registration scheduling candidate was measured and **rejected**. The retained Stocks runtime, simulator and frontend match measured baseline `06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb`. The candidate and its safety tests remain in Git history at `28aa7bac5c8a8d2cee53fb1a7c53765e6c9b9441`; source-guard regressions reproduce that exact archived candidate. There is no retained performance improvement claim.

## Retained corrections

- Missing entire comparison groups, repeats, raw timing samples, operation cardinalities, stock logs, reader counters or provenance now produce INCOMPLETE. Unknown totals are null rather than zero. All 40 historical groups retain their numeric metrics; 126 original input hashes remain unchanged.
- Bounded exact-source diagnostics distinguish request start time from timeout completion, SQL CPU from queue wall time, and explicit COMMIT from inferred registration transactions. Physical fsync counts/latencies remain unmeasured.
- Model evidence v2 validates pre-hide and post-reopen response identity, timeframe and OHLC separately; dispatch/settlement journals preserve interrupted unknowns and reject mixed/partial evidence. Idle no-new-work remains UNVERIFIED.
- V2 also corrects history dispatch at hidden boundaries. It is a changed lifecycle methodology, not performance-equivalent to v1; the 342 matrix was not retroactively validated.
- PR512-only CI stages prevent documentation/parser changes from repeating unchanged costly workloads. Other PR gates and original thresholds remain intact. Scheduling SKIP is never capacity PASS.

## A — original constrained workload

Unchanged limits: 0.05 vCPU, 256 MiB, 1 MiB/s reads, 128 KiB/s writes, 3-second deadline, original workloads/provider limits/FULL durability.

|Evidence|Result|
|---|---|
|Final06a original 5/20 mixed/shared and 50 shared, three repeats|PASS 3/3 per scenario, historical evidence|
|Final06a original 50 mixed|FAIL 0/3; 29/25/31 = 85 deadlines; prior comparison BEFORE had 726 errors|
|Final06a vs Issue505 baseline: crypto D50 / D100 pooled p95|+13.6486% / +13.8114%, above +5%; D100 has 386 reader timeouts|
|342 phase experiment, pristine / OFF / ON|113 / 119 / 124 failures; nine runs FAIL|
|ed3 pristine timeline, three repeats|31/27/31 = 89 deadlines; all first50 state requests, starts8.2–13.8ms; 3552 subsequent requests have no errors|
|28aa matched registration experiment|Baseline88 vs candidate89 deadlines; both FAIL 0/3|

These are separate experiments on different CI runs; their error totals are not before/after gains. The phase experiment uses 94.2–97.8% of its CPU quota and is throttled24.68–26.95s per ~30s run. SQL thread CPU8.81–11.78ms does not prove fsync is cheap or identify an individual failure's cause. Timing narrowed the hypothesis to initial admission, but registration batching did not reliably help. Shared quote flights, serialized history reuse and account-context coalescing already exist. The evidence does not prove every safe optimization is exhausted or that the budget is physically impossible; no minimum CPU/disk setting can be inferred from this single constrained resource point. Additional batching would need independent deadline, cancellation, FIFO, isolation and queue-byte proofs.

A separate [copy-only null-digest microbenchmark](NULL-DIGEST-EXPERIMENT-20261013.md) measured4999→4266CPUms in its null-heavy case, with identical full outputs and14/14 safety tests. Negative controls were noisy; readonly B viewers perform zero digest calls. It was not promoted or treated as a capacity improvement.

### Matched candidate results

Pooled raw quantiles, not averages of run percentiles. All attempts include failed requests.

|Metric, three matched repeats|Baseline06a|Rejected28aa|
|---|---:|---:|
|HTTP attempts / failures|3747 / 88|3731 / 89|
|CPU total ms / CPU ms per attempt|3674.740 / 0.980715|3701.674 / 0.992140|
|Cgroup memory peak MiB, range|56.59–57.01|56.00–57.93|
|All-attempt p50 / p95 / p99 ms|100.76 / 1699.43 / 3004.61|101.59 / 1549.47 / 3004.37|
|Requests starting6s+: p95 ms / errors|806.54 / 0|1097.59 / 0|
|Write bytes, total|405504|372736|
|Explicit COMMITs / inferred registration transactions|6 / 9|7 / 8|
|SQL calls / reads / writes|4904 / 4742 / 150|4841 / 4677 / 150|
|CPU ms per reader per30s run (descriptive)|24.4983|24.6778|
|Fixture history / quote calls|322 / 398|318 / 395|
|External API calls|0|0|

Steady p95 worsened +10.07%, +70.70%, +36.90% across the three pairs. Inferred transactions were3/3/3 versus2/2/4; one candidate run increased writes. Lower aggregate all-attempt p95 cannot hide unchanged failures and this tradeoff. CPU/attempt increased1.16% pooled. Candidate removed.

[Every pair and interpretation limits](REGISTRATION-PAIR-28AA-20261013.md). Per-reader CPU is a descriptive division within this50-reader workload, not a marginal cost or linear scaling guarantee. Shared RAM must not be divided into independent per-reader allocations.

## B — nominal CX23 model, separate from A

Measured source `342fab901c3ac305338b506aa07151f242190e9f`; one aggregate2-vCPU/4-GiB cgroup contains Stocks, SQLite worker, real crypto service calls through an isolated HTTP adapter, supervisor and disposable PostgreSQL. Shared CI quotas are ceilings, not dedicated CPU guarantees. Storage is the CI bind mount without synthetic I/O throttling, not measured Hetzner storage.

All66 scheduled runs collected:60 primary cases/30 matched pairs and6 instrumentation controls. Each completed80/80 crypto cycles;73,920 crypto HTTP attempts across all66, zero crypto HTTP errors, zero OOM. Primary cases account for67,200 of those attempts. Total Stocks HTTP attempts10,632;336 HTTP failures, all RATE_LIMIT. The337 embedded source-error observations are separate and must not be added to HTTP failures.

|Scenario|Stocks HTTP errors in repeats0/1/2|Crypto p95 diagnostic against the A +5% reference|
|---|---|---|
|Idle, owner Wallet, 5/10 shared/distinct, 20/50 shared|0/0/0 per profile|All pass except5-shared repeat2: +9.72%|
|20 distinct|35/37/33|3/3 pass|
|50 viewers /20 distinct graphs|81/75/75|Repeat0 +8.75% FAIL; other two pass|

Across all66, average aggregate CPU0.3726–0.4506vCPU; lifetime cgroup peak241.93–281.99MiB including schema startup. These are measured fixture costs including crypto, not the incremental cost of one Stocks reader. No original-resource capacity claim follows from them.

Every20/50-distinct repetition reaches91 Bybit and100 Binance starts, then the unchanged per-host100-starts/60s application guard rejects additional requests. More RAM or a separate machine does not remove that guard. Endpoint-level rejected demand was not retained in v1, so a minimum required quota cannot be inferred by adding HTTP failures. Future batching or another licensed adapter is not proven impossible; it remains unimplemented/unverified.

[All profiles, latency, CPU/RAM, SQL, cache, provider and I/O tables](CX23-MODEL-342-20261013.md).

Measured failures classify6 cases FAIL. Remaining60 are UNVERIFIED, not functional PASS: v1 lacks independent post-reopen identity/OHLC proof, complete dispatch accounting for interrupted requests and no-new-work attribution. Zero observed idle counter deltas do not prove no new dispatch. The250 metadata entries are20 native fixture IDs plus230 inert entries; idle tests retain them in memory but do not fetch a250-entry HTTP response. Nonidle loaded profiles do fetch it. This is not250 verified tradable instruments.

The crypto adapter calls real service classes but omits production auth/routes/middleware/collectors. Its manual-close mix does not prove triggered TP/SL behavior. Model B's28/30 passing crypto comparisons are not substitutes for A's historical coexistence gate.

## Resource and release decision

There is no tested configuration satisfying every required launch gate. Actual Hetzner headroom, physical fsync/device latency and production-auth/gateway coverage remain unconfirmed. Existing model data does not justify buying a server; neither does it certify that the current server is sufficient. Current adapter request-budget failures require a data-access solution and cannot be fixed by RAM alone.

MOEX/SBER remain blocked; commercial redistribution rights for Bybit/Binance remain NOT CLEARED. Fixture quotes stay confined to isolated tests. Original capacity and crypto coexistence criteria remain FAIL. Mathematical impossibility at0.05vCPU is not claimed: unprofiled HTTP/IPC costs and alternative architectures remain open.

## Validation and provenance

Pre-follow-up retained-runtime local regression: **244/244 PASS** (165 simulator/safety,24 diagnostic/source/selector,43 summary/evidence,12 model). Candidate-only6 safety regressions were tested before rejection and preserved in28aa history; they are not active-runtime tests after its removal. Frontend/financial runtime diff against06a is empty. Exact final CI and SHA are recorded in PR512 after this report commit; earlier successful evidence jobs do not mean workload acceptance.

|Experiment|GitHub run / artifact|ZIP SHA256|
|---|---|---|
|Phase342|[38413849587](https://github.com/nazardzuba79-tech/-/actions/runs/38413849587) /11823626343|f8a60bce56a6189b9f401a52356719947fcf322c04484498ddcdcef7bd291e4b|
|Timeline ed3|[38417574827](https://github.com/nazardzuba79-tech/-/actions/runs/38417574827) /11825475465|4af17c3704d71231712547ab7a4520238dc7cbd394dce9d41a681910e76a1335|
|Matched28aa|[38420023113](https://github.com/nazardzuba79-tech/-/actions/runs/38420023113) /11825992910|872f66580caea56fde9432e3268dba7684c798db00311a17573773c948a0d57e|
|Model342|[38413849587](https://github.com/nazardzuba79-tech/-/actions/runs/38413849587) /11826077826|8d4106ddc9fed26bbf6e63a0c4cdabeb2d89a3ff9d2814340ac1f53fcc1da336|

Raw artifacts, failed attempts, source manifests, all repeats and legacy reports remain intact. No threshold, provider allowance, quote TTL, financial math, FULL durability or original strict workload was relaxed.

## Targeted v2 evidence follow-up

The next explicitly scheduled model stage repeats only the ten original loaded profiles three times after the lifecycle/journal corrections. It does not repeat the thirty crypto-only controls or six instrumentation controls, and cannot certify a fresh matched crypto +5% comparison. Existing342 raw artifacts and all400 hashes remain immutable; no legacy row is retroactively promoted. New evidence and exact-head tests remain pending until the identified run completes. The original A criteria remain FAIL and the registration candidate stays rejected.

Targeted-v2 pre-push local regression: **249/249 PASS**,0fail/skipped/cancelled (165 simulator/safety,25 diagnostic/source/selector,43 summary/evidence,16 model). This includes a real killed-client journal and owner/viewer finite-idle proof. It is not a substitute for the scheduled Linux model.
