# Production health follow-up — 24 September 2026

This follows [the initial audit](production-health-audit-20260924.md). Base: `22ac04b99f02a6501692cee4b8c507577becf914`. No merge, deploy, production trade, schema/config/credential change, or production cleanup.

## Confirmed CFD defect and fix

Changing the instrument in the CFD list updated React state but left the old `symbol` in the URL. A hard reload selected the old instrument instead of the selected/cached one. A new test against the actual TradePage reproduced this before the fix and passes after it. Selection now updates `market=cfd&symbol=...` with replace navigation, preserving unrelated query parameters; external deep-link changes still work.

The browser harness now records selected instrument, URL and display request URLs before/after reload. It retains the strict assertion of **zero additional display requests** on a cached reload. Local production-build QA passed at **1920, 1280, 768 and 390px**, preserving WTIUSD on reload with three initial display requests and none after reload; no browser errors, overflow or account writes.

The original failed CI report did not record the duplicate URL or request cancellation. Therefore the selected-instrument defect is proven, but a cancelled initial XAU request as the sole explanation of those older CI attempts is not retrospectively provable. The final CI rerun is recorded below.

## Full Jest baseline classification

The initial run had **126 failed tests in 28 suites**, with one suite failing to load. The starting audit commits changed only CI/docs, so these were existing failures against the merged runtime, not regressions introduced by the CFD fix.

| Suite | Initially failed tests | Cause and correction |
|---|---:|---|
| walletUxRefinement | 22 | Evaluator omitted toast/customer-error imports; collateral fixture omitted server flags; three old source fingerprints. |
| walletOverview | 2 | Cross-account fixture omitted authoritative walletEquityUsd. |
| cryptoCardProductionPromotion | 3 | Historical source reversal/fingerprints and whitespace-sensitive route check predated merged main. |
| sharedHeaderStylesheetOwnership | 4 | Windows separators and stale exact scoped-owner inventory. |
| orderBookCalmMotion | 1 | Source slice ended at an obsolete JSX prefix, including unrelated ratio styles. |
| ProviderFailureMatrix | 5 | Transport retries were tested through the now hard-capped CFD adapter; test shared transport directly, preserve actual CFD quota/freshness checks. |
| marketDataStore | 11 | Mock targeted the old API and old 3s cadence instead of sampled display transport and 60s floor. |
| registerWalletTailwindOwnership | 2 | Windows separators; regex confused conditional identifiers/template fragments with CSS classes. Parse JSX class values with TypeScript. |
| copyFirstLoad | 3 | Fixture asserted deferred analytics before its scheduled mount; whitespace-sensitive source assertion. |
| nazaraCardPresentation | 16 | Evaluator omitted LiveMetric; historical renderer/CSS fingerprints. |
| orderBookFreshnessAndExecution | 2 | Stale asOf reset/visibility-handler source expectations. |
| homepageTailwindUtilities | 3 | Windows paths, evolved lazy-import prefetch, and incorrectly built local CSS from root cwd. Build from frontend package. |
| marketUniverseScale | 2 | Approved public-offload transport files and extracted Futures discovery were missing from guards. |
| avatarIdentityPresentation | 2 | Avatar now retains initials underneath decoded photo; fixture assumed img root/one state slot; old renderer fingerprints. |
| cfdChartFallback | 20 | Evaluator imported an unrelated owned chart with import.meta; obsolete external-widget toolbar assumptions. |
| CfdQuoteSafety | 4 | Stale expectations for reference refresh credit cost, unavailable display quotes, retained stale display and hard quota. Execution still rejects stale/unavailable quotes. |
| spotPairTransition | 2 | Missing terminalPresentation dependency; current timestamp/group-step contract. Pair race assertions retained. |
| nazarProfileCorrection | 8 | Evaluator omitted LiveMetric and deferred analytics hydration. |
| heroReferenceTerminal | suite load | Missing homeMarketSnapshot dependency in evaluator. |
| plainLanguage | 1 | Windows-relative-path exclusion. |
| noProviderBranding | 1 | Provenance/URLs in pure public transport modules and official chart symbol were mistaken for displayed labels. |
| copyPrelaunchPromotion | 1 | Authenticated marketplace transport/timer moved to a shared store. |
| spotBookRefresh | 5 | Fixture targeted old private API instead of current public book transport and missing callback dependencies. |
| copyTradingCiCoverage | 1 | Windows import-graph path normalization. |
| CfdMarketDataService | 1 | Approved catalog name is Gold Spot. |
| LiveFinancialIsolation | 1 | Exact injection inventory predated public display/universe routing. Financial-service isolation assertions retained. |
| CfdQuoteRoutes | 1 | Display-only unavailable payload no longer fabricates bid/ask fields. |
| CanonicalSourcePreservation | 2 | Fingerprints predated merged daily progression commits e52231ed, 4f29e606 and 74704f27. |

Categories overlap: stale fixtures/contracts and existing historical source guards dominate; Windows paths and the local build cwd are environment-dependent. The new real runtime defect is the CFD selection/reload issue, which the old tests did not cover.

Source fingerprints were calculated from **git show of the fixed, fetched main SHA**, not from an altered generator. Runtime Copy Trading, wallet, authentication and financial services were not changed. Existing canonical response fixtures, monetary expectations, authorization, stale-execution refusals and quota limits remain independent checks. The integration workflow now also runs the entire repository against disposable PostgreSQL and uploads both JSON results.

**Full local Jest: PASS — 5,033 passed, 0 failed; 318 passed suites and 6
database-gated suites skipped (63 tests).** The skips are 50 Futures/native
PostgreSQL tests and 13 Banking referral PostgreSQL tests. All 63 are explicitly
enabled against the disposable CI PostgreSQL; they are not counted as local PASS.

## Existing production OPEN: measured breakdown

Source: existing request `b364a22b-eabc-4fae-8970-b15bd285de03`, 04:02:34 UTC. No new production order was placed. Seven existing confirmations measured 8,040–9,901ms.

| Stage | Elapsed window, ms | Duration, ms |
|---|---:|---:|
| API accepted → context start / lane | 0–1 | 1 (lane wait 0) |
| Repository context | 1–1540 | 1539 |
| Dispatch preparation | 1540–1541 | 1 |
| Instrument metadata | 1541–1946 | 405 |
| Price preparation | 1946–1947 | 1 |
| Near-live price request | 1947–1950 | 3 |
| Before-replay preparation | 1950–1993 | 43 |
| Replay | 1993–2200 | 207 |
| Remaining commit preparation, not internally instrumented | 2200–2698 | 498 |
| Commit authorization | 2698–2991 | 293 |
| Transaction acquisition / entry | 2991–3295 | 304 |
| Transaction lock | 3295–3596 | 301 |
| Transaction authorization | 3596–3893 | 297 |
| Existing receipt read | 3893–4039 | 146 |
| **Current account JSON update** | **4039–7093** | **3054** |
| **Immutable revision/receipt insert** | **7093–8357** | **1264** |
| Projection write | 8357–8654 | 297 |
| Final authorization | 8654–8948 | 294 |
| Commit/confirmation | 8948–9106 | 158 |
| HTTP response completion | 9106–9198 | 92 |

The concrete dominant operations are `tx.nativeDemoAccount.updateMany` and `tx.nativeDemoRevision.create` in `src/private-trading/native/store.ts`: **4,318ms / 46.9% of server request time**. Together with repository context, they account for **63.7%**. This is operation-level attribution, not a claim that PostgreSQL itself spent every millisecond executing SQL.

The trace enters with LIVE_EXECUTION reference metadata but actually dispatches **HISTORICAL_DEMO**; do not present this sample as proof of live-mode execution timing. No client request-start/network timestamp exists in the trace, so browser→API time is not measured.

Read-only linkage verified Render production voltex-api → VOLTEX Production Final before SQL. API is Frankfurt; database is Oregon. Revision storage was ~406.5MB of a ~424.9MB database, mostly TOAST, across 1,814 immutable revisions. Current account payloads were ~180.8KB and 488 bytes. These are observations, **not proof of active bloat, a leak, or the sole latency cause**. No active blocked sessions were observed at the sampled moments. pg_stat_statements is not installed.

**Remaining blocker:** existing instrumentation does not separate pool/network transfer, Prisma serialization, PostgreSQL execution/TOAST and commit cost inside those operations. A precise causal production fix requires an approved profiling/instrumentation window and controlled validation. No authorization, locking, receipt, replay or history safety was weakened to chase latency. **OPEN latency is not fixed.**

## Credential incident: bounded presence-only investigation

- **Confirmed exposure:** the full credential-bearing production connection string appears **six times in the local Codex technical session transcript**. The scan streamed the 2.57GB file and emitted counts only.
- No matching production credential found in the current worktree (excluding dependencies/build outputs), the PR commit range, PR body/diff/comments, six associated GitHub Actions job logs, or **six downloaded CI artifact archives (100 files)**.
- The check is for this incident's production endpoint/credential-bearing URL, not a claim that every secret in all account history has been audited. Encoded screenshots, external backups, retention systems and earlier unrelated histories are not exhaustively verified.
- No secret was echoed, committed, added to the PR, deleted from evidence, or rotated during this follow-up. Existing CI database credentials are disposable loopback fixtures, not the production credential.
- **Owner action required:** rotate the exposed production DB credential, update the production connection securely and verify connectivity. This changes production and requires explicit authorization. Transcript retention/removal also needs a deliberate owner decision; deleting a local copy does not prove remote copies are gone.

## Verification and release status

Local checks: full Jest PASS as above; CFD production-build browser PASS at
1920/1280/768/390; frontend production build PASS; git diff whitespace check PASS.
The final GitHub workflow links and outcomes are recorded in PR #231 after the
push: full PostgreSQL/Futures integration, native desktop/mobile/browser,
CFD reload, sampled display budget, Home first-load and Copy Trading regression.

Keep the PR in draft. Even if every regression rerun passes, OPEN causal
profiling and credential rotation remain open risks. **Not ready for merge
or deploy on the evidence in this report; neither action was performed.**
