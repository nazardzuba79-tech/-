# Stocks SQLite isolation — PR #497

**Review implementation and measurement protocol.** Measured results and exact-head CI belong to the matching PR #497 run artifacts and review report; this protocol alone does not claim capacity or a performance improvement. No merge to main, deployment, production database access, production load or real financial operation is authorized or performed by this change.

## Revision and integration boundaries

- Worker comparison baseline: `0f01070b5d08ff88afa85d7a4a7e81d8eea8cfe2`, including the previous normalized-history and HTTP optimizations.
- Fresh main: `a2290d4f26a1b2ddf71c045110a89f185fd968e6`, containing the verified Mobile/Card/Auth integration #498.
- Integration commit on the Stocks branch: `eb3eb1f4bcf90e2831ad52ab820fced3c439a150`.
- A read-only merge-tree check found only an additive `docs/AI_HANDOFF.md` conflict. Both histories were preserved. Locale Stocks additions auto-merged; the 35 other changed Mobile/Card/Auth frontend files retained their exact main blobs. Futures/Spot runtime/design and Professional B are outside this worker change.

The earlier investigation, its observations and limitations remain in [OPTIMIZATION-20261010.md](OPTIMIZATION-20261010.md); [prior capacity evidence](prior-capacity/REPORT.md) remains preserved. Those figures belong to their recorded revisions and cannot be relabeled as results of this worker implementation.

## Why isolate account SQLite

Authenticated account work previously ran synchronous SQLite reads and FULL durable commits on the HTTP thread. While that thread waits for disk, it also cannot serve an unrelated cached-history or health request. The separate read-only candle-service benchmark does not exercise this account database; its timeout or success rate cannot establish the cause or capacity of the authenticated simulator.

One Node Worker thread now owns the same isolated account SQLite file and invokes the existing engine. This uses the same machine, process and resource budget; no extra server is purchased or provisioned. It removes synchronous account work from the HTTP event loop, but **does not remove disk synchronization, create additional CPU capacity, or guarantee lower total resource use**. Worker startup, IPC, structured cloning and its heap add measurable overhead that must remain in the before/after CPU/RSS figures.

The main thread authenticates each request, enforces account ownership, CSRF, source admission and the MOEX gate, then sends an explicit command. The worker performs `ensure`, `read`, `interests`, `quote`, `quoteFailed`, `submit`, `cancel` or `balances`. Commands contain no executable callback, arbitrary SQL or client-selected account identifier. Input is cloned before queueing; each response is matched to its request ID and resolved account context. First-context initialization uses singleflight so concurrent requests cannot generate competing CSRF tokens.

History for an existing authenticated context remains on the shared MarketHub path. Initial history for a previously unseen principal still waits for durable account creation. This cold-context dependency must be included when interpreting first-read latency. Background interest results cross the worker boundary as selected/held/active-order IDs rather than full account snapshots; normal account responses still contain the authoritative account state.

## Financial and durability invariants

- Existing engine code, OHLC, quote timestamps, execution prices, currency conversion, rounding, PnL, capacity/idempotency and order rules are unchanged.
- SQLite keeps `journal_mode=DELETE`, `synchronous=FULL`, `busy_timeout=1000` and `BEGIN IMMEDIATE`. The ledger is loaded and validated within the same transaction; successful mutations are acknowledged only after COMMIT.
- One dispatched command plus a bounded FIFO replaces implicit event-loop blocking. Defaults are 128 total outstanding requests, 1 MiB of accounted serialized inputs and a 2.5-second queue wait. Bounds are not a user-capacity certificate.
- A queued timeout or admission rejection returns `ACCOUNT_BUSY` before execution. Dispatched mutations are not canceled on HTTP timeout. There is no automatic retry, optimistic balance acknowledgement or background replay.
- A lost worker/acknowledgement during a mutation, failed rollback or failure after successful COMMIT returns `ACCOUNT_OUTCOME_UNKNOWN`. The worker is taken out of service, queued undispatched work is rejected and subsequent account requests fail closed. Recovery requires a controlled reopen and reconciliation of the same persisted request ID; it must not invent a replacement order ID.
- The existing browser keeps a pending order ID scoped to the resolved account and reuses it for the unchanged canonical payload after failure. It clears that ID only on success. A different payload is a different intent, not proof that the earlier order failed. Existing cancellation IDs remain safely repeatable.
- Quote freshness is evaluated when the command executes. Tests may inject a clock, but its shared value is updated at dispatch rather than admission, so time spent queued cannot preserve an expired quote as fresh.
- Normal close drains accepted work under the same queue-expiry policy before closing SQLite. Account files, reservations, consumed quote capacity and ownerless legacy JSON are not reset or reassigned.

The failure-injection hooks are constructor-only test controls. There is no route, environment switch or user payload that can enable them. [ACCOUNTS.md](../../../services/stocks-global/ACCOUNTS.md) describes the service interface and remaining operational limits.

## Measurement protocol

The workflow builds exact before/after images and runs the same fixture transport, catalogue, accounts, reader schedule and acceptance rules. Prices in this harness are explicitly synthetic **test fixtures**; external market/provider calls are zero and no fixture quote is exposed as real data.

| Scenario | Budget and workload | Interpretation |
| --- | --- | --- |
| Original hard resource gate | Unchanged 0.05 vCPU / 256 MiB, 250 instruments, 50/100 readers, cold/warm cache, three-second deadline, original disk limits and criteria | Preserved strict gate; no threshold relaxation or replacement by another scenario. |
| Authenticated realistic, bounded disk | Before `0f01070…` versus candidate; 0.05 vCPU / 256 MiB, 20 available token instruments, 5/20/50 accounts, mixed and shared-chart workloads; 1 MiB/s read and 128 KiB/s write | Measures account SQLite and actual supported timeframe/history paths under the original constrained allocation. |
| Authenticated realistic, host-unrestricted disk | Same before/after workload and **same 0.05 vCPU / 256 MiB**, but no synthetic device byte-per-second caps | Separate CI-disk observation. Motivated by the previously observed absence of production container I/O quotas; it does not establish Hetzner disk speed, spare capacity or strict-gate acceptance. |

The block-device mapping and I/O proof accompany the bounded measurements. If proof is missing, that result cannot certify the disk-limited gate. A passing workflow execution may mean evidence collection succeeded even when a capacity acceptance field is false; report both separately. No production load test is part of this protocol.

For every before/after scenario retain raw success/error/timeout counts, HTTP error codes, success-only p50/p95/p99, elapsed time, process CPU, RSS, cgroup throttling/OOM/I/O, SQL counters, fixture provider calls, external calls and queue backlog. Never hide rejected or aborted reads behind success-only percentiles. Cold account creation, quote commits and work still pending at the end of the sample must be identified.

SQL diagnostics use `process.threadCpuUsage()` around the worker's actual SQLite operations, alongside wall time. They distinguish read/write/configuration/BEGIN/COMMIT/ROLLBACK and exclude JSON encoding, ledger parsing and engine validation from SQL timing. Whole-process CPU covers all threads; it is not interchangeable with SQL thread CPU. Cached numeric diagnostics include `observedAt`, age and queued/active counts; they do not force an extra database request when sampled and may not include the currently running commit. If thread CPU is unavailable, its availability flag makes that limitation explicit.

CPU per active reader is measured process CPU over elapsed time divided by reader count; RSS per reader is amortized shared RSS, not incremental private memory. Only an allocation that passes all recorded acceptance criteria may be listed as a tested minimum for **that scenario**. Neither dividing idle resources by per-reader averages nor moving work to a thread provides a 100-user guarantee.

## Required safety evidence and publication gates

Fixture regressions cover Alice/Bob isolation, durable acknowledgement verified through an independent SQLite connection, failed pre-COMMIT rollback, worker death after COMMIT, post-COMMIT snapshot failure, lost cancel acknowledgements, unchanged request-ID retry, bounded admission/bytes, never-executed queued expiry, execution-time freshness, restart persistence, matching/cancel races and HTTP history/health while a commit is blocked. Existing simulator and full frontend regressions remain required on the final SHA; tests are not disabled or weakened.

MOEX/SBER remain blocked pending verified real data. Bybit/Binance commercial display/redistribution permissions remain unconfirmed; the [data-rights gate](../../../services/stocks-global/DATA-RIGHTS.md) is unchanged. Production identity routing, TLS/proxy, backup/restore, operational quotas and production peak capacity still need their own verification. This worker implementation and a green fixture CI result do not authorize publication, broker execution, real balances, a production migration or deployment.
