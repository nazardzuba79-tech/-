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


### Narrow source review corrections — 2026-10-14

The retained f045 successful compiler log is exactly zero bytes (SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
Receipt, config, workflow selected-member and derived-closure readers now accept
only that named size/digest-bound log. Proof JSON, executables, overlays and
helpers remain nonempty; tampered sizes, hashes and provenance are rejected.
The actual inline workflow reader is executed by a pure regression.

Observed safety or ordinary FAIL now survives incomplete trace/raw evidence,
cleanup, image cleanup and launcher-deadline gaps. Evidence completeness is
reported separately. Before correction the focused tests had 13 PASS / 2 FAIL;
after correction 16/16 PASS. Original classifiers and financial sources are
unchanged.

Final complete pure guard set: 139/139 PASS, 0 skipped, 447.2739 ms; log SHA256
`b7b3927a58a8026854a4cd187261fc18ffb400638aee6da5a791a797d8c703fe`. The separate built-in Worker check above is retained.
No workload, image preparation, HTTP burst, push or activation occurred during
these checks. The checked-in source policy remains disabled. All retained
backend/browser/capacity/coexistence failures and release blockers remain.


### Actual one-attempt result at 8d25df9d — 2026-10-14

Commit `8d25df9d7d5bd107497626e738d65fbca5bf3790`, run 38551215547,
job 115815125337: **INCOMPLETE**, CI job FAIL, no HTTP workload initiated.
Source, compiled artifact, device, image/native/closed-seed preparation and
local-receipt gates passed. Initialization stopped after 14.203113 ms; direct
authority, health, safety, warmup and ordinary request counts were all zero.
No workload containers were created. Cleanup was COMPLETE; the locally loaded
owned image was removed. This is neither a C50 PASS nor a new latency sample.

Exact blocker: the adapter command helper trimmed `git cat-file blob` stdout.
The reviewed 18,897-byte policy ends with LF; trimming changed its approved
SHA256 from `35b9fc7273dae9537f14e321650743906e2e6c2cb9937c57f099b9e18025fd90`
to `c94fef312fd389796cd027d03b732cdb1a45a28ef077b53a12c44e24ac671d86`.
The inner source gate consequently rejected `POLICY_BYTES_NOT_APPROVED`; its
assertion was retained as the bounded generic `TRACE_DIAGNOSTIC_ERROR`.
A read-only pure replay of the actual Git bytes reproduces the rejection with
the trimmed reader and accepts only the raw reader. It starts no workload.

Public failure artifact 11886819587 (3,797,217 bytes), SHA256
`ec2aa8e7bd9aef20a645058654aed41a196a3fff95c643fe8050f97e304ac748`.
Pure replay evidence SHA256
`9a5c2fb15f20184edb49c332950c2c93bead2b59a85aa34f094fc01b69bc3135`.
All 37 other exact-head workflows succeeded. Stocks runtime guards 207/207 PASS;
the new diagnostic guards 124/124 PASS. Full frontend: 263 suites / 4247 tests
PASS, verified from artifact 11887597089, SHA256
`bd376b2a0ef4f623c3df7cad51318a1e73eca2f0d7c10c0c66d034c03f017ddd`.
Market-edge deploy job was skipped. The existing full backend/browser gates
remain NOT_RUN here with their earlier FAIL evidence retained.

The 8d25 initialization attempt is consumed and will not be rerun. No actual
C50 measurement occurred. The causal raw-byte prerequisite correction is
verified with pure guards and frozen again through the existing disabled-source
to exact-policy transition before the one actual diagnostic workload. This is
not a retry of an unchanged failed head or a replay of a completed measurement.
No limits or criteria change. Performance and publication stay BLOCKED.

Raw Git-byte correction verification: all 141 pure guards PASS, 0 skipped,
411.2776 ms; log SHA256 `66a84d8601054ec730e3410d2c90f8c17c47a2874711812427e63823a5966392`.
The new reader retains Buffer bytes and the absolute timeout/post-return
deadline. Non-Git command behavior and all product sources remain unchanged.
