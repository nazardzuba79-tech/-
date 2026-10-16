# Serializer candidate diagnostic review

Verdict: REJECT broad runtime wiring. Exact-byte correctness passed for tested fixtures, but nonempty account shapes regress materially.

This is a local Windows serialization microbenchmark, not original Stocks load/capacity acceptance. Root reported frontend Jest/build ran concurrently during both benchmark attempts. Absolute latency, short-round CPU and process RSS therefore do not establish clean-host capacity or per-user cost. V1 is an AB/BA/AB diagnostic; V2 corrects order to six AB/BA paired rounds. Both originals remain unchanged.

| Catalogue | Shape | Baseline mean µs | Candidate mean µs | Change | Baseline process CPU µs/call | Candidate process CPU µs/call |
|---:|---|---:|---:|---:|---:|---:|
| 20 | empty | 14.83 | 10.95 | -26.1% | 14.33 | 20.92 |
| 20 | small-nonempty | 18.94 | 36.89 | 94.7% | 19.50 | 39.08 |
| 20 | cutoff-below | 48.32 | 121.94 | 152.4% | 46.92 | 122.33 |
| 20 | cutoff-above | 110.44 | 289.87 | 162.5% | 110.75 | 299.50 |
| 20 | large-ledger | 162677.34 | 160238.86 | -1.5% | 164750.00 | 162041.67 |
| 40 | empty | 88.36 | 32.24 | -63.5% | 97.75 | 45.67 |
| 40 | small-nonempty | 90.74 | 99.52 | 9.7% | 96.42 | 117.17 |
| 40 | cutoff-below | 168.08 | 295.54 | 75.8% | 174.33 | 302.08 |
| 40 | cutoff-above | 146.75 | 341.76 | 132.9% | 155.00 | 341.08 |
| 40 | large-ledger | 219488.52 | 210287.08 | -4.2% | 229875.00 | 214875.00 |

V2: 195468 exact byte comparisons, process exit 0, 51.72 seconds. All imported source hashes unchanged throughout execution. Per-repeat p50/p95/p99, process CPU, heap/RSS, publication cost, input hashes and environment are retained in the raw JSON. CPU includes equality-check/harness overhead; timed stringify wall excludes equality comparison. RSS is process-wide and includes large fixture materialization.

Publication is measured separately: 20 instruments mean 0.198 ms; 40 instruments mean 0.857 ms.

Fixtures use actual CATALOG (20 US / 40 total), engine createState/snapshot and a validated engine buy/partial-sell/limit sequence for nonempty schema. Expanded ledger rows are explicitly synthetic performance shapes, not validated trading histories. Quotes and data never leave this local benchmark. Each catalogue has eight changing Alice/Bob fixtures (two for large-ledger) with distinct tokens/revisions/wallets/quote status/PnL/metrics.

An empty-ledger early guard is feasible but was NOT implemented or tested. Measured empty state also has no quotes. Normal owner-only read-only state?id responses project a quote, so an empty-quotes guard misses that actual hot path; allowing quotes is unmeasured. No recommendation to ship a fragile empty-only optimization based on this diagnostic.

No repo edits, HTTP listeners, database access, external requests, CI, production operations, or background helpers were performed by this benchmark subtask. No further reruns were made after contention was reported. Original 50-mixed and crypto coexistence acceptance remain FAIL.
