# Admin API compatibility audit — 2026-10-03

## Evidence and boundaries

Repository/frontend baseline: `d9b52648dc00e1b838bd08907381aebb77a0e25a` (fresh-fetched main). A public, unauthenticated read of `https://api.voltextech.net/health` returned HTTP 200 with `status: ok`, `commit: 7cb2ac057beb31d3e934f265e89f3345cdc8865d`, and `startedAt: 2026-10-02T18:02:31.000Z`. Thus the serving revision is established independently of the historical cutover note.

Support below means routes present and mounted in the source at that health-reported revision (`src/index.ts`, mounted under `/api/v1`). It does not claim successful authenticated production reads or healthy provider credentials. No production login, customer/DB read, SSH, mutation, infrastructure change, merge, or deployment was used. Current frontend means the checked-out main source; the investigation did not access an owner's authenticated browser session.

## Root cause and introduction history

The serving backend predates all seven additive read contracts. Each was introduced by `3baeaf2d7a2ebac84aa87d5152d047f3a49aec85` on 2026-10-03 at 13:28:06 +03:00:

- `/admin/users/page`
- `/admin/users/:id/profile`
- `/admin/users/:id/history`
- `/admin/withdrawals/page`
- `/admin/clients/page`
- `/admin/audit-log/page`
- `/admin/work-summary`

The first six are in `src/api/routes/adminPagedReads.ts`; summary is in `src/api/routes/adminDeposits.ts`. Frontend consumers were introduced by `3eca3e6cfbc013d2a24c3ddcf8a6c5daa224c9a2` on 2026-10-03 at 14:33:05 +03:00, principally `frontend/src/lib/adminPagedApi.ts` and `frontend/src/pages/admin/adminWorkSummary.ts`. These are later than the confirmed serving SHA.

An especially misleading failure: the old `GET /admin/users/:id` handler matches `/admin/users/page` with `id = "page"`. Its `404 { error: "User not found" }` describes that accidental lookup, not absence of the users collection or the account the operator intended to inspect. The former generic frontend HTTP-404 label therefore incorrectly presented an unavailable collection route as a missing record.

## Page contract matrix

All paths below are relative to `/api/v1`.

| PAGE | CURRENT FRONTEND ENDPOINT | LEGACY WORKING ENDPOINT | CURRENT BACKEND SUPPORT | RESULT / SAFE COMPATIBILITY |
|---|---|---|---|---|
| Users | `/admin/users/page` | `/admin/users` | New absent; legacy mounted | Fall back on new-route 404 only. Validate array and preserve server-returned identity, balances, last login, block state, and owner-authorized password fields. Apply email **or ID** search, status, stable sort and display pagination locally. Old server search accepts email only, so forwarding an ID search would incorrectly discard the matching user. |
| User detail | `/admin/users/:id/profile`, lazy `/:id/history?kind=…` | `/admin/users` / `/admin/clients` for compact identity; `/admin/users/:id` for explicit balance/history reads; `/admin/audit-log?userId=…` for audit | New absent; legacy mounted | Do not eagerly fetch the old combined history response for the overview. Missing optional route is not account-not-found. Legacy combined response contains no Futures orders, Futures positions or CFD positions: those remain explicitly unavailable, never fabricated as empty. |
| Deposits | `/admin/deposit-queue`; lazy client search `/admin/clients/page`; existing watcher/TXID/package/copy routes | Same queue and operation routes; `/admin/clients` for lookup | Queue/operation routes mounted; new client page absent | Replace only lazy lookup read via validated legacy clients. Preserve scan-open, minimum, package preview/token, attribution, ignore/restore, credit and copy-review contracts. Do not start whole-client reads on initial deposit-page mount. |
| Withdrawals | `/admin/withdrawals/page` | `/admin/withdrawals` | New absent; legacy mounted, latest **200** rows | Local filtering/paging is possible, but 200 returned rows means completeness is unknown. Show loaded-window counts and partial-result notice, including filtered-empty views. Existing approve/reject/mark-sent writes are unchanged. |
| KYC | `/admin/clients/page`, `/kyc/admin/delivery`, existing document/review routes | `/admin/clients`; delivery/document/review unchanged | New page absent; legacy routes mounted | Legacy list is complete users with latest KYC. Local search/filter/date/pagination can preserve latest-submission semantics. No document prefetch; retain existing authentication and review operations. |
| OTC | `/admin/otc?page=…&status=…`, `/:id`, `/:id/messages`, command receipts | Same endpoints | Mounted at serving SHA | No read-contract migration identified. Keep owned reserve/accounting and explicit action confirmation untouched. Runtime feature flags/provider health were not inspected. |
| Listings | `/admin/listings`, `/:id/preview` | Same endpoints | Mounted at serving SHA; store integration required | No paged-route mismatch. Backend can independently return `LISTINGS_UNAVAILABLE` (503) for store failures; do not mask as a missing user or fall back to fabricated rows. Publish/draft semantics remain unchanged. |
| Audit Log | `/admin/audit-log/page` | `/admin/audit-log?action=…&userId=…` | New absent; legacy mounted, latest **200** rows after supported filters | Preserve server user/action filters before local search/date/paging; mark cap uncertainty. Never claim complete history or global totals from the loaded window. Redact sensitive metadata in the frontend presentation; old feed does not perform new route's recursive redaction. |
| Deposit addresses | `/admin/wallets` | Same endpoint | Mounted at serving SHA | No route migration. Returned public-address rows can continue to render. Keep treasury/catalogue save/reset confirmation, API permissions and current write contracts. |
| Optional sidebar/KPIs | `/admin/work-summary` | No equivalent complete combined contract; `/admin/alerts-summary` is only notification cursors | Summary absent; legacy cursor mounted | Summary cannot gate pages. Unknown widgets use `—`; Users-derived KPI counts may use an actually complete Users response. Never reinterpret package/transfer/request counts as a unique count of users needing attention. |

## Verified legacy limits and normalization

`src/api/routes/adminUsers.ts` at serving SHA returns an uncapped USER-role list, with global balance/session aggregation. Its optional password is populated only under the existing owner check. Preserve `null` when not returned; do not reconstruct or obtain it elsewhere. The compact list exposes Spot balances but not demo balances. An unavailable or not-yet-requested balance set is `null`/unknown, not an empty ledger.

The old detail endpoint returns at most **100** each of deposits, withdrawals, Spot orders and purchases, plus all KYC submissions and Spot/demo balances. Exactly 100 means possible truncation. It cannot provide server counts or lazy per-history reads; defer this combined request until the operator explicitly opens the balances/history section and describe loaded-window limitations. Audit history can use its existing user-filtered endpoint. Keep unsupported Futures/CFD sections selectable with an honest unavailable message, rather than show "no records".

Legacy users/detail date fields are ordinary JSON strings. Decimal amounts arrive as strings and must remain strings; compatibility must not recalculate balances. The clients list scans users and KYC submissions and selects latest KYC. The legacy performance cost remains a limitation of this serving backend: frontend fallback cannot create server pagination or indexes.

Fallback must be restricted to 404 for an additive endpoint. Do not fall back on 401, 403, timeout, network failure, malformed success, or 5xx. Validate normalized data before caching/rendering; scope in-memory capability/data state to the session and clear on logout/change. Distinguish `USER_NOT_FOUND`, `ENDPOINT_NOT_AVAILABLE`, `NETWORK_ERROR`, `SESSION_EXPIRED`, `FORBIDDEN`, and `SERVER_ERROR`. A user is missing only after a trustworthy legacy lookup, not after a new optional-route 404.

## Financial capability limitation — no unsafe downgrade

The new idempotent balance-adjustment POST and receipt GET in `src/api/routes/adminBalanceAdjustments.ts` were introduced by `d744097fa5def3f4dedc9eb853fd9bd9455b3b47` on 2026-10-03 at 13:28:54 +03:00, after the serving revision. The old `/:id/adjust-balance` write does not offer that receipt/idempotency contract. The task forbids changing adjustment/write accounting, so compatibility must **not** redirect this operation to the old write. Show it unavailable when the legacy read mode has established the older capability set; restoring execution requires a separately authorized backend alignment. Block/unblock, demo top-up, withdrawal review, KYC review, deletion and deposit operations already have serving-source routes; their policy and actual production results were not tested by this audit.

## Legacy introduction references

| Contract | Introduction commit |
|---|---|
| Users / combined detail | `b6b60c3d3608656774fddc71eee512a109b7990b` (2026-08-23) |
| Clients / KYC list | `81a64f80470480edf33295f181f25b1b274c6ff2` (2026-08-21) |
| Withdrawals | `46d020e8aa63264ced93bc36250896615599a8e1` (2026-08-23) |
| Audit feed | `b428c9ba195fcd756fe2453d075c4b63374b8e0f` (2026-08-23) |
| Deposit queue/packages | `8861e219d730ee1264d506dfb73f2165415b5695` (2026-09-26) |
| Treasury addresses | `2ab98680e52a6e592d9e68dde5639cf3f83a0180` (2026-08-23) |
| Admin Listings | `8896d5eb5beb2da9fc633deeed8616f29ec0b1f9` (2026-09-29) |
| OTC cash routes | `90833fdfcd70f15e36288db70f3d908f76e75e52` (2026-10-01) |

## Verification boundary

The missing-route root cause is confirmed by public deployment identity plus source at that identity, not by guessing from the cutover date. Authenticated production endpoint behavior, production balances/documents/customer counts, provider/store configuration, actual mutations and backend release were intentionally not exercised. Branch tests must use synthetic fixture shapes matching both revisions and must retain failure/cap/unavailable scenarios; separate browser QA should report its actual results rather than imply production-account validation.

## Implemented review candidate

- Read-only 404 adapters preserve the new UI while normalizing existing legacy Users, Clients, profile/balance/history, withdrawal and audit contracts. Auth, network, malformed-success and server failures never downgrade into fallback. A session-scoped cache remembers only missing capabilities, never customer data.
- Users now has three compact KPIs (total users, new in 24h, pending KYC), one filter row, exact balance strings, honest account state and retained Open/context actions. The large six-card queue dashboard was removed; sidebar and all nine page routes remain.
- A missing optional work-summary route stops further timer/focus/mutation retries for that mounted session. Legacy Users supplies only the three statistics derivable from its complete list; missing financial queue counts stay unavailable.
- Profiles fetch histories and aggregate legacy balances only when their tab opens. Caps of 100/200 are disclosed; unavailable Futures/CFD histories stay unavailable. No fallback to the old non-receipted balance-adjustment write was introduced.
- Successful financial read responses are validated before rendering. Decimal strings, including Prisma scientific notation, are preserved without Number conversion. Unknown account state is never presented as Active.
- Tests first reproduced missing-route failure, summary polling, malformed financial data, wrong-account/session races, partial-history labeling and unavailable adjustments. Browser evidence is documented separately. Five existing source-policy tests now normalize Windows paths without widening any allowlist; deposit-copy tests assert the retained sidebar/shared-summary contract instead of the removed cards.

## Scope boundary

The backend, database schema, shared write API, account permissions, deposit watcher/crediting, matching, financial math and infrastructure are unchanged. All browser evidence uses synthetic local fixtures and blocks external requests. The only production read was the public health response identifying the serving revision. This candidate requires review: no merge or deployment is authorized by this task.

## Final local validation

- Full frontend regression: 218/218 suites passed; 3,787 passed, 6 pre-existing skipped (3,793 total). Evidence: `output/admin-api-compatibility/full-frontend-final.log`.
- Relevant mocked backend Admin contracts: 13/13 suites, 128/128 tests passed. No production database was used.
- Frontend TypeScript, backend TypeScript/build, and production frontend builds passed. Existing large-chunk advisory remains.
- Final compatibility suite includes 55 tests, with actual Prisma Decimal small/large scientific serialization preserved byte-for-byte and malformed/non-finite values rejected.
- Browser: modern/legacy 404 contract, nine routes, six widths; 121 scenarios / 108 candidate screenshots. CI-flag build with manual catalogue enabled additionally passed existing 32 screenshots and 18 workflow interactions. See browser QA document for final guard reruns and precise boundaries.
- Final fresh-fetch advanced main to `da1e35e31b5a7cecf70829aabea6d858f43fd28e` (PR #412, isolated Spot ticker width fix). The draft branch is reconciled onto that main; original before screenshots remain the requested `d9b52648` baseline. Backend source, Prisma schema and shared API write client have no diff.
