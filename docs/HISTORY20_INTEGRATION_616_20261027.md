# History20 #616 / #553 current-main integration — 27 October 2026

Base: existing #553 4390eaf325a5fa4484d3068ec834d6fb725e333e plus current main 63d6b02cd38fe9ff52742c35ce46fa327827dd33. No replacement PR.

- Reconciled 11 textual conflict files and retained both the private SIMUSDT mode and main's countdown/opened-market restrictions, staged visibility, AITH read-lease handling and Spot request-id replay. The 20-scenario registry/model/library is retained.
- Fixed real integration defects: opened-state propagation through shared private/public history locks; actual UI-handler fixture now uses the real timer-capability policy; private model provenance stays visible without restoring the public labels removed on main.
- RED→GREEN: single/OCO idempotency replay could return a private committed order after admission was revoked. The private gate now runs before those reads/replays; ordinary venue retries still precede price availability reads. Both new negative tests failed before the fix and pass afterward. Transaction admission remains checked again under the existing financial lock. No new financial engine or schema.

## Verified locally (Node 22.23.3)

- Backend TypeScript and frontend TypeScript PASS; Vite production build PASS (existing chunk-size warning).
- Targeted original eight-suite run: 146 PASS / 2 FAIL; both were the extracted UI handler's missing real timer-policy dependency, fixed without removing assertions. Final changed-path rerun: 3 suites / 32 PASS (replay, original OrderService, UI publication gate). All other original seven suites had already passed. No skips used to obtain green.
- Real disposable PostgreSQL 18.4: 5 suites / 32 PASS, covering private admission, atomic/idempotent funding, restricted settlement/cold-registry cash-out, modeled Spot and Futures isolation. DB on owned loopback voltex_listing_test, stopped afterward. Initial missing-createdb and DIRECT_URL setup errors were resolved locally before tests; no production connection or data.
- Real Workerd: 26/26 PASS, including private/public registry separation, default-OFF and persisted preview/restart.
- Actual built UI in Chromium: 9/9 checks at 1440/390; Russian 20-card catalogue, one synthetic imported window, phase/model controls, saved Draft/reload, bounded previews and public-publish refusal. Zero page errors, outbound requests or financial writes. Evidence stays in ignored output/history20-616/browser.

## Not proved / release blockers

20/20 source metadata entries and deterministic model support are present. The owner archive VOLTEX_History20_Claude_20261018 was not found in project storage or Downloads; its twenty original file/source hashes were NOT reverified. Browser QA used the explicitly synthetic one-window fixture, never fabricated real market data. Public/commercial data rights remain unapproved. This is not activation or production readiness.

No main merge, deployment, production SQL, real account/balance/order change, external order or flag activation. Stocks frontend, Wallet Conversion, withdrawals and TYVN/ECLAVO configs are byte-unchanged from current main. Historical unrelated failures remain separate, not repaired here.

Code merge commit: `4730e0b60c06d01120f4a8c57ff2f9f9539f800c`. Preparation checkpoint: remote PR was `4390eaf325a5fa4484d3068ec834d6fb725e333e`. Before publication, existing authorized Cloudflare Pages settings were read: production branch main, production_deployments_enabled=false, preview_deployment_setting=none. Both previously owner-approved Render workspaces have no service on this branch and previews off. Repository deployment jobs require other refs/explicit deploy markers or manual confirmation. No provider setting or OAuth scope changed. Publication is a fast-forward of this existing branch with an exact-SHA lease; final exact-head CI must be verified separately.

## Concurrent main reconciliation

Preserved main `521f24196a64b3faae5f3dfc1ce1b9653cea39de`, including the P0 demo-withdrawal fence and CFD/release-identity changes. Four legacy private-test assertions expected the old asset-specific message from requestUnheldWithdrawal; main now unconditionally refuses every unheld request first. They now assert both exact `DEMO_FUNDS_NOT_WITHDRAWABLE` code and exact message; held-asset restrictions and all no-mutation checks remain. Withdrawal runtime is byte-identical to current main. Initial reconciliation: 139 PASS / 4 FAIL; exact-contract rerun: **10 suites / 143 PASS**, PostgreSQL18.4 stopped afterward. Additional overlapping frontend/admin regressions: **6 suites / 134 PASS**. Backend TypeScript on current main PASS. Previous UI/Workerd evidence remains scoped as above, not a claim of twenty source archives or production activation.

## Exact-head CI follow-up

Full frontend on 7f76214f: 4905 PASS / 1 FAIL (297 suites), no skipped checks. The sole failure was the inherited timer test expecting the old literal `historicalMode` button condition; private History20 correctly uses `(historicalMode && !privateMode)` and keeps the timer guard. Updated only the exact source assertion and added exhaustive evaluation of the real JSX guard for all32 combinations; unsupported timer/busy/unsaved always block, public historical always blocks. Actual handlers remain covered. Targeted two suites: 10/10 PASS. A first local command also named a nonexistent optional timer suite (ENOENT), corrected without any skipped test or product change; raw outputs retained. No runtime, workflow, financial or timer setting changed.

## Main P0 sale fence advanced during CI

After all34 workflows passed on4e892155 (full frontend4907/4907, no skips), main advanced to4ac8a45eeeb19ed6cd4677021d677134c438674f (#612/#625). Preserved its default-OFF synthetic USDT sale fence and DemoBalance-only settlement. Reconciled only OrderService conflicts and existing handoff histories: History20 separately admitted SIMUSDT stays in its non-withdrawable Balance unit; all other model assets retain main625 policy. Transaction admission, serializable debit/credit and idempotency stay. Two PG cases proved naive ledger mixing RED, then GREEN. Combined current-main financial regressions:13 suites/173 PASS on owned PG18.4 (listing + NRX fixture DBs), backendTS PASS. Cold-registry tests additionally run with global demo settlement ON so that switch cannot mask a private-gate bypass. This supersedes earlier notes claiming NRX legacy sale proceeds remain unchanged; no NRX price/history/runtime phase was edited.

Current-main CI identified one additional inherited legacy expectation: legacySimulationSaleEquivalence still required a synthetic NRX fill to mint real Spot USDT. Main625 explicitly forbids that behavior. Updated only this PG contract test to require exact refusal, no orders/trades/audit rows, unchanged NRX/real USDT and no DemoBalance write while OFF; canonical display price assertion is retained. All six legacy PG cases PASS. Historical expected mint is documented, not restored or hidden; no test skips/workflow waivers/runtime changes. CI failure on f444ea54 (284 PASS / 1 FAIL) remains visible.
