# Deposit minimum: detection, automatic credit, manual credit

## Policy

`MIN_DEPOSIT_USD` remains **300**. The public warning remains
**«Минимальная сумма пополнения — от 300 $ в эквиваленте.»**

The minimum controls automatic credit, never discovery. Verified positive transfers below
the minimum are recorded as `BELOW_MINIMUM`. Unknown USD valuation remains `PENDING`;
it cannot authorize automatic credit. Missing confirmations prevent both automatic and
manual credit. A known owner's confirmed transfer at or above the minimum uses automatic
credit. Admin approval re-verifies the transfer and can override only the dollar minimum.

## Root cause on main

1. `DepositService.claimDeposit` returned immediately for **any** existing Deposit,
   including `BELOW_MINIMUM` and `PENDING`. An admin retry could never advance that row.
2. `performedByAdminId` only added audit metadata; it did not implement an authorized
   minimum override. The history UI offered no approval action for recorded deposits.
3. The incoming feed excluded all recorded transfers and swallowed provider failures,
   returning a successful empty array. It did not persist unclaimed observations.
4. Unknown USD valuation authorized automatic credit, allowing the minimum to be bypassed.
5. Balance credit read an amount and wrote an absolute replacement. Concurrent distinct
   deposits could overwrite another increment. The new path uses atomic increments.

No amount-based filtering was found in the existing provider discovery adapters.

## Persistence and authorization

- One `(chain, txHash)` unique identity. Canonical hexadecimal hashes; Solana signatures
  remain case-sensitive. No second row for manual approval.
- Unassigned observations use nullable `Deposit.userId`, not a fictitious user. Shared
  treasury addresses alone cannot prove which customer sent a transfer. The admin must
  choose the customer when unknown; normal authenticated claims retain their existing flow.
- The existing admin route guard remains. The service additionally validates the admin's
  role inside the credit transaction. The frontend supplies no authoritative amount.
- Every uncredited approval rechecks treasury, configured asset, exact on-chain amount
  and confirmations. A mismatch fails closed. An already credited row is a safe no-op.
- Unique-key upsert serializes same-transfer requests. Status, balance increment, audit
  and existing 5% referral reward commit or roll back together. Referral policy is unchanged.
- All unresolved deposits remain in the admin queue even beyond 200 newer credited rows.
  Recent credited history retains the existing 200-row bound.
- Provider partial failures are explicit; persisted observations remain visible. Legacy
  array clients receive HTTP 503 instead of an empty success on provider failure.

## Validation

`scripts/qa-deposit-minimum.cjs` creates and destroys a **disposable loopback PostgreSQL**
cluster. It never reads `DATABASE_URL`. The production compiled routers, auth middleware,
TRON verifier, DepositService and generated Prisma client run against a deterministic
local HTTP chain fixture. It does not test production or send real funds.

Coverage: 299 below minimum/no credit/admin visibility; 300 automatic credit; 10/100
TRC20 detection without a claim; unassigned-to-assigned same-row transition; eight
concurrent approvals; concurrent first claims including uppercase aliases; distinct
concurrent deposits; non-admin rejection; untrusted amount ignored; confirmation retry;
recipient/asset/amount rejection; provider outage; full rollback on forced audit failure;
durable observations after a transfer leaves the recent feed; pending 350 auto-credit
when confirmations arrive; referral exactly once.

`--browser` uses the real frontend production bundle and these same local backend routes
at 1440 and 390 pixels: BELOW_MINIMUM, manual credit, authoritative balance delta, reload,
no second approval button, provider outage message, no document overflow, and the exact
public $300 warning. Tables retain horizontal scrolling on narrow screens.

Windows reproduction (no production environment or secret needed):

```powershell
npm ci --ignore-scripts
npm ci --prefix frontend --ignore-scripts
npx prisma generate
npm run build
npm run build --prefix frontend
npm install --prefix node_modules/.cache/deposit-qa --no-save --ignore-scripts @embedded-postgres/windows-x64@18.4.0-beta.17 pg@8.23.0 playwright@1.56.1
$env:QA_PLAYWRIGHT_MODULE = (Resolve-Path node_modules/.cache/deposit-qa/node_modules/playwright).Path
node scripts/qa-deposit-minimum.cjs --browser
```

The browser runner uses installed Microsoft Edge on Windows. The focused Jest command
and repeatable acceptance are also in `.github/workflows/deposit-minimum.yml`.

## Migration and remaining limits

- Migration `20260921120000_deposit_unassigned_incoming` makes userId nullable and
  canonicalizes historical hashes in one transaction. A legacy case-alias collision
  aborts migration rather than deleting or combining financial records. Before rollout,
  inspect duplicate canonical `(chain, hash)` groups and reconcile any existing duplicates.
  Migration has been exercised on the disposable database only, never production.
- Discovery still uses the existing providers' **recent transaction windows** on admin
  feed access, not a continuous full-chain indexer. This patch persists every verified
  observation regardless of value and claims can verify older hashes, but does not claim
  complete backfill for transfers never observed while outside those windows. A durable
  paginated scanner is a separate remaining requirement for guaranteed 24/7 discovery.
- An unknown owner cannot be auto-credited safely. Unassigned transfers, including >=300,
  remain visible for assignment. On-chain provider availability and a legitimate treasury
  configuration are prerequisites; errors never authorize credit.
- No production transfer or production database was touched. No merge or deploy.
- ERC-20 verification now totals all matching token/treasury Transfer events in a
  transaction, instead of taking only the first. Previously recorded partial amounts
  fail the exact-amount re-verification guard and need reconciliation; credited rows
  are never credited again or silently adjusted.

## Recorded local result

Implementation commit: ea37e441c53a42e50ebef94cb5d5e9783082b175.
Base: 25db4e9873fe0af1dd7bf68b041486beb8791eba.

- Backend TypeScript and frontend production build: PASS.
- Focused Jest: **168/168**, 14 suites.
- Real disposable PostgreSQL acceptance: **14/14**.
- Admin browser acceptance at 1440/390 and exact deposit warning: PASS.
- Extended wallet comparison: **24 pre-existing failures** on both clean base and this branch, identical failing test names; no new failures. These are not reported as a green full repository suite.
- Evidence: [compact test summary](qa/deposit-minimum/tests.json), [PostgreSQL/browser report](qa/deposit-minimum/report.json), [desktop below-minimum queue](qa/deposit-minimum/below-minimum-1440.png), [mobile provider outage](qa/deposit-minimum/provider-outage-390.png), [public warning](qa/deposit-minimum/deposit-warning.png).

Follow-up after syncing main `6897c1f05b41dd57013a7757f3b86b3f78ddf289`:
169 deposit tests plus 53 existing integrity tests PASS (222 total). Backend rebuild
PASS; frontend runtime unchanged from the successful post-sync production build.
PostgreSQL 14/14 and browser 1440/390 rerun PASS with pg_ctl startup, which supports
restricted Windows server processes and writes startup diagnostics to the QA artifact.
The pre-optimization capacity benchmark now generates Prisma types from its own
pinned schema/dependencies, instead of incorrectly borrowing the candidate's new
nullable Deposit owner contract. No baseline source or benchmark assertion changed.
