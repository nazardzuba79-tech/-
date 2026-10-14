# Package, TLS and public-host contract evidence

These are finite **local Windows / Node24.21.0 fixture checks**. They do not certify production auth, hosting, capacity, live quotes, data rights or deployment. No production endpoint, database or financial account was used. Raw account databases, compiled bundles, environment files and private keys are deliberately excluded.

The public-host/evidence-manifest.json lists SHA-256 and byte counts for every copied artifact, original retained output path, and the reviewed source hashes **at the Windows SPKI snapshot**. It remains immutable historical evidence. It does not bind subsequent Linux NSS implementation changes. Historical sources are distinguished explicitly below.

| Evidence | Result | Meaning |
|---|---|---|
| package/report.json |57 assertions PASS | Standalone copied Stocks runtime, owner/viewer, Wallet, lost acknowledgement, restart, same-ID replay, feature-off, FULL quiesced restore |
| package/closure-guards.log |3 tests PASS | Literal AST module/worker closure; npm dependencies, unresolved worker and scope escapes rejected |
| tls/historical-r3-report.json |41 assertions PASS | Historical strict TLS ingress and actual compiled fixture /me; use its historical source hashes |
| public-host/final-all-guards.log |16 tests PASS | Current package3 + TLS10 + public static/shadow2 + immutable-artifact provenance1 |
| public-host/before-wallet-gap-r2-report.json |38 checks; known Wallet gap | Public ON selected legacy but Wallet issued1 global portfolio request |
| public-host/final-r4-report.json |40 assertions PASS, limited TLS evidence | OFF0 and ON0 global requests; QA-only candidate positive; cached feature-off denied; historical SPKI exception |
| public-host/nss-portable-guards.log |16 tests PASS | Linux-only/tool/bypass guards3; normal Node TLS11 including wrong SAN; public fixtures2; not a Linux browser run |

## Standalone package and exact recovery

The14 runtime files use Node builtins/relative modules and execute from a fresh external temporary copy, with no NODE_PATH or NODE_OPTIONS and no resolvable workspace npm dependencies. The actual compiled /me authority is a **separate fixture** which uses the existing workspace dependencies; it is not part of the standalone runtime artifact.

All14 canonical-LF runtime hashes match Git50b16c1d9e5d07503b84e3d9ac810708847d2a8e. Twelve raw working-copy hashes differ because of CRLF. runtime-manifest.json records both; the child verifies actual copied raw bytes. This does not certify another Node binary, Linux file permissions or a deployment image.

The original primary SQLite hash stays unchanged. After restore and same-ID retry, every ledger field other than revision matches exactly: wallets, reserves, orders, fills, positions, quotes, realized P&L, adjustments, settings and metadata. The owner revision advances3→4; the viewer remains0→0. Post-replay database bytes therefore differ, as the report explicitly records. There is no second fill or debit. This is same-binary recovery, not compatibility with an untested historical binary.

The catalogue-before-report preserves a real QA-adapter failure: it looked up instrumentId instead of id. Current QA requires the exact AAPLX/Bybit/USDT identity and company metadata. Earlier54-check runs are not catalogue correctness evidence.

## Historical and current TLS evidence

The41-check historical rehearsal is bound to historical-r3-source-hashes.json and historical-r3-review-manifest.json. Those are not the current ingress hashes. It proved strict SNI/Host/Origin, per-request fixture CA, authentication/CSRF, bounds, and feature-off admission including a partially received POST.

The current source adds a default-off browser GET/static QA mode. Current16-test guard output includes10 TLS cases and2 public static/shadow cases. Default strict behavior, wrong/missing authority, duplicate headers, body/framing limits, disconnect, deadlines, partial-body disable and metadata stripping still pass. Do not report the historical41 as rerun on current source.

The initial double-response failure and partial-body-disable FAIL are retained as raw logs. The latter is a real negative-control regression: enablement checked only at headers admitted a POST after disable; the fixed end-of-body check blocks it before forwarding.

## Public-host before and after

The before report intentionally captured a product mismatch: public ON kept the Stocks route local-only, but Wallet used the global flag without the hostname condition and issued1 portfolio request. The product fix reuses one pure exact-127.0.0.1 predicate for both.

The final three production-mode bundles are recorded in three-builds-r5-manifest.json, including all1166 frontend input hashes, flags, Vite dependencies and output hashes. Actual frontend files and normal frontend/dist were not overwritten by this producer.

- **OFF:**0 global requests; no Stocks terminal.
- **Untouched ON:** legacy terminal;0 global requests through Stocks and Wallet. The real allowlist was not broadened.
- **Candidate:** exactly one manifest-bound in-memory hunk adds stocks-review.invalid to the shared predicate. Existing Stocks mounts with USDT-only controls, and state/history/portfolio return200. This shadow is not a product change.

The candidate screenshot uses the pre-existing private one-candle/quote fixture. It is not a real price or chart demonstration. Both Desktop1440 and Mobile390 images are retained. All cases have0 uncaught JavaScript errors. Thirty-two attempted external font/icon loads were intentionally rejected; console failures from those and denied unrelated fixture routes remain visible in the raw report.

Cached browser requests to state, portfolio and orders return503 after feature-off, with0 authority, backend-forwarding and quote delta. This exercises fixture ingress admission; no real order is sent.

Those historical Windows browser runs applied an exact leaf SPKI exception only to the owned browser process. Separate Node CA/signature/SAN verification remained enabled. They are **not proof of normal-browser TLS validation**. Resolver mapping, HTTP/WebSocket routing and service-worker blocking are QA controls, not an OS egress namespace or installed machine trust.

New Linux browser code removes all certificate-validation exceptions and uses an ephemeral private NSS CA database and owned private HOME/XDG/profile outside uploaded evidence. Chromium sandbox is explicitly required; unsupported sandbox or missing dependencies fail without fallback. Its same-browser untrusted-CA/wrong-SAN/wrong-SNI/cross-origin negatives and cleanup must pass in a new exact-head Linux run. Until that result exists, strict normal-browser TLS remains **UNVERIFIED**. Portable guard results cannot substitute for it; `nss-candidate-manifest.json` separately binds the six new/changed QA source files and portable guard log without rebinding the historical Windows evidence.

## Reusing the producer artifact across jobs

The public runner verifies sibling build-provenance.json/build.log against current279 backend source inputs, compiler/config/lock hashes and exact package proof binding. All6 used emitted modules are read from the immutable producer package and checked against proof.outputs. Only non-dist runtime/source files are compared with current checkout files.

The provenance guard creates a separate source-only checkout without dist and succeeds using the downloaded compiled closure. It rejects8 independent corruptions before output copy: source, compiler, compiled module, build log, failed proof, changed emitted-output hash, manifest proof binding and missing emitted closure member. The current finite browser proof then reuses the same artifact without rebuilding the backend.

The artifact and source guard is current-source code. Its Linux CI execution and certificate dependency availability must be verified by the final workflow; local PASS is not a claim that a GitHub job passed.

## Retained setup failures

The outside-worktree originals remain unchanged. The failure-index.json binds additional earlier setup issues by raw hashes: incorrect producer cwd/Tailwind discovery, absent explicit Python in one unit invocation, empty static denial body, and omitted owner-USDT flag in the first browser setup. They were corrected in QA and are not hidden or retroactively promoted to final evidence.

Public GlobalStocks intentionally remains unavailable on a real hostname. These checks resolve local contract gaps; they do not remove remaining integration, operational, market-data or capacity release gates.

## Strict Linux launch correction

The first strict Linux execution at commit3fb092dc1475543240059556fb0cf033c7f967b3 failed before browser probes or UI cases. The bundled Playwright headless shell exited with SIGTRAP and `No usable sandbox!` on the Ubuntu runner. All three public-host cases are retained as NOT_RUN in public-host/linux-3fb-sandbox-failure.json; its bytes are copied unchanged from Actions artifact11857047515. The full14,043,835-byte artifact SHA-256 is36a240c60047e98f12d41c0ccf607a75306b189221be009fc8173558986f6609. Run: https://github.com/nazardzuba79-tech/-/actions/runs/38478532375.

The narrow correction explicitly selects the runner existing /opt/google/chrome/chrome executable, selected as a candidate compatible with the runner existing packaged AppArmor policy; support remains unverified until the new strict run succeeds. QA verifies the installed binary and package provenance, keeps chromiumSandbox:true, and retains the fresh private NSS store and all trusted-CA, untrusted-CA, SAN, SNI and Origin controls. It neither installs a browser nor modifies AppArmor, sysctl, system trust or sandbox settings. A new execution is required to prove this changed path; these source changes alone do not turn the retained failure into PASS.

The next strict Linux attempt at df67176c2faa9de3a34b479a55cf3b1836cf0987 also failed before launch: `Chrome executable permissions`. The raw report is retained unchanged as public-host/linux-df-permissions-failure.json. It contains no observed file mode, so it does not prove any particular permission value or justify changing it. All three cases remain NOT_RUN. Artifact11856799979 is14,054,655 bytes with SHA-2561621038354f88f3f4491293c0912651b47cb3d2abe086da2a99139b8efb2b177; run https://github.com/nazardzuba79-tech/-/actions/runs/38480547531. A bounded read-only preflight diagnostic is added to retain the rejected identity; the executable-permission gate and all TLS/sandbox requirements remain unchanged.
