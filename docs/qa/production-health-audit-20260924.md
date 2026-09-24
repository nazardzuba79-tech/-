# Production health regression audit — 2026-09-24

Follow-up fixes, test classification, detailed OPEN timings and the credential
incident investigation are recorded in [the follow-up report](production-health-followup-20260924.md).
The findings below describe the initial audit snapshot.

Status: **audit completed with unresolved findings; not an all-PASS release approval**. No merge or deploy was performed. Production was read-only; all order creation/fill/close scenarios used disposable local/CI fixtures, never production accounts.

## Scope and revisions

- Audited main/runtime: `22ac04b99f02a6501692cee4b8c507577becf914`.
- CI-tested audit commit: `510060ad6ee2039ccc07af3ace4d1825831049bc`.
- PR: https://github.com/nazardzuba79-tech/-/pull/231 (draft).
- Runtime, financial formulas, database schema, market mappings and customer UI are unchanged.
- This PR enables manual reruns of five existing workflows and uses branch-aware concurrency outside pull requests. It preserves their existing assertions and execution commands.
- The subsequent report/handoff commit is documentation-only. Results below belong to the exact CI-tested commit above, not an invented run on a later documentation SHA.

## Actual GitHub Actions results

| Workflow | Run | Result |
| --- | --- | --- |
| Futures integration | [35958340909](https://github.com/nazardzuba79-tech/-/actions/runs/35958340909) | PASS: 93 suites, 1,722 tests, zero skipped; disposable PostgreSQL 16 |
| Native demo / browser | [35958341030](https://github.com/nazardzuba79-tech/-/actions/runs/35958341030) | PASS: builds, native math/auth, browser, P&L latency/precision, large numbers, limit close |
| Sampled display budget | [35958340908](https://github.com/nazardzuba79-tech/-/actions/runs/35958340908) | PASS |
| Home laptop first load | [35958340893](https://github.com/nazardzuba79-tech/-/actions/runs/35958340893) | PASS |
| CFD display only | [35958340905](https://github.com/nazardzuba79-tech/-/actions/runs/35958340905) | FAIL on initial attempt and one failed-job retry: snapshot re-download after reload at 1920px |

CFD builds, collector/regression checks and its public-sources job passed. Browser output on both failed attempts showed 13 instruments, ready charts, one form and one submit button, no horizontal overflow at 1920/1280/768/390, no page errors and no blocked write attempts. These successes do not cancel the cache regression failure. No test was weakened to produce green CI.

## Local validation

Backend build, frontend typecheck and production frontend build passed. Local native browser QA passed 43/43 checks across mobile 320/390/393/430/768 and desktop 1366/1440/1920. Limit-close browser QA passed 4/4 long/short cases at 1440 and 390. Large-number browser QA passed 87/87 at 320/390/1440. Home first-load and snapshot reload passed. Worker allowlist tests passed.

Local CFD browser QA passed the same four widths, including reload; therefore the CI reload failure is environment/provider-dependent, not disproved by local success. Local cold desktop P&L preview took 2,745ms against a 1,500ms threshold; mobile passed. The equivalent GitHub P&L step passed. The local timing failure remains recorded.

The complete local Jest run failed: **324 suites (296 passed / 28 failed), 5,085 tests (4,896 passed / 126 failed / 63 skipped)**. Several failures involve Windows path separators, CRLF/source hashes, stale hand-written component evaluators or assertions against older provider/display contracts. This is not a claim that every failure is a false positive. The focused PostgreSQL integration CI supplies the database coverage skipped locally; it does not make the whole repository test run green.

Fresh local screenshots/reports are retained outside the committed screenshot corpus in `audit-evidence/fresh-local-qa/`. Existing screenshot files were restored after evidence preservation to avoid an unrelated image churn diff. Local full-Jest diagnostics remain in `audit-tests.json` and `audit-tests.log`.

## Futures evidence and boundaries

- MARKET and LIMIT long/short, rest/fill/cancel, partial fill/close, reduce-only, rollback/idempotency/concurrency and TP/SL: exercised by the disposable native browser/engine and PostgreSQL integration suites.
- P&L/ROI, margin, liquidation calculations and numeric precision: integration/native math checks; large-number UI checks passed. No production liquidation or real trade was triggered.
- EUR collateral: existing `EURUSDUSDT` / `BYBIT_FX_EURUSDUSDT_MARK` mapping preserved. Mapping and missing-quote behavior passed integration coverage; current public ticker and existing production command traces confirmed this symbol is in use.
- Desktop/mobile action accessibility: browser QA passed. Manual inspection of the 1440 fixture screenshot still found a clipped funding label near the order panel boundary; classify as a minor pre-existing UI issue, not a clean visual-parity claim.
- Authenticated real-account production end-to-end trading and production liquidation: **NOT VERIFIED**, deliberately excluded from read-only scope.

## Confirmed production observations

The live API health response matched the audited main SHA. Render connection endpoint metadata was matched to the owner-confirmed Neon project **before any SQL**. Only bounded read-only SQL was executed, without migrations, vacuum, compaction, pruning or extension installation. Detailed infrastructure identifiers and aggregate measurements are retained in the owner's local `audit-evidence/production-health-report.md` rather than raw production logs in this PR.

Database observations: approximately 405.21 MiB total; `NativeDemoRevision` dominates storage, almost entirely historical TOAST. Exact revision count and relation bytes remained unchanged across three samples over about 27 minutes; this was a quiet interval, not a workload growth guarantee. Existing production REFRESH logs reused revisions repeatedly, contradicting an unconditional append-on-every-poll hypothesis. Zero blocked sessions were seen in the snapshots. Exact bloat bytes and query fingerprints were unavailable because the relevant extensions were absent.

Performance finding: seven existing production OPEN confirmations took approximately 8.0–9.9 seconds. One trace attributed substantial time to database context/account/revision persistence, not a lane queue or price fetch. `src/private-trading/native/service.ts` command flow and `src/private-trading/native/store.ts` persistence are the relevant areas. The API/database regions differ; network round trips are a plausible contributor, not an established sole root cause. No lock, authorization, receipt or audit-history safeguard was removed as a speculative performance fix.

## Public data routing

Code inspection and public HTTP probes confirmed production Futures direct public provider paths plus edge fallback; Spot direct public Kraken paths plus edge fallback; Home and CFD sampled public display routes through the Worker. Worker health/tickers/books/display routes returned successful responses, while a private `/api/v1/me` path returned 404. Worker requests omit credentials; private account/order execution stays on the API. A complete authenticated production browser HAR was **NOT VERIFIED**.

Relevant code: `frontend/src/lib/futuresCandles.ts`, `futuresDepth.ts`, `directFuturesReference.ts`, `displaySnapshotCache.ts`, `useCfdTickers.ts`, `frontend/src/components/CfdChart.tsx`, and `workers/market-edge/`. Snapshot display age is separate from private execution freshness validation; sampled prices must not be interpreted as fresh executable quotes.

## Unresolved findings and next steps

1. **Performance/resource — CFD reload:** `scripts/qa-cfd-display-browser.cjs:56` reports another `/cfd/display/` request after hard reload on the first desktop context. Relevant runtime: `displaySnapshotCache.ts` hydration/persistence and `CfdChart.tsx` candle loading. Exact duplicated URL and whether the initial XAU request was cancelled during fallback-symbol selection are not captured by the existing report, so root cause remains **NOT VERIFIED**. Next step: record request URL/completion/cancellation and cache key/expiry (public data only), reproduce with deterministic unavailable-XAU coverage, then fix the proven lifecycle issue without weakening the reload assertion.
2. **Performance/resource — slow OPEN:** existing trace evidence is strong; the safe optimization has not been established. Benchmark the same persistence flow on a disposable database/branch and measure connection/JSON-write cost before changing topology or transaction behavior. Never shortcut authorization or idempotency.
3. **Performance/resource — historical revision storage:** `store.ts` creates immutable revisions; current-account compaction does not prune historical revision payloads. Storage concentration is proven, an active refresh leak is not. A retention/archive policy requires replay/audit requirements and restore verification; no cleanup was performed.
4. **Validation — full Jest baseline:** 28 failing suites / 126 failed tests remain. Resolve stale evaluators/path assumptions separately from actual behavior mismatches; preserve failed diagnostics and do not mass-update financial expectations.
5. **UI/UX:** production Home still showed a technical `bybit-edge`/refresh label. Existing PR #226 owns that removal; do not duplicate it. A desktop funding-label clip remains a minor visual observation. The audit makes no redesign.
6. **NOT VERIFIED:** long-duration leak/peak-load behavior, exact bloat, `pg_stat_statements` query ranking, full authenticated production network capture and every active funding scheduler path. Short samples and focused integration tests cannot establish these claims.

Recommendation: keep PR #231 in draft while the CFD CI failure remains unresolved. This report is evidence for follow-up work, not release authorization.
