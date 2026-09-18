# Native engine command-path benchmark

Compute and call-count evidence for the native/simulation trading engine's command path, taken with
`scripts/bench-native-engine.cjs` against the COMPILED service (`dist/`), an in-memory repository and a
fixture market. It is the "before / after" for the engine correctness package (blocks A–C on
`claude/peaceful-volta-h5zw7g`), not a production measurement.

## What is measured

- One `NativeDemoService.command()` from call to authoritative response, per command kind
  (OPEN market 0.5, CLOSE 0.5, REFRESH), with N contracts already open (1 / 6 / 30), 1 000 operations,
  one second of fixture time per operation (so every command sees a fresh quote and a distinct book
  snapshot, and a minute boundary is crossed every 60 commands).
- Upstream calls each command made: quotes (`freshQuote`) and history windows (`history`).
- The persisted payload as the repository would write it (account payload + immutable revision, in the
  stored shape) and the size of the JSON response.
- OPEN outcomes: filled / partial / rejected, so a "fast" figure cannot hide refusals.
- Node event-loop delay p99 across the run.

## What is NOT measured

- PostgreSQL / Neon commit and read time, HTTP, TLS, the browser, React rendering. These are added on
  top in production, never subtracted. The `quote latency 30 ms` variants add a simulated upstream round
  trip per quote to show the fan-out cost; production quotes the local market-data collector.
- Real Bybit liquidity or provider behaviour. Books and candles are synthetic fixtures.
- Cold start, host sleep, reconnects, a thin book, a burst of 30 simultaneous commands — separate
  scenarios, not run here.

The p95 ≤ 1 s target in `ENGINE_CONTRACT.md` is an end-to-end target (click → confirmed DOM). These figures
are the server compute component of that path only.

## How to reproduce

```sh
npm run build
node scripts/bench-native-engine.cjs --ops 1000 --contracts 1,6,30 --label after --out docs/qa/native-engine-bench/after.json
BENCH_QUOTE_LATENCY_MS=30 node scripts/bench-native-engine.cjs --ops 300 --contracts 1,6,30 --label after-quote30ms --out docs/qa/native-engine-bench/after-quote30ms.json
node scripts/bench-native-engine-report.cjs docs/qa/native-engine-bench/before.json docs/qa/native-engine-bench/after.json
```

`before*.json` were produced from a worktree of `main` @ `107e350` with the same script (its store has no
compaction, so its payload is measured as it wrote it). `after*.json` are the head of this branch.

## Results

<!-- generated: node scripts/bench-native-engine-report.cjs before.json after.json before-quote30ms.json after-quote30ms.json -->
### before-main-107e350 — 1000 ops, quote latency 0 ms, history latency 0 ms (2026-09-18T03:20:36.131Z)

| contracts | OPEN p50 / p95 / p99 | CLOSE p50 / p95 / p99 | REFRESH p50 / p95 | quotes per OPEN (p50 / max) | history per OPEN (max) | payload per commit | response p95 | journal | filled / partial / rejected (OPEN) | loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 59.29 ms / 111.44 ms / 119.76 ms | 59.07 ms / 111.97 ms / 122.2 ms | 33.88 ms / 63.03 ms | 2 / 2 | 1 | 5086 KB | 777 KB | 901 | 500 / 0 / 0 | 0 ms |
| 6 | 59.78 ms / 96.28 ms / 106 ms | 9.1 ms / 19.71 ms / 21.86 ms | 37.29 ms / 57.36 ms | 4 / 7 | 6 | 4690 KB | 515 KB | 512 | 500 / 0 / 0 | 0 ms |
| 30 | refused after 6 contracts (CONTRACT_LIMIT) | | | | | | | | | |

### after-C — 1000 ops, quote latency 0 ms, history latency 0 ms (2026-09-18T03:23:15.267Z)

| contracts | OPEN p50 / p95 / p99 | CLOSE p50 / p95 / p99 | REFRESH p50 / p95 | quotes per OPEN (p50 / max) | history per OPEN (max) | payload per commit | response p95 | journal | filled / partial / rejected (OPEN) | loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 47.3 ms / 96.15 ms / 104.15 ms | 47.31 ms / 95.06 ms / 101.37 ms | 20.38 ms / 42.22 ms | 1 / 1 | 1 | 2284 KB | 777 KB | 901 | 500 / 0 / 0 | 0 ms |
| 6 | 49.39 ms / 84.04 ms / 89.38 ms | 8.65 ms / 20.16 ms / 22.45 ms | 22.24 ms / 40.84 ms | 3 / 5 | 6 | 1882 KB | 515 KB | 512 | 500 / 0 / 0 | 0 ms |
| 30 | 82.41 ms / 126.3 ms / 141.64 ms | 12.18 ms / 58.76 ms / 79.02 ms | 46.78 ms / 67.47 ms | 18 / 19 | 30 | 2581 KB | 571 KB | 554 | 500 / 0 / 0 | 0 ms |

### before-main-107e350-quote30ms — 300 ops, quote latency 30 ms, history latency 0 ms (2026-09-18T03:11:07.244Z)

| contracts | OPEN p50 / p95 / p99 | CLOSE p50 / p95 / p99 | REFRESH p50 / p95 | quotes per OPEN (p50 / max) | history per OPEN (max) | payload per commit | response p95 | journal | filled / partial / rejected (OPEN) | loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 83.13 ms / 98.2 ms / 102.47 ms | 82.27 ms / 97.92 ms / 100.14 ms | 45.31 ms / 54.82 ms | 2 / 2 | 1 | 1526 KB | 236 KB | 271 | 150 / 0 / 0 | 26.69 ms |
| 6 | 86.6 ms / 100.94 ms / 104.5 ms | 3.19 ms / 6.68 ms / 103.58 ms | 48.76 ms / 59.66 ms | 4 / 7 | 6 | 1480 KB | 166 KB | 162 | 150 / 0 / 0 | 32 ms |

### after-C-quote30ms — 300 ops, quote latency 30 ms, history latency 0 ms (2026-09-18T03:25:32.109Z)

| contracts | OPEN p50 / p95 / p99 | CLOSE p50 / p95 / p99 | REFRESH p50 / p95 | quotes per OPEN (p50 / max) | history per OPEN (max) | payload per commit | response p95 | journal | filled / partial / rejected (OPEN) | loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 48.63 ms / 59.3 ms / 67.66 ms | 47.35 ms / 61.75 ms / 68.56 ms | 9.14 ms / 15.15 ms | 1 / 1 | 1 | 694 KB | 236 KB | 271 | 150 / 0 / 0 | 39.71 ms |
| 6 | 79.3 ms / 88.77 ms / 91.18 ms | 3.13 ms / 7.24 ms / 70.85 ms | 11.74 ms / 18.09 ms | 3 / 5 | 6 | 679 KB | 167 KB | 162 | 150 / 0 / 0 | 31.44 ms |
| 30 | 177.47 ms / 208.07 ms / 218.9 ms | 6.18 ms / 205.71 ms / 213.69 ms | 38.16 ms / 169.21 ms | 18 / 19 | 30 | 1378 KB | 222 KB | 204 | 150 / 0 / 0 | 50.4 ms |


## Reading the numbers

- **30 open contracts is now a scenario, not a refusal.** On `main` the seventh contract was refused
  (`CONTRACT_LIMIT`, a replay-time cap of 6); the cap is now an admission rule with a default of 30,
  tunable by `NATIVE_MAX_CONCURRENT_CONTRACTS`, and never applied to a closing, reducing or refreshing
  command. At 30 contracts a market OPEN costs **p50 82 ms / p95 126 ms / p99 142 ms** of server compute,
  a CLOSE **p50 12 ms**, a REFRESH **p95 67 ms**, with every OPEN filled (500 / 0 / 0).
- **Per-command compute fell ~18–20 % at 1–6 contracts** (OPEN p50 59 → 47–49 ms, p95 111 → 96 ms at 1
  contract; 96 → 84 ms at 6). What remains at 1 contract is intrinsic to the design: instructions inside
  the still-forming minute are re-applied on every command (up to 60 in this fixture's 1-op/s pattern),
  each re-running admission and fill against the account.
- **Persisted payload per commit halved** (5 086 → 2 284 KB at 901 journal entries; 4 690 → 1 882 KB at
  512): every OPEN instruction used to embed its full instrument (rules + a 20-tier ladder) and every
  order's full JSON was kept as its idempotency record, in the account payload, its checkpoint and the
  immutable revision. Instruments are now stored once per (contract, parameters) and referenced, and the
  idempotency record is a digest. The remaining size is the event/order history itself, which the
  response also carries in full (**response p95 777 KB at 901 entries — unchanged**); returning a compact
  receipt and paging history is the next lever and is NOT done here.
- **Quote fan-out is bounded, not eliminated.** The contract an order executes on is always quoted fresh
  and that quote is reused for the same command's valuation (2 → 1 quote per OPEN at one contract); other
  open contracts reuse a quote younger than `NATIVE_QUOTE_REUSE_MS` (2 s) and are fetched in batches of
  8. In this fixture's round-robin pattern the reuse rarely hits (18 quotes per OPEN at 30 contracts); in
  a real session bursts of clicks within two seconds do. With a simulated 30 ms upstream round trip the
  30-contract OPEN is **p50 177 ms / p95 208 ms** — the fan-out is the dominant term there, which is why
  production quotes the local collector rather than the venue.
- **Not measured here, and needed before any "≤ 1 s p95 click-to-confirmation" claim:** PostgreSQL round
  trips for the read, the commit and the revision insert (each carrying the payload above), HTTP, and the
  browser's parse and render of a 200–800 KB response. Those are the next things to instrument.
