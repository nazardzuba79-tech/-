# Matched registration candidate analysis

Baseline 06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb; candidate 28aa7bac5c8a8d2cee53fb1a7c53765e6c9b9441. Integrity: PASS.

|Pair|Mode|Attempts|Errors|Initial50/later errors|CPU ms|Peak MiB|All p95/p99 ms|6s+ p95/p99 ms|Write bytes/IO|Explicit/inferred tx|
|---|---|---:|---:|---|---:|---:|---|---|---|---|
|0|baseline|1256|31|31/0|1221.93|56.71|1499.38/3005.28|998.29/1102.54|135168/12|2/3|
|0|candidate|1242|31|31/0|1223.10|57.16|1535.82/3004.53|1098.84/1402.13|102400/9|2/2|
|1|candidate|1249|26|26/0|1211.23|57.93|1547.63/3003.59|1196.72/1899.14|102400/9|2/2|
|1|baseline|1244|29|29/0|1217.90|57.01|1748.78/3003.74|701.05/1900.10|135168/12|2/3|
|2|baseline|1247|28|28/0|1234.91|56.59|1742.96/3004.96|798.52/1702.53|135168/12|2/3|
|2|candidate|1240|32|32/0|1267.35|56.00|1603.54/3005.18|1093.21/1201.44|167936/16|3/4|

|Pair|Errors delta|CPU/attempt %|RAM %|All p95 %|6s+ p95 %|6s+ p99 %|Write bytes delta|Inferred tx delta|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|0|0|1.22|0.79|2.43|10.07|27.17|-32768|-1|
|1|-3|-0.95|1.62|-11.50|70.70|-0.05|-32768|-1|
|2|4|3.21|-1.05|-8.00|36.90|-29.43|32768|1|

Retention decision: **REJECT_RUNTIME_CANDIDATE**. No reliable error/CPU improvement; steady p95 worsened in every pair.
- Only three matched pairs; do not claim statistical significance or capacity guarantee.
- Pooled quantiles are calculated from all raw attempts, never averaged from per-run p95.
- Per-reader CPU is a descriptive50-reader allocation, not marginal cost or linear capacity prediction. Shared peak RAM is not per-reader memory.
- Both variants have the same bounded client capture outside service cgroup. Observer effect is not proven zero, and this is not an OFF/ON overhead experiment.
- Compare within these pairs; prior85/113/89 baseline failures ran on different hosts/times and are not before/after improvements.
- Internal queue rejection/expiry/abandonment counters and HTTP failures overlap; never sum them into a failure total.
- SQL wall and explicitCOMMIT wall are not fsync syscall measurements. Inferred registration transactions remain separate from fsync countN/A.
- A candidate can have fewer initial failures while still failing strict capacity or worsening steady latency. Retention must consider all metrics and existing safety tests; production readiness still requires original capacity/coexistence gates.

Artifact SHA256 872f66580caea56fde9432e3268dba7684c798db00311a17573773c948a0d57e; exact metrics, bins, quantiles and receipts are retained in the JSON report.

Decision reasons:

- All three candidate runs remainFAIL:88 baseline failures versus89 candidate; no consistent initial-failure reduction.
- Steady6s+ p95 worsened in all3matchedpairs (+10.07%,+70.70%,+36.90%). Pooled806.54→1097.59ms. Threepairs are descriptive, not statistical significance.
- Candidate CPU perattempt changed+1.22%,-0.95%,+3.21%; no reliableCPUbenefit. RAM changes are small andmixed.
- Candidate reducedinferredregistrationtransactions3→2 in2pairs but increased3→4 inthird. Diskwritebytes show same mixeddirection; savedI/Odidnot reliablyreduceerrors.
- Retain precise diagnostic evidence and safety tests via archived28aa; restore proven06a runtime until a different measured hypothesis is justified.
