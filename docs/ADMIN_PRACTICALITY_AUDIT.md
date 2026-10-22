# Admin practicality audit — 2026-10-03

Baseline: `main` `7d9ee6fc6bfe76badaac680313e9728e5abd3550`. This document distinguishes code inspection from executed verification. No production requests, mutations, database access, deployment, or migration are needed for this audit.

## Scope and concurrent work

- PR #399 owns public header/navigation; no header changes in this work.
- PR #400 owns remembered sessions, authentication and session revocation. Preserve the existing login and test-password mechanism, including `AdminPasswordVault` and the password column.
- PR #401 owns the listings audit and its time conversion, publication receipt recovery and filters. Findings below describe the baseline; do not copy or overwrite that PR.
- Evidence and benchmarks must use local fixtures or disposable loopback PostgreSQL. A successful fixture test is not proof of production state.

## Mounted routes and actual entry points

`frontend/src/App.tsx` mounts one `AdminLayout` at `/admin`. Its index redirects to `/admin/users`; there is no mandatory overview. The children are:

| Route | Mounted component | Actual entry point / detail |
| --- | --- | --- |
| `/admin/users` | `AdminUsersPage` | Sidebar; search, queues and user list |
| `/admin/users/:id` | `AdminUserDetailPage` | User list; no separate sidebar item |
| `/admin/deposits` | `AdminDepositsPage` | Sidebar; package/transfer queue; `#unattributed` and `#copies` deep links |
| `/admin/withdrawals` | `AdminWithdrawalsPage` | Sidebar |
| `/admin/wallets` | `AdminWalletsPage` | Sidebar; `AdminDepositCatalogue` when `VITE_MANUAL_DEPOSIT_CATALOGUE=true`, otherwise `LegacyAdminWalletsPage` |
| `/admin/kyc` | `AdminKycPage` | Sidebar; `KycSubmissionReview` is a child, not a route |
| `/admin/otc` | `AdminOtcCashPage` | Sidebar; reuses `CashList` / `CashDetailPanel`; detail is local state, not a separate route |
| `/admin/listings` | `AdminListingsPage` | Sidebar; `ListingScenarioLab` is mounted inside this screen, not its own route |
| `/admin/audit-log` | `AdminAuditLogPage` | Mounted but absent from the baseline sidebar |

`AdminOverviewPage.tsx` is absent, and tests explicitly preserve its removal. There are no mounted admin settings, report, access-management or notification-management pages. `AdminPagination`, `AdminStatCard`, `AdminPrimitives`, `DeleteUserDialog`, `CreditDepositDrawer`, `DepositCopyBell` and `DepositCopiesSection` are used helpers, not missing standalone routes. The legacy wallet variant remains a live build-time fallback, not dead code.

`AdminLayout` gates all privileged children using `useAdminGate`. Pending/error checks show a retry screen; denied access redirects home. Privileged routes are also server-authorized. Notifications use `useAdminAlertSound`, `useAdminAlerts`, and `adminUserActivity`, not a separate screen.

## Scenario → route → read/write → defect → risk → fix → check

Findings marked **inspection** still require red/green execution before being called fixed. Separate workstreams add their execution evidence below or in the final QA report.

| Scenario | Route / read-write boundary | Baseline defect or preserved behavior | Risk | Scoped change / verification |
| --- | --- | --- | --- | --- |
| First admin visit | `/admin` → `/admin/users`; gate read | Correct direct landing; no extra overview needed | Adding an overview adds a step | Keep redirect; gate tests for pending/401/403/error |
| Find/open users | GET `/admin/users`; local 20-row pages | **Inspection:** backend returns all users and their related balance/session data before browser slicing | Work increases with entire customer set, misleading pagination | Add compatible bounded server search/sort/page reads, count distinct entities; isolated scale 40/1,000/10,000, query/bytes/DOM measurements |
| User detail switch / error | GET `/admin/users/:id` | **Inspection:** no request identity guard; eager histories capped at `take:100`; failed non-404 reload can leave prior data | Wrong user data under new ID, unexplained stale reads; first 100 mistaken for complete | Reproduce delayed A after B and failures; identity/session-bound reads; lazy paginated history without changing accounting |
| Balance correction | POST `/admin/users/:id/adjust-balance`, `/demo-topup`; block/unblock/delete separate | Existing admin mutation routes; full account/asset values and reason must stay explicit | Accidental correction or uncertain duplicate | Inspect existing transaction/audit/idempotency before changes; separate confirm UI; no direct DB adjustment |
| Deposit queues | GET `/admin/deposit-queue`; POST attribute/ignore/restore/check-tx | **Inspection:** independent 60-second refresh plus eager `getAllClients`; pre-read counts use `??0`; visibility uses global inactivity rule | Duplicate work; unknown appears empty; very large user dropdown | Shared summary freshness; avoid full user download; distinguish package count from transfer count and unavailable from zero |
| Deposit watcher | GET `/admin/deposit-watch`; POST `/run`, `/open`, `/settings` | Opening deposits may call the once-per-day Kyiv-hours `open` trigger; it is a guarded write, not a passive GET | A test opening the screen could start a production scan | Fixture all watcher calls; preserve server timing/cooldown guards; do not invoke production |
| Credit deposit package | GET `/admin/deposit-packages/preview`; POST `/confirm` | Preserved: preview belongs to user+chain+asset; minimum and evidence; preview token; original idempotency key; unknown response offers result check using the same key; changed package forces review | Duplicate/incorrect financial credit if simplified | Keep implementation and test double-click, lost reply after commit, changed package/revision, insufficient minimum; never invent a replacement key for an uncertain attempt |
| Address copied signal | `/admin/deposits#copies`; GET `/admin/deposit-address-copies`, review mutation | Preserved: cursor pages, session-cleared memory view, aborted replacement reads; copy is only a signal and does not credit | Treating a click as payment | Preserve separate signal language and link to transfer queue; verify copied/no-transfer state and session replacement |
| Address catalogue save | `/admin/wallets`; GET/PUT `/admin/deposit-catalogue` | **Inspection:** `save()` places successful PUT and following GET inside one catch; sets table to null before reread | Accepted save looks like failed save; operator may retry mutation without knowing current revision | Test PUT success + GET failure first; separate accepted write from stale read, keep last table and block edits until refresh; no write retry |
| Address catalogue search/confirm | Same catalogue route | Asset/name search, network cards, full address copy and revision exist; baseline modal does not explicitly contrast current/new address; clearing is immediate within the editor | Wrong rail edit, unclear impact | Improve confirmation separately with current/new/network and clear impact; preserve revision conflict and validation; no seed/private-key fields |
| Legacy address save | GET/PUT/DELETE `/admin/wallets/:chain` | Build-time fallback; confirmation covers affected asset rails. Save and following reload share catch too | False write-failure message after accepted write | Apply same explicit accepted/stale distinction in separate tested safe patch; do not remove fallback |
| Withdrawal reject cancellation | `/admin/withdrawals`; POST reject | **Inspection:** nullable prompt result is submitted unless explicitly guarded | Cancel can reject a withdrawal | Reproduce cancel/Escape/close with zero mutation; replace with clear confirmation, keep `balanceHeld` distinction |
| Withdrawal stages | GET `/admin/withdrawals` currently fixed `take:200`; approve/reject/processed mutations | Approval does not prove network send; TXID does not prove confirmations | Incorrect financial interpretation | Queue labels and next action from existing status; exact amount/asset/network/address confirmation; preserve reserved/unreserved server policy |
| KYC queue/read failure | `/admin/kyc`; existing client/submission/document reads and decisions | **Inspection:** initial empty array and silent catch can show no applications during failure | Missed reviews | Loading/error/empty/ready/stale states; protected document route, selected submission identity, zero actions before confirmed read |
| OTC queue → detail → Back | `/admin/otc`; GET list with server page/status; GET detail/messages | **Inspection:** conditional detail replaces/unmounts list; Back recreates page0/no filter | Operator loses queue location | Reproduce page/filter loss; preserve list view, pause hidden list reads, refresh same page on return; retain token-keyed desk reset |
| OTC action / uncertain result | POST `/admin/otc/:id/actions` and messages | Preserved: explicit status-dependent next actions, version, idempotency key stored as pending intent, consent/actual payout distinction, reserve rules | Duplicate message/action or premature release | Do not change action payload/accounting. Test unknown outcome keeps original intent; no automatic resend/release |
| Listings | `/admin/listings`; list/draft/preview/publish/revision routes | Preview and revision exist; scenario lab shares page. PR #401 already addresses time/unknown receipt/filter issues | Conflicting parallel fixes or accidental publication | Audit only in this branch until #401 reconciled. Keep publication distinct from trading start; no VTA/NRX simulation/execution changes |
| Audit history | GET `/admin/audit-log` | **Inspection:** mounted without sidebar; fixed last200 sorted only createdAt; client search only those rows; technical action code and JSON always visible | Older events are inaccessible and raw details dominate | Add visible nav, Russian summaries, collapsible redacted detail and bounded server search/date/action/user pagination; stable tie-break and no secret leakage tests |
| Access / session / notifications | `AdminLayout`, gate, shared read helpers | Gate exists; baseline label `Online` is constant; shell uses Operations/Administrator; activity/alerts hourly vs queue60s | False online/freshness implication, duplicated work | Russian neutral session label, visible Europe/Kyiv zone, shared summary status/timestamp; session-scoped volatile cache, no persisted private data |

## Existing safety mechanisms to preserve

- `CreditDepositDrawer.tsx` guards preview identity, uses an in-flight ref, sends the original preview token and deposit IDs, and retains the confirmation key for the visible drawer's unknown-result retry. `PACKAGE_CHANGED` / `ALREADY_CREDITED` trigger fresh review. Any broader recovery persistence must be separately reproduced and tested, not achieved by making new keys.
- `DepositCopiesSection.tsx` stores only its last view in memory, clears it on session change, supports cursor navigation and aborts replaced reads. Its explicit Kyiv formatting is already useful precedent.
- `AdminDepositsPage.tsx` coalesces in-flight reads, requests one follow-up after a mutation, aborts on unmount and stops its timer when globally inactive. Preserve coalescing/abort while replacing inconsistent freshness policy.
- `AdminDepositCatalogue` submits the catalogue revision; do not bypass stale-revision rejection. The legacy editor is guarded by a confirmation step covering rails affected by a shared-chain address.
- `AdminOtcCashPage` keys its desk by the session token. `cashRequest` has a 25-second timeout and verifies the token again after parsing. Actions keep the original pending intent and version on unknown results; message intent is also kept. No request replay was authorized.
- Existing admin APIs authorize on the server. The UI gate is an additional usability/privacy boundary, not authorization replacement.
- No password-column, vault, authentication or password-storage changes are part of this work.

## Dates and terminology

Baseline is inconsistent: `DepositCopiesSection` formats Kyiv explicitly; OTC `dateTime` formats UTC; deposits/audit often use browser-local `toLocaleString('ru-RU')`. Use one explicitly labeled `Europe/Kyiv` presentation for admin while preserving UTC storage and actual timestamps. Do not change public OTC formatting incidentally. Keep technical asset/network identifiers, TXID and IANA zone values exact.

## Verification and measurement harness

- `scripts/qa-admin-console.cjs`: serves the actual `frontend/dist` through local Express, uses synthetic users/deposits/withdrawals/wallets, and screenshots 1920/1440/1366/390. Supports `QA_FRONTEND_DIST` and `QA_PLAYWRIGHT_MODULE`. Its assertions/fixtures reflect older contracts; adapt rather than treating it as a complete audit.
- `scripts/qa-admin-gate.cjs`: built-bundle localhost fixture API, gate states including failure and request observation, denies outside network through Playwright routing; `QA_OUT` supports isolated evidence. Useful base for auth/error/offline tests, not a scale benchmark.
- `scripts/qa-browser-sleep-postgres.cjs`: existing disposable embedded PostgreSQL runner (`@embedded-postgres/windows-x64` / Linux equivalent and `pg`), binds loopback on a free port, initializes temp data, applies repo migrations and shuts down in `finally`. `BROWSER_SLEEP_QA_DEPS` points to the existing QA dependency package. Reuse this pattern with synthetic admin fixtures; do not use any production URL.
- `scripts/test-otc-cash-postgres.cjs` / isolated Prisma fixture helpers provide existing transactional OTC regression coverage; do not replace it with UI mocks.
- Save a baseline built bundle before product edits. Compare cold and warm opens separately with identical data and viewport, at least 30 repeats each for 40/1,000/10,000 users. Record median/p95 HTTP count/bytes/duration, SQL count/time, rendered rows and React render timing where instrumented. Browser fixtures alone cannot prove SQL performance; label unmeasured metrics explicitly.

## Execution ledger

Inventory entries above describe the baseline. Executed evidence is listed separately:

- `adminCatalogueOtcRecovery.test.ts`: baseline **3 failed / 3 passed**, proving that both accepted catalogue save/clear lose their table on failed reread, and OTC Back resets page/filter. After the narrow fixes **6/6 passed**. `otcPage.test.ts` existing coverage **4/4 passed**. Local logs: `output/admin-practicality/catalogue-otc-red.log` and `catalogue-otc-green.log`.
- Catalogue follow-up read failures now preserve the accepted-write message and last confirmed table, explicitly label it stale, and prevent further revision-dependent edits until a read succeeds. The test verifies refresh does not replay a write and the next save uses the refreshed revision. Failed writes stay in the editor.
- OTC list remains mounted in a hidden wrapper while its detail is open. The list skips reads when inactive and reloads the same filter/page on return; the session-token keyed parent still clears both list/detail when identity changes. Existing shared request timeout remains 25 seconds; the retained list does not introduce a new polling timer or mutation retry.
- `scripts/qa-admin-practicality.cjs` captured **32 baseline screenshots** (8 actual mounted screens × 1920/1440/1366/390) from the frozen baseline production bundle at `output/admin-practicality/before-dist`, with valid synthetic API contracts. **0 page errors**, **0 unmatched fixture endpoints**. Outside network is denied; the only attempted outside request was a Google Fonts stylesheet. The baseline detail page has document overflow at **390px**; other captured pages do not. Evidence: `output/admin-practicality/before/browser-results.json` and its PNGs.
- The baseline bundle selected the legacy wallet variant. The catalogue regression above is a real React component test; it is not a claim that the catalogue-enabled built browser variant has already been captured.

Remaining workstreams record candidate built-app screenshots, exact PR heads/CI and measured performance in their final QA reports. Nothing here claims production readiness or deployment.
