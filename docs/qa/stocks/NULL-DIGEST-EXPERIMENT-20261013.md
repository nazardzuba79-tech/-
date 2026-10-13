# Disposable null-digest cache experiment

Recommendation: **do not promote the runtime candidate now**. Preserve the measured hypothesis, but its likely whole-service impact is too small and uncertain to justify another expensive acceptance run. It does not address B readonly viewers or establish a fix for the original deadlines.

Source archive: `342fab901c3ac305338b506aa07151f242190e9f`. The account source has the same Git blob as06a, `24c5992502c972a42e18814ac43c2bcf2107de79`. Extracted CRLF7207 bytes and Git LF7092 bytes have different byte hashes; normalized contents match. All exact hashes are retained.

Node24.21.0 on Windows, local processes without CPU/RAM/I/O quotas. No HTTP, SQL, external providers or production access. No repository edits.

## Candidate

Compute SHA256 of immutable JSON `null` once, returning it only for `q===null || q===undefined`. Non-null quotes/events still serialize and hash on every call. There is no mutable quote cache, digest weakening or financial rule change.

## All paired measurements

Each run:50owners,3000warmup views,30000measured views and7500observations for five-slot cases. Baseline/candidate order alternates across three repeats. Real state cloning and snapshot arithmetic stay measured; full-output checksum collection is separate.

| Scenario | Repeat | Baseline CPU ms | Candidate CPU ms | CPU change | Baseline wall ms | Candidate wall ms |
|---|---:|---:|---:|---:|---:|---:|
| volatile-five | 0 | 1140 | 1031 | -9.561% | 1131.983 | 1102.580 |
| volatile-five | 1 | 1953 | 1704 | -12.750% | 2096.067 | 1815.044 |
| volatile-five | 2 | 1906 | 1531 | -19.675% | 1946.251 | 1607.826 |
| durable-five | 0 | 2875 | 2437 | -15.235% | 3095.712 | 2522.473 |
| durable-five | 1 | 1891 | 1844 | -2.485% | 1968.001 | 1913.586 |
| durable-five | 2 | 2407 | 2781 | +15.538% | 2433.406 | 2884.023 |
| readonly-empty | 0 | 266 | 250 | -6.015% | 244.770 | 243.776 |
| readonly-empty | 1 | 265 | 234 | -11.698% | 253.403 | 243.706 |
| readonly-empty | 2 | 266 | 250 | -6.015% | 243.170 | 233.393 |

Volatile-five aggregate CPU4999→4266ms (-14.663%) is an observed microbench result, **not a reliable universal effect size**. Negative controls are noisy: durable non-null moves from -15.235% to+15.538%, while readonly-empty has no digest calls yet also changes. Shared Windows scheduling/JIT/GC/CPU-accounting noise is material. Peak RSS and every raw result remain in `results.json`.

## Full-output equivalence and safety

All30000 full view outputs per scenario,7500 observation returns where applicable, final ledgers and metrics produce identical SHA256 in baseline/candidate/counting copies:

- Volatile-five: `42e8a50a65fdbd1926acd7dc215af5770dec1497bc6a65adffe171cc1ffc171c`.
- Durable-five: `988e1add58d72ee611bf9eee5d6da3a792282386a7c65b1101ed574bad506d1a`.
- Readonly-empty: `d519a8004296d9fe11281a94568465cf8974c841c5e79af22622aaa32542ec2b`.

Unchanged observation regression against the candidate copy: **14/14PASS**, including active limits, idempotency/restart, failed commits, recovery, cross-repository authority and512-owner eviction.

## Applicability

Final06a bounded50mixed repeats contain233/260/256 slots across50accounts;257/285/281 volatile observations;0durable observations;50registration INSERTs each and no quote commits. The fixture starts with empty durable quotes and sends no orders. Durable quote values compared by view/observe therefore stay undefined.

The representative volatile-five microbench has158250nullish/173750total digest calls (91.08%). This ratio is **not a traced count of every CI invocation**. Structural nullness in A follows unchanged fixture/worker code and the raw counters. Durable-five has0nullish calls; readonly-empty has0digest calls.

Owner-only B viewers do not create observation slots. The server injects shared market quotes into response-only snapshots after account readView. Their empty-ledger view has no digest work. Owner Buy creates durable quotes, further limiting null-cache applicability.

Parent phase evidence identifies readView CPU as a small part of total work, with dominant queue/transport waiting. This microbench cannot show that saving null hashes resolves85deadlines. Do not promote the runtime candidate or claim original0.05vCPU acceptance, general50viewer benefit, or production capacity.

## Reproduction and artifacts

```text
node bench.mjs <baseline-or-candidate-directory> <volatile-five|durable-five|readonly-empty> measure 30000
node bench.mjs <baseline-or-candidate-directory> <volatile-five|durable-five|readonly-empty> equivalence 30000
```

The counting-only copy is never used for performance measurements. `provenance.json`, `results.json`, `results.json.sha256`, `bench.mjs`, `source.tar` and every per-run log preserve exact source/workload/output. Candidate safety command, with cwd=candidate:

```text
node --test services/stocks-global/account-observations.test.mjs
```

No source edits, commit, push, external financial requests or production access were performed.
