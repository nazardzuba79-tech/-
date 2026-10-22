# OTC crypto → cash: review and operator handoff

Review-only implementation, 2026-10-01. **No production access, migration, reserve,
payment, merge into main or deployment was performed.** The owner explicitly
approved fixing the shared-wallet prerequisites after the initial blocker report.

Implementation commit: `90833fdf`; integrated current main:
`b80d6d6c51c2729f43f080e44569a11c61b91ed1` (integration commit `33e407e0`).
Final PR head is the commit containing this document and fixture evidence.

## Scope and entry points

- `/otc`: one crypto-to-physical-cash product, existing 10,000 / 50,000 / 100,000
  USD tiers; no reverse exchange or card payout. The ordinary deposit minimum
  remains a separate policy. Real balances only; no demo/simulation equity.
- `/admin/otc`: paginated requests, versioned offers, private messages, pickup
  instructions, cancellation review, begin-payout and completion receipt.
- `src/otc/OtcCashService.ts`, `policy.ts`, `reserveCoverage.ts`,
  `confirmedTransaction.ts`, `src/api/routes/otcCash.ts`: authoritative service.
- Additive migration `20261001000000_otc_cash_requests`: request, owned reserve,
  offer history, commands, private messages, ledger; existing Balance remains
  the wallet. Restrict foreign keys prevent deletion of financial history.
- Shared prerequisites: `WalletMutation`, `WalletTransferService`,
  `SpotBookTransaction`; guarded writes in Withdrawal/Purchase/Adjustment,
  Futures and CFD services. No change to leverage tiers, matching algorithm,
  P&L/margin/liquidation/funding formulas or external pricing providers.
- Client: `pages/otc/*`, `AdminOtcCashPage`, account-scoped balance invalidation
  consumed by Wallet/Spot form/AssetsPanel. The existing API request function is
  exported, not rewritten. Only the outdated OTC FAQ answer changes; all 14
  FAQ intents and ordinary email support remain.

## Money and concurrency

For available A, aggregate locked L and request-owned reserve Q:

| Action | Available | Locked | Owned reserve |
|---|---|---|---|
| Create | A − Q | L + Q | HELD |
| Cancel/reject before pickup | A + Q | L − Q | RELEASED |
| Confirm desk cancellation after pickup | A + Q | L − Q | RELEASED |
| Complete actual cash payout | A unchanged | L − Q | CONSUMED |

Quantity is an exact decimal string, validated against asset precision and
numeric bounds. Conditional atomic Balance updates prevent negative admission
and lost read-modify-write updates. A uniquely owned reservation is claimed once
inside the same transaction as the balance delta, state, ledger and audit.
Other users/assets/reserves are not returned or consumed.

Create serializes per user. Fresh User/Session locks reject revoked sessions,
blocked users, non-USER roles and missing KYC/customer approval; admin actions
also lock the target user's eligibility before the request. Existing held Spot,
OCO, withdrawal and OTC obligations must reconcile exactly to the wallet. Legacy
missing funds, orphan OCO or stale maker quantities fail closed, without repair.

The original `(userId, idempotencyKey)` is persisted before the browser sends a
create. Same key and payload returns the original result; different payload
conflicts. Commands additionally require the expected version. Lost replies
remain “result being checked”; no new key or automatic financial retry.
Post-transaction `pg_xact_status` verifies COMMIT, including a deferred constraint
rollback or lost acknowledgement. Unknown outcomes retain the original key.

Spot order/OCO/trigger/cancel operations use a transaction-local book loaded from
canonical active DB rows and checked against persisted fills. A PostgreSQL
advisory lock orders Spot mutations, and a per-engine queue orders publication.
Only confirmed committed state is published to that process's engine. Rollback
leaves its live book unchanged; an unknown COMMIT halts that engine. The next
operation rebuilds from the DB, not a stale in-memory maker. This is not a new
distributed market-data broadcast system; deployment must not mix old writers
with these writers. Existing admission math is preserved.

No transaction/connection remains open while support or a customer waits. Price
lookup happens outside the create transaction; existing deposit USD valuation
and freshness policy is checked again before the debit and before commit. Its
stable-asset valuation policy is not a promised physical-cash exchange rate.

## Consent, pickup and privacy

`RESERVED → OFFERED → ACCEPTED → PICKUP_READY → PAYOUT_IN_PROGRESS → COMPLETED`.
Cancellation/rejection are guarded alternative terminal paths. Offer versions
show crypto quantity, fiat rate, gross, fee, net, expiry and explicit acceptance.
Cash fee is deducted from net cash, never silently added to the crypto debit.

Before pickup, cancel returns Q. After pickup, cancel only records intent and
blocks begin-payout; operator confirmation that the desk cancelled is required
to release Q. After payout begins, ambiguous physical results keep the reserve
for manual reconciliation: no automatic refund or second payout. Completion
records the actual unique operator reference; address/message alone never settles.

Private addresses are append-only messages, not public city data or list fields.
Only the owner and a currently authorized admin can read them. No address in
URL, localStorage, public logs, bundle, email or Telegram. Session-keyed React
subtrees and request ownership checks discard old-account in-flight responses.
Messages are plain text, length-limited and idempotent, with explicit refresh;
there is no fictional online indicator, cron, socket, LLM or chat polling.

## Geography and attribution

All **108** existing country codes remain. IDs, country membership and IANA time
zones come from [GeoNames](https://www.geonames.org/); data is adapted under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
[Dataset fields and attribution](https://download.geonames.org/export/dump/readme.txt).

Prepared 2026-10-01T12:05:34.799Z by `scripts/prepare-otc-geography.cjs`:

- `cities500.zip` SHA256 `4ba815404241c08ca40a5dcdcfe35dee4ae51bb848bfff2c01d8ad35507ae232`.
- `alternateNamesV2.zip` SHA256 `e10545b77cbbfa44f9961ff337cd391f731e26c26b50b43862d865f65aaab177`.
- Two identical compact output copies are used by server and lazy OTC frontend;
  there is no runtime geocoder or country/city API call.
- Russian labels exclude historical/colloquial aliases. Exact current city
  names take priority, then population breaks same-name ties (including the
  verified Phoenix, Arizona ID `5308655`, not Phoenix, Illinois/Phenix City).
- RU/KZ/UA/BY/CH contain the requested five-city sets. Other countries normally
  contain five distinct places, not an asserted strict population ranking.
- Explicit conservative exceptions: SG/MC/HK/SC one principal city; BN four;
  KW three cities rather than inventing five independent cities from districts.
  Small states such as LI/AD/MT include municipalities/settlements. These are UX
  geography entries, **not cash desks, a partner network or legal approval**.

## Load measurements (fixtures, not production)

Browser production bundle, Chromium, 320/390/768/1440 px: country/city/amount
edits **0 OTC requests**; one simulated idle day **0 OTC requests**. No external
connections permitted. Existing Nav/auth/admin-shell reads are separately
visible in `docs/qa/otc-cash/result.json`; OTC adds no timers/polling. Manual
refresh and own completed mutations are the only refresh triggers. Cross-tab
balance invalidation uses an account-ID revision event, not periodic reads.

Actual Express auth + disposable PostgreSQL counters per **one HTTP request**:

| Operation | SQL statements, including auth and transaction control |
|---|---:|
| Common auth alone, fresh session | 1 |
| Request list | 6 |
| Create USDT request, no other holds | 23 |
| Same-key create replay | 11 |
| Send message | 12 |
| Cancel before pickup | 19 |
| Admin complete | 20 |
| Request detail | 8 |
| Read messages | 7 |
| Balances | 6 |

These are measured SQL statements, **not claimed row counts or a production
performance benchmark**. Common auth may also update lastSeenAt on an old
session under its existing policy. Config requires zero DB calls. Sending text
does not wake unrelated background sweeps; financial transitions keep the
existing background-work notification. Bounded pages: 25; max active requests:
3; message length: 3000; offer history: 20.

## Validation

- Backend TypeScript/build and frontend TypeScript/production build: PASS on
  integrated main. Existing Vite >500 kB chunk warning remains.
- Real PostgreSQL 18.4: **20 wallet safety + 23 OTC scenario groups PASS**,
  including competing real withdrawal/order/transfer/Banking/Futures/CFD paths,
  legacy reserve checks, rollback, deferred COMMIT, lost acknowledgement,
  idempotency, IDOR, session revocation, account deletion and read-only audit.
- Existing PostgreSQL Futures book lock, NRX Spot and Banking referral suites:
  **38/38 PASS, 0 skipped**. The 17 Futures/13 Banking tests skipped in ordinary
  no-DB unit selections were separately executed here, not called unit PASS.
- Financial/matching/OTC selection plus mounted OTC interactions: **528 PASS,
  6 FAIL, 17 DB-skipped**. The six CFD expectations are independently reproduced
  on untouched `bce26f50`: credit-budget/batch count, unavailable vs stale vs
  entitlement, and Gold Spot naming. Runtime provider code is unchanged; this
  PR does not weaken those assertions or claim the entire gate green.
- Deposit/provider/copy-address/admin-credit/Banking selection: **208 PASS,
  0 FAIL, 13 DB-skipped** (executed separately above).
- Full frontend on integrated main: **3382 PASS / 16 FAIL / 0 skipped**, 193
  suites. Fourteen failures reproduce on Windows/CRLF-equivalent `bce26f50`;
  the two new Academy reading-style failures reproduce on untouched `b80d6d6c`.
  Failures are path-separator, raw-CRLF substring/regex and SVG byte-hash checks.
  No blanket baseline waiver or unrelated code change was added. The existing
  Linux full-frontend workflow remains authoritative for PR CI.
- Fixture-only browser: four widths; client confirmation, private long text,
  admin controls, keyboard consent, sleep/wake guard, input contrast, long
  button fit and no horizontal overflow PASS. Fixed unrelated chrome is hidden
  only during tall component screenshots, not during interactions/assertions.
- Final small scoped button-height correction was followed by a fresh build
  and browser run; it does not change any financial/data logic.
- An overbroad combined backend test invocation exceeded its execution budget;
  it is not counted as a pass. Required selections above completed separately.

Test environment did not load production `.env`, tokens or database URLs.
Disposable clusters bind only `127.0.0.1` and are stopped in `finally`.
No production audit was executed. Physical cash operations, real mobile Safari,
Firefox, real desks and real-time 24-hour soak are **not tested/claimed**.

### Reproduce safely

`npm ci --ignore-scripts` in repo and frontend, then:

```text
node scripts/verify-review.cjs build
node scripts/verify-review.cjs test frontend/src
node scripts/diagnose-otc-balance-safety.cjs --verify
node scripts/diagnose-otc-balance-safety.cjs --otc
node scripts/diagnose-otc-balance-safety.cjs --preservation
```

The disposable parent requires `pg@8.23.0` and the platform's
`@embedded-postgres/{windows-x64,linux-x64}@18.4.0-beta.17` installed under
`node_modules/.cache/deposit-qa`. Browser QA requires a built frontend and
Playwright; `QA_PLAYWRIGHT_MODULE` can point at its isolated installation.
The new `otc-cash-review.yml` runs these gates without secrets or deployment.
It checks out the exact PR head, asserts `.cache` is absent after clean installs,
and verifies that `verify-review` creates its isolated client without a warm cache.
Runner failure/stale-artifact regressions use `node --test scripts/test-otc-review-runners.cjs`.
Each CI attempt gets a new temporary evidence directory with checkout SHA/run ID,
step outcomes, full stdout/stderr logs, Jest JSON and browser artifacts generated
in that run only. Failed/skipped steps remain failed/skipped; the always-upload
step never copies the checked-in historical `docs/qa/otc-cash/` reports.
The original `--baseline` diagnostic is historical evidence at `88d77ea`, not a
passing current test; do not run that old scenario against the new writers.

## Release prerequisites and rollback — NOT authorization to execute

**Mandatory shared-wallet release procedure:**
[OTC_SHARED_WALLET_CUTOVER.md](OTC_SHARED_WALLET_CUTOVER.md).
Its gates apply before ANY new financial writer starts, even with OTC disabled.
The actual current-main/PR PostgreSQL test reproduces stale writes during overlap;
ordinary Render auto-deploy/maintenance UI does not provide a writer fence.

1. Owner reviews this PR, concurrent wallet changes, CI and outstanding base
   failures. Separate explicit merge/deploy approval remains required.
2. Confirm a real desk, settlement process, fiat precision and jurisdictional
   requirements; approve customers under an actual AML policy. Defaults remain
   **enabled:false, routes:[], approvedUserIds:[]**. A city dropdown never enables
   reserves. Directions/approvals require a separately reviewed server policy.
3. Before admitting ANY new wallet/Spot/background writer, establish the verified
   writer-free hold deployment, then apply the additive migration and run the
   read-only audits while still held, following the linked operator runbook.
   Require an explicit discrepancy/admission decision; OTC off is insufficient.
   PostgreSQL must provide `pg_current_xact_id` / `pg_xact_status`.
4. Run the manually invoked audit only with a separately authorized connection:
   `node dist/otc/auditReserves.js` requires **OTC_AUDIT_DATABASE_URL**, never falls
   back to DATABASE_URL, never loads dotenv, enforces SQL READ ONLY in a repeatable
   snapshot, and prints no connection secret. Exit 0 clean, 2 issues, 1 unavailable.
   It does not repair/cancel; issue IDs/categories require separate owner review.
5. Legacy unbacked reserves or mismatched makers must be reconciled by a reviewed
   plan before enabling money operations. The app fails closed, not “fixed by
   adding another hold”. A halted Spot engine needs explicit database outcome
   reconciliation and restart before trading; never blindly retry an unknown order.
6. Train operators: cash-outcome ambiguity means keep the hold and investigate;
   record a real unique payout reference only after actual cash issuance.

Failure/recovery follows the linked matrix: the last-good target is the stdlib
hold process, NOT the old financial binary. A failed start can already have run
background writers. Re-establish stopped-writer proof and audit actual outcomes.
Preserve all balances/orders/fills/reserves/ledgers and backups, never reset the
migration, automatically refund or retry ambiguous financial work. Managing
existing obligations during an outage requires a separately approved plan.
