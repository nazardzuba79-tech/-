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
