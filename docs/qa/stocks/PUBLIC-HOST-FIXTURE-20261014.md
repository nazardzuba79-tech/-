# Public-host-shaped Stocks frontend rehearsal

This is disposable local QA, not a public deployment. Reserved hostname stocks-review.invalid resolves only inside the owned browser process to a loopback TLS listener. No DNS, system certificate trust, production API, provider service or production database is changed.

## Three separate built cases

The public-build helper invokes existing Vite configuration from its normal frontend working directory. It uses an empty environment-file directory, explicit Stocks flags and fixture API origins. Output goes to three new directories outside the checkout's normal frontend/dist. Source/config/dependency input hashes, environment flags and every output hash are recorded.

1. **Off:** Stocks/global/widget/owner-USDT flags are false; the unmodified frontend mounts no Stocks terminal and makes no Stocks Wallet request.
2. **On:** those flags are true; the unmodified public-host frontend still selects the legacy widget terminal, because the shared stockHostPolicy permits GlobalStocks only on literal 127.0.0.1. Wallet uses the same exact predicate and must make zero GlobalStocks reads.
3. **Candidate:** a pre-transform asserts one exact hunk in that shared host-policy helper, then adds only the reserved fixture hostname to the expression in build memory. Original and transformed hashes are recorded. This exercises existing GlobalStocks and real browser GETs without changing the actual source fence. It is not a publishable candidate or production gateway.

These cases must not be conflated. A positive fixture candidate cannot turn an untouched public-host failure into readiness.

## TLS and read admission

The QA ingress remains strict by default. An explicit allowSameOriginRead option permits an absent-Origin **GET** only when SNI, Host and Sec-Fetch-Site same-origin match. Present Origin must match exactly. Writes retain strict Origin, bearer/CSRF checks in the actual Stocks backend, route/body/header bounds, and complete-body feature-off admission. Browser metadata headers are accepted only in that QA mode and are not forwarded.

The optional QA static handler serves only hashed manifest assets and a finite SPA route list. It denies duplicate headers, cross-origin context, mutation methods and arbitrary filesystem paths. Its sole real-code authority route is the local fixture's compiled /api/v1/me; other Wallet reads are explicitly private fixture values reused from the earlier Wallet journey. Financial writes are denied, including the Wallet portfolio-snapshot attempt.

Python cryptography generates an ephemeral one-day CA and leaf. Node checks CA/signature/SAN and performs normal per-request certificate validation. New browser execution is **Linux only with normal Chromium certificate validation**. It creates a fresh0700 private HOME, XDG directories, TMPDIR and Chromium profile outside artifacts. Only the ephemeral fixture CA is imported into that private NSS database with server-CA trust `C,,`; no private key or global trust store is imported or modified. Chromium's documented existing `HOME/.pki/nssdb` compatibility location is used, including releases146+. [Chromium certificate management](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md).

The helper verifies the actual Linux `libnss3-tools` certutil executable, hash, package ownership and versions, requires exactly one CA in its new trust inventory, and verifies the exported certificate fingerprint. Chromium sandboxing is explicitly enabled; actual spawned arguments reject certificate/security bypass and no-sandbox flags. If the disposable runner cannot support its sandbox, the run fails without silently disabling it. Clean child environment omits inherited preload/proxy settings. The Playwright-created profile must reside inside private scratch; all scratch is removed only after the owned browser exits. Only safe paths/modes/fingerprints and command metadata enter artifacts; NSS databases, browser cookies/profile state and key files do not.

The same browser first proves a valid chain, then rejects an untrusted CA, a trusted-CA leaf with the wrong SAN, and wrong SNI; an actual cross-origin browser POST receives403. Negative checks require zero authority, backend-forwarding and quote deltas. Host/duplicate-header negatives remain explicit Node TLS regressions. Resolver mapping and Playwright HTTP/WebSocket routing reject outside destinations before application dispatch; service workers are blocked. This is a **QA process/browser boundary, not an OS network namespace or production egress firewall**.

## Evidence and limits

The finite runner uses a fresh separate fixture account database and already fresh-build-proven compiled /me package after byte/source validation. It records actual request statuses, component selection, public Wallet behavior, Desktop/Mobile screenshots, uncaught errors, intentional external font/image denials, and cached-browser feature-off GET/POST admission. No performance or live-market-data claim follows.

Cross-job reuse verifies the package's sibling build-provenance.json and build.log against the current backend source, TypeScript compiler, lockfile and configuration. The package manifest must bind that exact proof hash. All six used compiled authority modules are verified against the proof's emitted output hashes **inside the downloaded package**; no backend dist directory or extra backend build is required in the browser checkout. Non-compiled fixture/runtime/source files still must match the current checkout. Missing or extra emitted closure files, changed source/compiler/compiled bytes, altered log or failed/rebound proof all reject before copying to a new output. The downloaded artifact remains read-only.

The candidate chart uses the existing private one-candle fixture from the local-stage harness. The untouched legacy widget is not certified as providing live data. Blocked production publication remains appropriate until integration, operations, capacity and market-data-rights gates are met.

Portable guard command: node --test scripts/qa-stocks-tls-ingress.test.cjs scripts/qa-stocks-public-fixtures.test.cjs scripts/qa-stocks-public-nss.test.cjs, with an explicit STOCKS_FIXTURE_PYTHON executable. The16 local guards include11 TLS cases,2 public fixture cases and3 NSS guard cases; they do not constitute a Linux Chromium run.

Build: node scripts/qa-stocks-public-build.mjs --output <new-absolute-directory>.

Browser (Linux): node scripts/qa-stocks-public-host.cjs --output <new-absolute-directory> --build-root <verified-build-directory> --authority-package <verified-local-stage-package> --python /usr/bin/python3 --playwright <existing-playwright-module> --certutil /usr/bin/certutil.

Python must have the cryptography module in isolated (-I) mode. Existing Playwright/browser binaries and Linux libnss3-tools/libnss3 must be supplied explicitly. Scripts fail without prerequisites; they never install, skip or fall back to a browser TLS exception. The reviewed disposable Ubuntu CI prerequisite step may provision only libnss3-tools/python3-cryptography from signed Ubuntu repositories when absent; this is separate from script execution and never installs a CA globally. Linux runner dependency availability and strict browser execution remain unverified until their exact-head CI result exists.

Prior producer r1 had an incorrect Tailwind working directory and is superseded. Public browser r1 verified host fences but omitted the owner-USDT-only build flag, so it is not final PR512 UI proof; final explicit flags and a currency-button assertion correct that QA setup. Old artifacts remain preserved.

Public browser r2 (38 assertions) is preserved as **before-fix evidence**: unmodified ON selected legacy while Wallet made one portfolio request. A separate narrow product fix centralized the existing exact-127.0.0.1 predicate and reused it in both views. The subsequent causal rerun requires unmodified ON to make zero GlobalStocks reads; the candidate-only transform now targets that shared helper. It does not broaden the real allowlist.

Historical Windows browser r3/r4 use build r5 and pass40 assertions: OFF makes zero GlobalStocks requests; untouched ON still selects legacy and now makes zero GlobalStocks requests through the whole Stocks/Wallet journey; the one-hunk candidate mounts GlobalStocks and reads state/history/portfolio successfully. Cached-browser feature-off calls to state, portfolio and orders return503 with zero authority, backend-forwarding and quote delta. These historical runs used an exact leaf SPKI validation exception and **are not strict normal-browser TLS proof**. Their raw reports/source hashes and screenshots are retained unchanged. New Linux normal-TLS verification is a distinct run, not a reinterpretation of those results. Public GlobalStocks remains intentionally unavailable.

Outputs and private fixture ledgers remain outside Git. No merge, deploy, container build or production environment access is part of these scripts.
