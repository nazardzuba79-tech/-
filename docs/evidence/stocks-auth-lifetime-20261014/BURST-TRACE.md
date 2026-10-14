# Disabled one-burst diagnostic source review

Parent/runtime baseline: `f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8`.
Owner-authorized PR #512 branch: `dot/stocks-owner-usdt-portfolio-20261013`.
This commit contains reviewable diagnostic infrastructure only. The checked-in
policy is disabled. There is no new measured burst or capacity result here.

Read-only inspection of the retained compact-authority evidence found 45 ordinary
three-second deadlines (18/13/14), all in the 50-reader cohorts. Authority admission
was after the client deadline for 24 of them, by 86.106–491.820 ms. The remaining
21 authority handlers finished 3.254–207.319 ms before the client deadline.
Driver-to-authority admission was 2792.063–3492.246 ms, while authority handler
time was 0.377–1.619 ms. Service CPU periods were almost continuously throttled.
This does not establish which uninstrumented service phase consumed the interval;
it does not justify changing SQLite durability, admission limits or quote TTLs.

The reviewed implementation derives hash-guarded disposable instrumentation for
one C50 burst. Original product, financial, auth-fixture, matrix and observer
files remain unchanged. It records bounded numeric phase boundaries, synchronous
thread CPU and independent client/gateway/authority terminals. Missing evidence
is INCOMPLETE; actual deadlines remain FAIL. Async wall time is never presented
as CPU, and partial observer wall time is not subtracted from CPU.

The complete limits and safety model are in
`services/stocks/auth-burst-trace-512/README.md`. The only new workflow job is
serial after all prior Stocks jobs, same-repository PR512 synchronize only,
run attempt one, with a non-cancelling concurrency lock. A separate reviewed
policy transition must bind the exact canonical source tree, unchanged financial
blobs, actual compiled archive, verified native image, closed seed and local
preparation receipts before any workload. No fabricated artifact IDs are used.
Image/seed never leave the preparation job. One persisted attempt marker rejects
retries. Existing finite experiment jobs retain their exact completed-head pins.

Local validation before source freeze:

- 129/129 combined pure guards PASS, 0 skipped, 409.3811 ms. These are diagnostic
  and scheduling guard tests, not a new HTTP/load or backend acceptance run.
- The separately authorized built-in Worker environment-data test passed 1/1
  (35.9745 ms test, 133.6566 ms suite), no app, DB or HTTP. It verified the exact
  original five workerData keys and a shared buffer surviving key deletion.
- Follow-up workflow raw-artifact paths were corrected to the actual adapter
  archive filenames; final source checks are recorded in the review packet.
- Parent exact-head CI was 38/38 successful workflows; both frontend suites
  passed 263 suites / 4247 tests. Backend and browser were intentionally NOT_RUN
  on exact reviewed QA bytes, preserving the prior FAIL artifacts below.

Retained release blockers, unchanged:

- Backend run 38533286576, job 115752113535: 251 suites (234 PASS, 5 FAIL,
  12 SKIP), 3714 tests (3581 PASS, 9 FAIL, 124 SKIP); artifact 11880028341,
  SHA256 `621f2f054bdf1227cbcdb0f38e1c24296cf28c98c6fa297dcc643894a2c846c2`.
- Browser prelaunch identity rejection; no browser execution or permission
  bypass. Artifact 11879126370, SHA256
  `5eee6f0a485202ba84f9cf5260f2cd1511f1f66c7dd9ab6eb141ccf9c2888f26`.
- Original strict capacity and crypto coexistence FAIL (crypto p95 deterioration
  13.6486% / 13.8114% against the unchanged maximum 5%).
- Commercial Bybit/Binance redistribution rights unconfirmed; MOEX/SBER blocked.
- Production capacity and the owner's full publication gates remain unproven.

No merge, deployment, production access, production DB change or financial
operation is performed by this source review. Status: BLOCKED.
