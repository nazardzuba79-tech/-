# Stocks viewer projection and history admission evidence — 2026-10-13

Base HEAD: 26e929f03793b8e5a96a5526ecabd31515946234. Runtime source hashes bind the uncommitted candidate; the final integration commit is recorded by the parent review. Node 24.21.0, Windows, offline synthetic fixtures only. No provider, production, host, financial or database calls occur in the microprofile.

## Scope and decision

The owner-gated read-only state route obtains the worker account snapshot, adds response metadata, then projects the selected quote using engine.snapshot. The second structuredClone also copied the catalogue, account descriptor and metrics. The new helper uses the identical engine function, preserves the requested instrument key and exact JSON field order, and omits only these metadata subtrees from the clone for **empty** accounts. Errors and financial state remain cloned. Any orders, fills, positions or balance-adjustment history selects the original full snapshot path.

A broad metadata-exclusion candidate was narrowed after measurement. The first exact-helper timing pass overlapped an independent regression run and is excluded; its raw digest/location are retained in manifest.json. The subsequent clean unguarded pass remains in unguarded-clean.json: the 20-entry/240-order case regressed from 828 to 921 us thread CPU (+11.23%); 250-entry/240-order regressed 875 to 969 us (+10.74%). These rows were not discarded or relabelled PASS.

## Retained guarded measurement

Coordinated idle window: 2026-10-13T20:28:02.681Z–20:28:43.974Z. Three alternating-order pairs per case; 36 timed batches; 240 semantic assertions. Each batch uses process.cpuUsage, process.threadCpuUsage and monotonic wall time. Medians below are per projection. Inputs are frozen. Fixtures contain 20 actual catalogue token identities, explicitly artificial offline prices, both USDT/USDC holdings, completed orders, open positions and pending limits, with 0 or 240 orders. Catalogue sizes are 20, the current 40, and a labelled 250-row synthetic scaling case.

| Catalogue | Orders | Iterations per variant/repeat | Process CPU us before → after | Thread CPU us before → after | Wall us before → after | Clone input JSON-byte proxy before → after |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 0 | 20000 | 30.45 → 8.60 | 30.45 → 8.60 | 30.64 → 9.07 | 7310 → 1002 |
| 20 | 240 | 1000 | 687.00 → 672.00 | 687.00 → 672.00 | 682.36 → 673.94 | 205935 → 205935 |
| 40 | 0 | 20000 | 64.85 → 10.95 | 64.85 → 10.15 | 66.71 → 10.73 | 12208 → 1004 |
| 40 | 240 | 1000 | 749.00 → 734.00 | 735.00 → 734.00 | 729.75 → 722.30 | 210884 → 210884 |
| 250 | 0 | 20000 | 299.25 → 9.40 | 299.20 → 9.35 | 301.81 → 9.15 | 72299 → 1004 |
| 250 | 240 | 1000 | 906.00 → 984.00 | 875.00 → 969.00 | 876.72 → 958.42 | 271178 → 271178 |

The empty-view improvement is repeatable within this focused measurement; the historical path is an unchanged algorithm, **not** a zero-regression timing guarantee. The guarded 250-entry historical control still measured +10.74% thread CPU, illustrating why no universal speedup is claimed. Local OS/JIT/GC variation is not isolated by this microprofile. At current catalogue size the empty-view difference is 54.70 us thread CPU/projection; this is not whole-service CPU or latency.

Clone count remains one per projection. JSON input bytes are a size proxy, not measured V8 allocation. Raw rows include endpoint heap deltas before/after forced GC; they do not establish retained-RAM savings. HTTP p50/p95/p99, fsync, SQL time and 20/50-user capacity are not measured here. Original strict capacity/coexistence gates and provider-budget blockers are unchanged. No claim that this change remedies those FAILs.

## Independent history deadline defect

The original history queue relied only on a 2000ms timer. In a local held-slot probe, ordinary timer delivery rejected SOURCE_BUSY, but delaying the timer phase admitted a queued callback at 2063.15ms. No external requests were made. See history-deadline-before.json.

The fix stores a monotonic deadline, discards expired FIFO waiters when granting a slot, and rechecks before the granted continuation starts. Two active slots, eight waiters, the same 2000ms deadline and provider request budget remain unchanged. Granted-but-expired work releases/transfers its owned slot; rejected-before-grant work owns no slot. This can correctly return more SOURCE_BUSY responses under starvation; it is not a relaxed acceptance criterion.

All three new deadline regressions fail against exact baseline source (full failures in history-deadline-negative.log), and pass with the fix. Existing cache tests confirm shared immutable page identity, exact provider/interval/cursor distinction, TTL corrections and retained-byte limits; no history serialization/cache rewrite was justified.

## Verification and reproduction

Root's final integrated mandatory runtime suite: **192/192 PASS**, zero failed/skipped/cancelled, 7.7118s. New projection tests cover exact serialized equality, quote age/validity, both currencies, original nonempty path, metadata absence/undefined/null, requested-key preservation, input immutability, read-only HTTP nonpersistence, cross-account separation and owner-gate rejection. Parent owns final CI/build status.

Run from the repository with Node 24.21.0 after agreeing an idle measurement window:

`node --expose-gc docs/evidence/stocks-boundaries-20261013/view-projection/microprofile.mjs <outside-repository-output-directory>`

The script refuses changes to normalized measured engine/catalogue/helper source. It records current HEAD and raw source hashes, generates fixtures locally, performs no network requests, and writes only its result file to the chosen output directory (a unique OS temp directory if omitted). Use `--check-source` to validate source guards without profiling. Exact numbers are host-dependent; do not substitute this microprofile for the original acceptance scenarios.
