# Stocks final performance investigation — PR #497

Review only. No merge, deployment, production database access, production load test or financial operation.

## Baseline and boundaries

Fresh-fetched main `e7c6fea3532ea78ff1e3d8287dc592ba2b82641a` and PR #497 head `3c5a6a73d014826c47a89541d4fe85b2fbc41761`. The latter is the paired before implementation. The original `read-load.cjs`, crypto comparison workloads, deadlines and acceptance criteria remain unchanged. Only observational SQL counters also wrap the new encoded query. The profiling/realistic harnesses are separate, synthetic, offline fixtures; their prices are never presented as actual market data.

No engine arithmetic, OHLC, execution prices, FX policy, rounding, order admission, account ownership, authentication authority or ledger schema changes. No Claude #495, Futures, Spot, Admin or production API changes.

## Measured causes and changes

* A 2,000-page local alternating microprofile found full SQLite row materialization dominant, followed by JS candle copying and JSON encoding. The native SQLite JSON experiment reduced total measured CPU by about 59% in that microprofile. This is not a throughput or production guarantee; exact CI evidence supersedes local timing. `Store.encodedHistory()` preserves decimal strings, nulls, order and exclusive cursors byte for byte; the existing full-row API is unchanged.
* 100 concurrent requests for one 300-candle MarketHub page previously made one provider call but built 100 arrays / 30,000 candle objects. A bounded normalized-page cache now coalesces parsing and HTTP encoding across accounts. History has independent expiry/admission from execution quotes; exact provider/instrument/timeframe/cursor keys prevent token or interval mixing. Corrections remain refreshable under existing TTLs.
* Global simulator polling previously committed a selected symbol's quote to every active account. It now commits only to accounts selecting, holding or awaiting orders in that symbol. Account transactions and matching rules remain unchanged. There is no unsolicited catalogue fetch at startup.
* Frontend reads remain selected-instrument-only, share in-flight requests within the current account view, and stop polling timers in hidden tabs. Identical candles preserve the existing array; fill/position updates no longer rebuild price/indicator series. The Professional B layout is unchanged.
* The bounded read-only candle service and authenticated simulator use separate SQLite files/processes. The old strict HTTP benchmark never includes the account database. The new realistic fixture explicitly measures authenticated account reads/commits together with supported timeframe history, so these paths are not conflated.

## Hardware, read-only verification

Live Hetzner aggregate measurements on 2026-10-10 at 11:58:46 UTC:

| Resource | Observed |
|---|---:|
| Logical CPU | 2 vCPU, Intel Xeon Skylake, KVM |
| RAM | 4,005,441,536 B / 3.730 GiB |
| Swap | 0 |
| Root filesystem total / available | 39,956,590,592 / 17,012,453,376 B |
| API / PostgreSQL memory ceilings | 1,500 / 1,600 MiB |
| CPU quotas / block I/O caps | None on either container |
| OOM events | 0 on either container |

A passive 30.012-second sample (12:00:00–12:00:30 UTC) observed host busy CPU 7.441% of two vCPU, 0.0505% I/O wait, zero steal, minimum available RAM 2,879,123,456 B, API+collector CPU 0.08744 vCPU and PostgreSQL 0.01117 vCPU. API memory was 267–293 MB; PostgreSQL about 641 MB. This is a short observation, not a peak-capacity certificate. No SQL, environment, logs or client rows were read, and no load was injected.

The realistic benchmark starts at the existing review budget of 0.05 vCPU / 256 MiB rather than assuming all spare host capacity is available. The same 1 MiB/s read and 128 KiB/s write caps are used. Any tested larger budget must be reported separately, never substituted for strict-test results. Existing container ceilings plus Stocks 256 MiB and a hypothetical 512 MiB OS allowance sum to 3,868 MiB, above physical 3,819.89 MiB: current idle memory is not a worst-case guarantee and the OS allowance is a planning assumption, not a measured requirement.

## Evidence and publication gates

The exact-head `Stocks isolated review` artifacts contain raw paired strict load, separate latency mirror, realistic mixed/shared 5/20/50-user runs and stage profiles. Success-only latency percentiles must be read with timeout/error counts; aborted requests are not successful three-second responses. CPU per reader is process CPU over elapsed time divided by active readers, not a dedicated CPU reservation. RSS per reader is an amortized measurement including shared memory, not incremental user memory.

MOEX/SBER remain blocked. Commercial Bybit/Binance data redistribution rights remain unconfirmed; see `services/stocks-global/DATA-RIGHTS.md`. Passing synthetic capacity tests does not confirm provider reliability, entitlements, broker execution or peak production capacity. The authenticated Alice/Bob security and restart regressions remain mandatory. Final measured tables and CI status are recorded in the PR after exact-head runs complete.
