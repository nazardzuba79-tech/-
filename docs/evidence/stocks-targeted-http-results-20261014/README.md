# Targeted HTTP terminal audit — exact 50b16c1d9e5d07503b84e3d9ac810708847d2a8e

Read-only independent analysis of artifact 11853046247, Actions run 38471232697. Original evidence was not changed; no load/test was rerun.

**Collection COMPLETE; 27 PASS / 3 FAIL / 0 INCOMPLETE. Capacity acceptance NOT_EVALUATED.** Independent reconciliation issues: 0. Terminal exit 1 preserves the three identity failures.

ZIP SHA256: 6fd9f0b92e9fe0281043afdce31ce725bf39366d4352eca1bd8b8c854679485e. Results SHA256: 7acbab13297bfcec217ed37bf42f45f1a0827dd2fce3a4b2e2041a585ed56a3d. All 153 original source files match exact Git blobs; ten control/target manifests and image-tree bindings reconcile. 326 top-level evidence files remain byte-identical.

Raw upload: [targeted-http.zip](targeted-http.zip),773852bytes. Full precision metrics and per-run CPU/RAM/SQL/I/O/error/provenance values: [table.json](table.json). [Exact-head Actions run](https://github.com/nazardzuba79-tech/-/actions/runs/38471232697). Readable table values are rounded; JSON and ZIP preserve original numeric precision.

## Scope and resource proof

All30 runs and the five-reader preflight prove service0.05vCPU/256MiB/no swap/core0;1MiB/s read and128KiB/s write bound to mounted259:1 parent device259:0. Authority and client each0.5vCPU/256MiB/no swap/core1. Service network none; fixture authority/client share its isolated namespace. No real external provider or financial requests. Warmup/cold registration is outside the measurement. All final source/queue drains and cleanup passed; noOOM, native/logical failures or SQL writes/transactions in measured windows. Physical fsync latency is UNMEASURED.

## Per run (repeat0/1/2; milliseconds)

CPU is whole-service process CPU; RAM is fresh-container lifetime cgroup peakMiB. SQL column is reads; API is native/logical. Errors include all unsuccessful attempts; history expected aborts are separate.

|Idx|Profile|Arm|r|Status|N|Errors/aborts|p50|p95|p99|CPUms|CPU/N|RAMMiB|SQL|API|
|---:|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|0|projection20|control|0|PASS|100|0/0|320.69|724.11|822.40|173.10|1.73|56.46|100|7/15|
|1|projection20|target|0|PASS|100|0/0|377.08|874.52|876.93|185.77|1.86|56.19|100|7/15|
|2|projection20|target|1|PASS|100|0/0|361.63|757.76|759.16|177.17|1.77|56.48|100|7/15|
|3|projection20|control|1|PASS|100|0/0|360.81|661.40|762.32|181.20|1.81|56.32|100|7/15|
|4|projection20|control|2|PASS|100|0/0|305.43|702.10|799.26|182.28|1.82|56.18|100|7/15|
|5|projection20|target|2|PASS|100|0/0|310.07|709.67|712.63|163.26|1.63|56.46|100|6/12|
|6|projection50|control|0|PASS|250|0/0|995.93|1900.48|2098.15|382.44|1.53|56.86|250|7/15|
|7|projection50|target|0|PASS|250|0/0|1085.70|1581.86|1779.02|387.57|1.55|55.65|250|7/15|
|8|projection50|target|1|PASS|250|0/0|995.37|1948.11|2048.61|353.77|1.42|55.97|250|7/15|
|9|projection50|control|1|PASS|250|0/0|1095.64|1994.38|2192.00|414.28|1.66|56.43|250|7/15|
|10|projection50|control|2|PASS|250|0/0|950.20|1846.83|1945.48|403.90|1.62|55.68|250|7/15|
|11|projection50|target|2|PASS|250|0/0|729.68|1690.78|1790.97|319.30|1.28|56.25|250|7/15|
|12|wallet|control|0|PASS|25|0/0|68.95|170.50|265.24|64.74|2.59|57.34|25|13/30|
|13|wallet|target|0|PASS|25|0/0|17.93|216.59|216.87|65.09|2.60|57.40|25|12/20|
|14|wallet|target|1|PASS|25|0/0|103.06|299.98|300.71|67.47|2.70|56.56|25|12/20|
|15|wallet|control|1|PASS|25|0/0|21.61|216.91|217.08|67.62|2.70|56.69|25|13/30|
|16|wallet|control|2|PASS|25|0/0|83.63|280.64|280.91|74.68|2.99|56.29|25|13/30|
|17|wallet|target|2|PASS|25|0/0|101.87|300.11|300.38|74.05|2.96|57.20|25|12/20|
|18|history|control|0|PASS|25|0/15|106.22|396.01|400.61|232.50|9.30|57.56|0|15/15|
|19|history|target|0|PASS|25|0/15|100.51|301.46|402.55|197.57|7.90|56.63|0|10/10|
|20|history|target|1|PASS|25|0/15|107.62|302.77|499.80|232.78|9.31|56.18|0|10/10|
|21|history|control|1|PASS|25|0/15|99.89|395.56|400.90|224.67|8.99|56.95|0|15/15|
|22|history|control|2|PASS|25|0/15|105.92|302.54|400.02|242.25|9.69|56.68|0|15/15|
|23|history|target|2|PASS|25|0/15|99.99|301.77|497.57|211.11|8.44|56.13|0|10/10|
|24|identity|control|0|PASS|75|0/0|1547.31|1945.63|1946.21|157.31|2.10|56.14|75|0/0|
|25|identity|target|0|FAIL|75|53/0|3001.22|3001.86|3001.88|435.60|5.81|111.23|29|0/0|
|26|identity|target|1|FAIL|75|47/0|3001.01|3001.66|3001.68|416.12|5.55|113.57|33|0/0|
|27|identity|control|1|PASS|75|0/0|545.60|1697.39|1796.62|153.68|2.05|55.80|75|0/0|
|28|identity|control|2|PASS|75|0/0|1147.28|1842.69|1843.13|154.43|2.06|56.19|75|0/0|
|29|identity|target|2|FAIL|75|60/0|3000.24|3001.62|3001.68|457.05|6.09|110.26|19|0/0|

## Pooled arms (all attempts; not averages of repeat quantiles)

|Profile|Arm|N|Errors|p50|p95|p99|CPU/Nms|PeakMiB range|SQLreads|Native/logical|
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
|projection20|control|300|0|320.69|722.19|821.04|1.79|56.18–56.46|300|21/45|
|projection20|target|300|0|362.54|758.79|875.57|1.75|56.19–56.48|300|20/42|
|projection50|control|750|0|998.54|1899.57|2095.73|1.60|55.68–56.86|750|21/45|
|projection50|target|750|0|924.77|1750.25|1950.10|1.41|55.65–56.25|750|21/45|
|wallet|control|75|0|80.13|277.47|280.91|2.76|56.29–57.34|75|39/90|
|wallet|target|75|0|101.42|299.98|300.71|2.75|56.56–57.40|75|36/60|
|history|control|75|0|105.92|396.01|400.90|9.33|56.68–57.56|0|45/45|
|history|target|75|0|100.51|302.77|499.80|8.55|56.13–56.63|0|30/30|
|identity|control|225|0|1144.20|1846.87|1945.80|2.07|55.80–56.19|225|0/0|
|identity|target|225|160|3000.40|3001.66|3001.88|5.82|110.26–113.57|81|0/0|

## Identity: current resolver, small versus near-1MiB authoritative profile

The control/target code is identical. Bodies are236–238bytes versus1048222–1048224bytes, within the1064960byte cap; large fixtures include validPNG plus API-accepted original whitespace. Each arm sends75 real loopback /me reads after50 warmup identities. The authority completed every measured read; all failures are client DEADLINE_3000MS with null HTTP status. There is no observed HTTP422, RATE_LIMIT or ACCOUNT_BUSY to attribute. Bounded body transfer/decode/parse at0.05vCPU is more expensive, but this harness does not separate CPU spent in each of those functions. The source contract fix is valid; the near-maximum body workload fails the unchanged end-to-end deadline.

|Arm|r|Readers|Errors/N|p50|p95|p99|Service CPUms|SQLreads|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|control|0|5|0/5|71.95|168.35|168.35|12.01|5|
|control|0|20|0/20|448.43|547.68|547.71|34.46|20|
|control|0|50|0/50|1744.21|1945.80|1946.21|106.35|50|
|target|0|5|0/5|917.93|918.67|918.67|55.37|5|
|target|0|20|10/20|2648.35|3001.62|3001.64|174.89|15|
|target|0|50|43/50|3001.22|3001.88|3001.88|198.24|9|
|target|1|5|0/5|880.79|881.36|881.36|48.90|5|
|target|1|20|3/20|2344.27|3000.68|3000.69|172.83|18|
|target|1|50|44/50|3001.06|3001.68|3001.68|187.90|10|
|control|1|5|0/5|61.57|157.53|157.53|12.37|5|
|control|1|20|0/20|445.93|545.57|545.60|33.23|20|
|control|1|50|0/50|996.55|1794.41|1796.62|90.44|50|
|control|2|5|0/5|92.52|189.12|189.12|11.83|5|
|control|2|20|0/20|544.77|646.93|646.99|39.09|20|
|control|2|50|0/50|1544.24|1842.90|1843.13|98.89|50|
|target|2|5|0/5|776.60|875.53|875.53|50.33|5|
|target|2|20|11/20|3000.21|3000.57|3000.78|187.63|11|
|target|2|50|49/50|3000.25|3001.63|3001.68|212.40|3|

|Arm|r|Auth completed/calls|Auth bytes|Throttled periods|Throttled wallms|Service cgCPUms|PeakMiB|
|---|---:|---:|---:|---:|---:|---:|---:|
|control|0|75/75|17800|30|2587.24|157.19|56.14|
|target|0|75/75|78616750|85|7848.24|435.24|111.23|
|target|1|75/75|78616750|80|7448.35|416.92|113.57|
|control|1|75/75|17800|28|2547.97|153.73|55.80|
|control|2|75/75|17800|28|2512.24|154.23|56.19|
|target|2|75/75|78616750|89|8294.85|456.69|110.26|

## Interpretation

- Projection50 target reduced CPU/attempt in two repeats and increased it1.34% in one; all its p95 values decreased. Projection20 is noisy; target repeat2 makes fewer provider calls due unchanged cache timing. These narrow empty-viewer reads do not prove50active traders or mixed250instrument capacity.
- Wallet removes one native FX start and ten logical calls per repeat, retains the ledger/used-capacity proof and successful post-measurementUSDC capability. CPU change is small; target p95 worsens in all three pairs. Do not claim an overall latency win.
- History target removes five unnecessary starts per repeat (15→10; bytes369810→246540); shared/live-reader and active-request contracts pass. Fifteen deliberate cancellations per run are not errors. The control intentionally reproduces extra work.
- Large identity:160/225deadlines; all15five-reader requests pass; higher concurrency fails. It is a measured capacity/latency failure under this legal body-size stress, not incomplete harness finalization, body rejection, provider failure or observed account-queue busy refusal.
- No original hard load criteria or +5%crypto coexistence gate is replaced by these diagnostics. Publication/capacity remains blocked pending the original gates and release conditions.

The Actions log retains 308 ECONNREFUSED startup readiness probes on fixture control/authority ports. All setups later succeeded; measured clients contain no ECONNREFUSED. The job deliberately exits1 for the three FAIL rows and uploads evidence.

- Matched local fixture measurements, not real provider availability, rights or production capacity.
- Identity arms use the same current resolver; only authoritative profile body changes small versus legal near-1MiB. This is body-size stress, not old 16KiB code performance.
- No crypto coexistence measurement or original full capacity acceptance was run here.
- Whole-service CPU includes matched fixture diagnostics and drain; physical fsync latency was not instrumented. Measured SQL writes/transactions and disk I/O deltas are zero.
- memory.peak is each fresh container lifetime including setup; process maxRSS differs from cgroup memory accounting.
- Authority CPU cgroup includes short-lived snapshot probes, while authority process CPU is reported separately.
- History control PASS validates the deliberately reintroduced extra-start behavior; it does not mean that behavior is desirable.
- Wallclock provider event IDs differ between paired runs; fixture algorithms, source hashes, prices and contracts match.
- Projection20 repeat2 target has one fewer native start and three fewer logical requests, a cache-timing demand confound.
- Timeouts retain monotonic elapsed time, including values slightly over3000ms due timer delivery. No threshold was relaxed.


## Three paired repeats per profile

Each entry is the target relative to its matched control, not an average or a claim of statistical significance. Order was control→target, target→control, control→target. CPU/N is total service process CPU divided by **all attempted HTTP operations**, including deadline failures and planned cancellations; it is not CPU per unique active reader. PeakRAM cannot be divided by reader count as an incremental capacity estimate.

|Profile|Repeat|CPU/attempt change|All-attempt p95 change|Native starts target−control|Errors target−control|
|---|---:|---:|---:|---:|---:|
|projection20|0|7.3231%|20.7720%|0|0|
|projection20|1|-2.2241%|14.5699%|0|0|
|projection20|2|-10.4359%|1.0781%|-1|0|
|projection50|0|1.3401%|-16.7655%|0|0|
|projection50|1|-14.6055%|-2.3201%|0|0|
|projection50|2|-20.9464%|-8.4495%|0|0|
|wallet|0|0.5468%|27.0315%|-1|0|
|wallet|1|-0.2189%|38.2973%|-1|0|
|wallet|2|-0.8436%|6.9395%|-1|0|
|history|0|-15.0230%|-23.8751%|-5|0|
|history|1|3.6106%|-23.4595%|-5|0|
|history|2|-12.8547%|-0.2526%|-5|0|
|identity|0|176.9013%|54.2876%|0|53|
|identity|1|170.7643%|76.8399%|0|47|
|identity|2|195.9606%|62.8934%|0|60|

## Safety and remaining acceptance gates

All measured financial ledger fingerprints are unchanged. All six Wallet arms also retain identical used-capacity state and pass the separate dual-currency post-measurement check; this check is excluded from timing/provider counters. Fixtures use disposable accounts and isolated network namespaces. This is read-only measurement after explicit fixture setup trades; it is not a production financial operation or a full Buy/Sell regression proof. Active/shared history controls retain exact native OHLCV contracts and the same queue/deadline bounds.

The near-1MiB identity workload requires a contract/resource review. These results do not authorize changing identity freshness, caching authorization, bypassing /me, raising timeouts or weakening the byte cap. The small/large arms use the same current code; they do not compare to the invalid historical16KiB cap.

[Original acceptance evidence](../../qa/stocks/PERFORMANCE-REVIEW-20261013.md) remains unchanged: original50mixed readers29/25/31=85deadlines, and pooled cryptoD50/D100 p95 degradation+13.6486%/+13.8114%, above the+5%gate. This narrow target-only diagnostic does not retest or clear those failures. No new server purchase, production capacity, real provider entitlement or production integration readiness is inferred. MOEX/source-rights and other release gates remain independent blockers.
