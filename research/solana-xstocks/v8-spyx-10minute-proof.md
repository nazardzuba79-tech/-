# VOLTEX xStocks SPYx complete 10-minute on-chain proof — 25 October 2026

**Scope:** isolated read-only research. Never authorize Stocks BUY/SELL, production chart source, migration, merge or deployment.

- **Proved range:** 2026-10-25 06:10:00–06:20:00 UTC, 10 contiguous minutes.
- **Verified venue:** Raydium CLMM Solana pool \`4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw\`.
- **Issuer-verified Solana mint:** SPYx \`XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W\`, paired with mainnet USDC.
- **Finalized signatures inspected:** 300 in bounded descending history, 23 successful signatures inside the selected 10-minute interval.
- **Finalized Raydium SwapEvents in that interval:** 21.
- **Minute slots:** 7 actual trading minutes, 3 verified minutes without swaps (06:12, 06:13 and 06:17 UTC). No fabricated or forward-filled candles.
- **Actual RPC calls:** 31, zero HTTP 429 retries in the successful attempt.
- **Correctness:** pool-owner+mint verification, page-seam overlap checks, bounded sampling, complete older/newer time anchors, finalized transaction reads, event filtering, canonical intra-slot transaction ordering for duplicate slots; no incomplete window accepted.
- **Unit of prices:** USDC per *raw xStock token*. No corporate-action multiplier applied; do not label these as stock exchange quotes or independently licensed redistributed data.

Successful exact-head GitHub Actions run: https://github.com/nazardzuba79-tech/-/actions/runs/40169011065

First faster attempt (same 23 signatures window but HTTP 429, correctly failed closed): https://github.com/nazardzuba79-tech/-/actions/runs/40168931699

## Raw minute closes (USDC per token)

| UTC | Swaps | Close |
|---|---:|---:|
| 06:10 | 2 | 765.61888793 |
| 06:11 | 3 | 765.61029579 |
| 06:12 | 0 | null |
| 06:13 | 0 | null |
| 06:14 | 7 | 765.53512325 |
| 06:15 | 2 | 765.69654955 |
| 06:16 | 5 | 765.57884448 |
| 06:17 | 0 | null |
| 06:18 | 1 | 765.58445981 |
| 06:19 | 1 | 765.58385826 |

The full JSON/CSV time bars, throttling module and tests are in the user-facing **voltex-solana-xstocks-indexer-v8.zip** attachment; its SHA-256 is
\`ccaebe8d1ae33cde4799a2aba3eae6cb9248cdeec6e4f5611cd0abd0cfd0c35d\`.

**v8 deterministic local tests: 40/40 PASS**. The complete v8 source was packaged locally for the owner and was not uploaded as a Git tree here. GitHub contains the probe workflow and the research receipts.

## What is NOT proved

- This evidence covers *one 10-minute interval in one Solana pool*, not sustained daily/weekly chart uptime, exhaustive backfill, full DEX composite history, or exchange-grade spot prices.
- A public Solana RPC is rate-limited and unsuitable for reliable production archive/streaming.
- The official issuer's multiplier history was independently verified (seven tokens), but **not applied** to the above raw-token proof bars.
- Commercial redistribution/display rights, third-party provider TOS, and production capacity remain unresolved.
- No changes to main, PR #613, production, user balances, or trading controls.

**Next acceptance gate:** demonstrate complete nontrivial hourly series (four contiguous 15-minute windows) or a suitable low-cost archive/RPC plan, keeping all bars fail-closed and source-specific; and independently resolve display rights before activating Stocks for users.
