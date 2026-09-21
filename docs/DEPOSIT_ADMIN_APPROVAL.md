# Deposits: administrator approval only

Owner policy, 2026-09-21. Supersedes the automatic >=$300 credit policy in PR #163.
Fresh base: `55aa8a4f2c86a90a0c78c5d71e533b01386f65d3`.
No production access, migration, merge or deploy is part of this change.

## Removed path and state machine

Previously `DepositService.status()` returned CREDITED for known USD value >=300
and enough confirmations. `claimDeposit()` used that result without an admin id.
`recordIncoming()` also called that path for an already-attributed transfer, so a
discovery refresh could credit it when confirmations arrived. Both were against
the owner's corrected policy.

`awaitingStatus()` now has a return type that excludes CREDITED:

| Trigger | Result | Balance / referral |
| --- | --- | --- |
| Verified discovery or user claim, USD value <300 | BELOW_MINIMUM | Unchanged |
| Verified discovery or user claim, USD value >=300 or unknown | PENDING | Unchanged |
| More confirmations / another discovery refresh | Still awaiting admin | Unchanged |
| Authenticated ADMIN approval with sufficient verified confirmations | CREDITED | Exact verified amount; existing 5% referral policy |
| Admin approval without sufficient confirmations | PENDING / BELOW_MINIMUM | Unchanged |
| Verification, ownership or amount mismatch | Error, no credit | Unchanged |
| Repeat request for a CREDITED row | Return stored CREDITED | Unchanged |

The minimum remains **300**, and the customer warning remains exactly:
**«Минимальная сумма пополнения — от 300 $ в эквиваленте.»**

## Credit authorization and invariants

- Only `/admin/deposits/manual-credit` supplies `performedByAdminId`, from the
  authenticated request identity, behind existing `requireAuth` + `requireAdmin`.
- The service re-checks that identity's ADMIN role inside the credit transaction.
  The only new-CREDITED expression requires this identity AND enough confirmations.
- The public claim route passes only authenticated userId, validated hash and asset.
  Submitted `performedByAdminId`, `status`, and `amount` cannot authorize credit.
- Detection never supplies the admin parameter. It verifies/persists the transfer,
  updates attribution/confirmations, and leaves it pending.
- On-chain verifier remains authoritative for treasury recipient, asset, exact amount
  and confirmations. Submitted/listed amounts are never the amount credited.
- Same canonical chain/hash row, row-lock/upsert arbitration, exact-amount check,
  atomic balance increment, credit audit and referral all remain in one transaction.
- Existing CREDITED rows stay credited; this change does not reverse historical credits.
  A self-claim can read that already-stored state, but cannot create a credited transition.

## Bounded provider request behavior

No worker, timer, recursive backfill or automatic pagination was added. The admin
page discovers on mount, explicit refresh, and after a completed manual credit.
One in-flight discovery request per mounted page; overlapping clicks are coalesced.
No 24/7 scan. Different admin sessions can each request a refresh; these numbers
are per refresh, not a global requests/minute quota.

The six existing network slots (Bitcoin, TRON, Ethereum, BSC, Solana, TON) are visited
sequentially, only when configured. Let T be configured token count on a network,
and N be unique uncredited transaction/asset observations in its current page.
Duplicate observations are verified once. Already-CREDITED rows cause no verifier call.

| Network | Discovery calls/window | Additional verification per uncredited observation |
| --- | --- | --- |
| Bitcoin | 1 address page, <=25 transactions; +1 shared tip read if matching transfers exist | tx + tip (up to 2 HTTP calls) |
| TRON | T pages, explicit limit 20 per token, local slice 20; N <=20T | events + current block (2 HTTP calls) |
| Ethereum / BSC | 1 native page + T token pages; explicit page=1, offset=20 and local slice; N <=20(1+T) | receipt + block number; native also transaction (2/3 ethers method calls, plus its network metadata/transport handling) |
| Solana | 1 signature page + <=20 transaction RPC reads; local signature cap 20 | transaction + signature status (2 RPC calls) |
| TON | 1 page, <=20 events locally; no next_from traversal | 1 bounded recent-events lookup (limit=100), no pagination |

For typical TRON USDT-only configuration, one admin refresh costs **1 + 2N <=41
HTTP requests**, sequentially, and a manual approval costs **2**. No referral or
credit mutation occurs during any of these discovery reads. Other networks' totals
are the corresponding discovery cost plus verification cost times N. Non-pegged
assets also use the existing server-side price source once per verification to
classify BELOW_MINIMUM; price availability never grants credit. Ethers method counts
are not represented as an exact HTTP count because that library batches and handles
network metadata internally. There is no new application-level retry loop.

Provider outages produce incomplete/error state, not an empty-success claim. Solana
per-transaction RPC failure now propagates instead of silently skipping into an empty
feed. Persisted observations remain accessible. The bounded windows deliberately do
not guarantee discovery of unseen transfers that have already left those windows.

## Validation and evidence

- Backend TypeScript/build and frontend TypeScript/production build PASS.
- Focused deposit/provider/auth/admin/wallet tests: 182 tests, 15 suites PASS.
- 16 acceptance cases on disposable PostgreSQL using real Prisma, production routes,
  real auth middleware and a local synthetic on-chain HTTP fixture.
- 100/299/300/5000/10000: detection, exact admin amount, self-claim, repeated discovery
  all preserve balances/referrals. Forged public approval fields have no effect.
- Duplicate + concurrent manual approvals, insufficient confirmations, amount/recipient/
  asset mismatch, outage, rollback and concurrent distinct credits covered.
- Final reconciliation requires one manual ADMIN audit per CREDITED row, exact user
  balance equal to credited deposit sum, referral balance equal to recorded rewards.
- Negative control: this same PostgreSQL runner with only the exact main DepositService
  restored fails at 300 USDT self-claim: actual CREDITED, expected PENDING. Restoring
  the candidate passes. No production environment or application source was changed
  for this control; only disposable compiled test output was swapped and restored.
- Browser production-bundle QA at 1440/390: exact 100/299/350.123456 amounts, both
  pending statuses, explicit approval, reload, provider error and public warning PASS.
- Provider budget tests inject oversized 100-item responses and next-page pointers:
  calls/observations stay bounded. Mounted UI fake-clock test advances one hour without
  a new discovery call; overlapping refresh clicks still issue only one request.

Run the focused tests listed in `.github/workflows/deposit-minimum.yml`, then:

```powershell
npm run build
npm run build --prefix frontend
npm install --prefix node_modules/.cache/deposit-qa --no-save --ignore-scripts @embedded-postgres/windows-x64@18.4.0-beta.17 pg@8.23.0 playwright@1.56.1
$env:QA_PLAYWRIGHT_MODULE = (Resolve-Path node_modules/.cache/deposit-qa/node_modules/playwright).Path
node scripts/qa-deposit-minimum.cjs --browser
```

The runner creates its own localhost database and never reads DATABASE_URL.
Current evidence: `docs/qa/deposit-admin-only/`; CI artifacts: `output/deposit-admin-only/`.
The old `docs/qa/deposit-minimum/` is historical PR #163 evidence, not this policy.
