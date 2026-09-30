# API rejection and navigation lifecycle audit

Review only. No merge, production deployment, real order, balance adjustment or database mutation was performed.

## Source and remote reconciliation

- Fresh main: `f62d28da893ca3feef73fe344ebb317ee69f32e8` (PR #352).
- Existing review PR #354: `codex/infra-review-20260930`, starting head `976206c7810625590e1211e76a9c1c021fea6d9d`.
- This audit extends that one review PR and preserves its Futures/Spot/Balances containment, feed recovery and CFD cleanup changes.
- Implementation: `c72fb6f5` (full SHA in the handoff). Claude's separate open #353, head `07d9b6386a158eb69e0e0ddd2515550863718954`, is untouched.
- Render production `/health` returned `status: ok`, main SHA above. Read-only Render deployment inspection identified live deployment `dep-daudfjff3r2c73epv9qg` at the same SHA.
- GitHub's Cloudflare Pages check for main succeeded, deployment `1f5a0049-1d94-4edb-9d0f-7b7843bfd36b`. Direct Cloudflare deployment API inspection was unavailable because local OAuth returned 401; this is not independent proof of the current custom-domain artifact.
- Existing PR checks were green before modification; final-head CI is reported on the PR, not inferred from that earlier head.

## Confirmed backend defects

Express 4 does not forward a rejected Promise from a raw async callback. Under Node's strict unhandled-rejection mode, failures in the remaining account/auth, wallet/portfolio, market ticker/candles/trades, CFD/demo, deposits/withdrawals, products/referral/card, KYC and admin handlers could terminate the process before sending an HTTP response. Shared admin/API-key authorization and KYC edge authentication had the same gap.

The child-process regression fixture mounts the real route and authentication code, injects failing database/services, denies external fetches and uses synthetic credentials. All **60 scenarios failed against the unchanged starting PR head**, each with the injected dependency failure terminating the child. After the fix all return one generic HTTP 500, forward the error once, and successfully answer a subsequent `/health` request in the same process. No live credentials/database are used.

The existing `asyncRoute` boundary now covers 58 additional route callbacks and the shared middleware. Returning its caught Promise preserves callers that await middleware. AST comparison verified identical bodies for all **108 async functions across the 22 changed route files**; no trading/accounting formula, validation or write sequence was rewritten.

The regression inventory scans all **40 route modules / 208 HTTP registrations**. Remaining raw awaits are inside catches, or four documented settled aggregates: global market, Copy marketplace, deposit chains and configuration version. Listings already catch service failures; their shared admin gate is now protected. The inventory test is a structural guard, not proof of every possible dependency failure in every endpoint.

## Confirmed navigation defects

| Owner | Reproduction | Fix |
| --- | --- | --- |
| Futures account store | Last subscriber leaves while balances/orders/positions/history GET is pending; old answer can survive navigation | Abort only unowned resource reads; identity/session guards protect remount; retain last-good values |
| Spot market store | Last subscriber leaves while snapshot is pending | Release the snapshot consumer and ignore late results; other subscribers keep their shared read |
| CFD tickers | Unmount with snapshot pending | Forward lifecycle AbortSignal and cancel on unmount |
| Copy marketplace | Last unsubscribe leaves a request/deadline alive; queued session refresh can fire with no consumer | Cancel request/deadline and guard late refreshes; same-turn StrictMode remount still shares its pending prefetch |
| Wallet visible reads | Unmount ignores a pending loader | Pass and abort the read's signal through existing overview/performance/native-wallet APIs |
| Admin Users | Users, recent deposit badges and activity remain pending after exit | Abort owned reads and activity deadline; ignore obsolete answers |
| Admin Listings | Leaving the list keeps its GET alive | Combine caller cancellation with existing deadline; ignore old answers |
| Admin Deposits | A poll resolves after unmount and `.then(schedule)` starts another minute timer | Disposed scheduler cannot restart; cancel queue/client-directory reads and discard late scan-trigger reloads |
| Admin alert cursor | Disabling/unmounting alerts leaves a cursor GET pending | Forward the existing visible-read cancellation signal |

All new cases were run failing before their corresponding fixes. Mounted React/JSDOM fixtures exercise navigation cleanup; no production financial actions were used. Existing polling intervals, account mutation paths and shared-stream ownership remain in place. Browser cancellation releases client ownership; it cannot undo a database query already executing on the server. Deposit watcher POST execution is deliberately not treated as a cancellable financial read.

## Local validation

- Backend TypeScript build: PASS.
- Frontend TypeScript project build + Vite production build: PASS. Existing >500 kB chunk warning remains.
- All API route and middleware tests: **619 PASS**, **6 skipped** (database-gated suites without a disposable PostgreSQL URL), **0 FAIL**.
- Full frontend run after build: 2,895 PASS / 12 FAIL / 0 skipped. Two affected source assertions were updated for the new AbortSignal arguments; both suites reran **22 PASS / 0 FAIL**. Result by unique final assertions: **2,897 PASS / 10 existing Windows failures**, with no newly failing assertion.
- The ten Windows failures were reproduced on the unchanged PR head in seven suites: sharedHeaderStylesheetOwnership (4), supportForm, registerWalletTailwindOwnership, marketUniverseScale, homepageTailwindUtilities, noProviderBranding, plainLanguage. They rely on slash-sensitive source-path allowlists. No unrelated production code or guardrails were weakened to hide them. The complete Linux CI remains required.
- Combined unique local result: **3,516 passing assertions**, 10 baseline Windows failures, 6 DB-gated skips.
- `git diff --check`: PASS.

## Limits

No live database outage, process crash injection in production, load/soak test, or new full authenticated browser walkthrough was performed. The new navigation regressions use synthetic mounted components/stores; existing PR browser evidence remains separate. Never-settling external dependencies are not given a new universal server timeout by this patch. Production Cloudflare custom-domain SHA is not independently confirmed. Review final-head CI and disposable-database checks before any separately authorized release.

## Reproduce

```text
node node_modules/typescript/bin/tsc
node node_modules/jest/bin/jest.js src/api/routes/__tests__ src/api/middleware/__tests__ --runInBand
cd frontend
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
cd ..
node node_modules/jest/bin/jest.js frontend/src --runInBand
```

The `server-idle` CI includes the new strict child-process matrix and API inventory guard. The full frontend CI includes every new lifecycle test without a waiver.
