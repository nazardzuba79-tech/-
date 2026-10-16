# B affected20 result — exact1587ee6f

**PASS for the two finite local synthetic viewer-admission and financial-cycle cases, with two explicitly retained initial trader recovery QUOTE_STALE responses in cold.** This is not whole-product/real-provider/CX23/crypto acceptance.

Source **1587ee6f13f86dc5e4e87e342a87496bc1bedb56**, tree **c8443567ca725850c17304c20b62976a797158f8**. A versioned receipt SHA256 **b0b929c433ec6abe6fa2eb42d8f1983a68db23855d87e39f36ab69fbfb49f131**; coordinator review SHA256 **fd93dc05a21aa1ca2493eca6370ea896469de54be97860388f4f9aac91080085**. Own immutable source47 .mjs files all raw=Git (includes unexecuted tests),43 receipt Git rows,295 versioned build files, closed seed **b719b1e8435c3e70563963df1272170cd2074c2818b628f3d7f17e0be996deca**. No dirty UI files read or executed. Every runtime/build/seed path used by workload belongs to B's own packet.

Repaired launcher verified47 raw/canonical sources and306 raw inputs before spawn;0 CRLF exceptions. Verify-only and actual-launch receipts are retained. Reviewed plan SHA256 **dbf3d55b716c1a0f3330fef0d03297fbef6bc43cf4c3d5c43137f5f7235034de**. Inputs rehashed unchanged after run. Old9dd manifests/reports/raw evidence also rehashed unchanged; its pre-admission anomaly remains unqualified and has not been retroactively cleared.

## Actual finite workload

Exactly1 pass of **20 cold +20 warm**, no1-symbol/full-matrix rerun. **1038 HTTP /61.6884813s**. Each30s cell:50 distinct authenticated viewers + exactly2 pre-existing fixture traders;450 viewer HTTP,492 workload HTTP total ≈16.39/s, plus finite controls/restart. Cold499 HTTP; warm539 includes40 prewarm HTTP. Limits unchanged:3s total request deadline,600 HTTP/cell, at most1200 HTTP for this2-cell plan,240s profile budget with30s cleanup reserve. Profile clock starts at harness wallStart after module imports; not a claim about a whole PowerShell setup deadline.

Cadence matches historical profile: each viewer catalogue once, history+state open0s, state5s, release10s, reopen next available ID(history+state)15s, state20s, release25s. Both traders initialize1.5s and perform buy/partial sell/full sell/limit/cancel at5/10/15/20/25s; each intent submitted twice with the same ID. No automatic retries. Same20 existing non-MOEX catalogue IDs, synthetic100/100.1 prices,50ms injected quote delay,0ms history delay. No live instrument availability represented.

Coordinator reserved CPU slot: A tests/build had completed and A/reference build/browser work was held. Start and completion were delivered to coordinator; terminal completion/slot release also delivered to A. Only offline audits followed. Windows Node24.21.0; no cgroups/CPU/RAM quota applied.

## All-role results

Historical clarification is separate: old174/130 counted viewers only; old TOTAL SOURCE_BUSY was182/138, including8 trader reads/cell (4 alpha+4 beta). Original old reports are unchanged; HISTORICAL-ALL-ROLE-CLARIFICATION.json pins the raw rows.

|20-instrument cell|HTTP|SOURCE_BUSY all roles before→after|Viewer before→after|Timeout|p95/p99 ms, n492|
|---|---:|---|---|---:|---|
|cold|499|182→0|174→0|0|639.246/731.838|
|warm|539|138→0|130→0|0|583.949/681.377|

ALL market errors retained: cold has2 trader QUOTE_STALE at the initial recovery reads (alpha/beta); warm0 market-error rows. Cold rows are tagged initial-recovery and preserve the existing seeded-account recovery/demand fence; no trade starts until5s and every financial operation succeeds. Other role market errors0. Expected negatives per cell:3 AUTH_REQUIRED401 (forged viewer order, anonymous catalogue, revoked-viewer state) and1 BALANCE_EDIT_DISABLED422. No unexpected transport error or mutation error.

Per-request rows retain actor, action/path, monotonic timings, status/error, all marketErrors and quoteStatuses. They are not a request-correlated CPU/SQL/fsync trace. Raw quoteStatuses also retain recovery/stale quote statuses; no error response is discarded to obtain a faster percentile.

Old p95 values153/142ms included fast SOURCE_BUSY responses; new639/584ms values reflect successful admitted work, not a matched latency improvement/regression comparison. One sample/cell only, clustered actions, n492; no confidence interval estimated. p99 corresponds near the fifth highest sample.

## Quote admission evidence

|Cell|max active|max queued|sampled peak waiters|coalesced|started workload /incl prewarm|cancelled/expired/rejected|
|---|---:|---:|---:|---:|---|---|
|cold|2|18|52|126|82/82|0/0/0|
|warm|2|18|52|97|63/83|0/0/0|

All active/queued/waiters/flights=0 at workload drain and before closing the original instance. Prewarm and every50ms read-only metric sample are retained. Terminal restarted-instance counters are separately retained as fresh0s, not conflated with original counters. Limits remained2 active instrument flights/32 pending keys/256 waiters/nonrenewable2s admission. These are instrument admissions, not physical provider HTTP requests. TTL/native DTO/provider limits were not changed by B.

Fixture workload quote/history/catalogue methods: cold82/100/50; warm63/100/50 plus20/20 prewarm quote/history. Injected hub errors0. More quote work than old11/10 is expected because formerly rejected instruments are now served. Counts are fixture method work, not provider HTTP. Real provider100 starts/host/min and6s upstream deadline remain separate constraints;6s is not total client deadline.

## Finance/auth isolation

Each cell159 in-run assertions PASS, plus26 independent offline durable prefix/order-count/zero-position checks PASS. Viewer-only154-request bracket:153 authority starts (anonymous fails before authority), queue accepted0, SQL calls0, exact ledger hash unchanged, exactly2 accounts. Zero worker admission in that bracket plus exact viewer branch excludes ensure/readView/full-ledger/matcher work; direct per-function counters were not added. Concurrent financial metrics include legitimate traders and are not falsely attributed to viewers.

Both traders start731.25/129.875 testUSDT, end731.24/129.865 with0 reserves,0 position quantity/reserve,4 unique orders/3 fills each after market roundtrip and limit/cancel. Same-intent repeats produce no extra fill or money movement. Reload/restart retains exact financial state; copied DB integrity ok, exactly2 accounts. Durable readback after ACK is retained; no new physical commit/fsync timestamp proof.

|Cell|SQL calls/read/write/COMMIT|SQL wall/COMMIT wall ms|Financial queue accepted /maxPending|max queue wait ms|
|---|---|---|---|---:|
|cold|158/92/22/22|110.105/52.718|46/2|15.706|
|warm|154/88/22/22|109.677/47.403|44/2|15.066|

Queue timeout/rejection0; init configure2 SQL calls retained separately. No creation/reset/top-up through balances. Actual DemoBalance/native cash authority bridge and real identity binding are not established by these synthetic ledgers.

## CPU/RAM and observer limits

|Cell|Work user/system CPU µs|Total CPU ms|Sampled peak RSS bytes|CPU through restart/first raw export µs|Post-export RSS bytes|
|---|---|---:|---:|---:|---:|
|cold|1546000/734000|2280|126304256|2359000|120881152|
|warm|1422000/547000|1969|165158912|2078000|156590080|

CPU and RSS include client/gateway/authority/service/account Worker and retained evidence in one process. RSS sampling50ms can miss peaks; process lifetime maxRSS KiB124224/161360 is retained separately. Sequential memory/allocator retention and different4-cell versus2-cell process histories prohibit a memory-improvement claim. Post-export CPU includes restart and first raw export, final summary-write tail excluded.

Observer always on: existing SQL/queue diagnostics, HTTP records,50ms RSS samples, plus new read-only quoteMetrics snapshots/samples/all-role quote-status retention. OFF/ON overhead NOT_MEASURED; this is not an observer-paired crypto or CPU experiment. Windows unconstrained results do not prove Linux/CX23 quota/throttling/disk capacity. SQL FULL+DELETE source/configuration is not physical fsync evidence.

## Terminal scope

Original and restarted owned servers listening=false, workerAlive0, quote state drained0. One workload process exited0 and no matching workload process remained; acceptance derives from raw checks, not exit0. Current plan is consumed; no additional run follows this report.

No A product/shared files, UI tests, CI, old Actions, provider requests, production/live database/balance changes, paid resources, push/merge/deploy. Local monetary usage not independently metered.

Remaining separate gates: matched crypto p95≤+5% NOT_RUN; observer overhead NOT_MEASURED; Linux/cgroup/physical-fsync capacity NOT_MEASURED; steady real-provider/data-rights limits and actual Wallet cash/identity bridge not cleared. A owns final UI/build/CI/preview and product integration. No further B run without a concrete affected change/source-bound plan.
