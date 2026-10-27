# Demo Spot / Demo Liquidity — operator-only PostgreSQL preflight

Purpose: turn the three previously NOT_RUN read-only production checks in `docs/DEMO_TRADING.md` into a **single fixed and auditable command**, without publishing users' balances, emails, credentials, hostnames, or SQL row details.

This is *not* a production database connection tool. It runs only from an operator shell where a **verified target production PostgreSQL connection** is already available. We cannot confirm which server database an arbitrary environment variable points to.

## Guardrails
- Do not run using the old Neon project or an arbitrary local fixture as evidence of the current Hetzner PostgreSQL.
- It does **not** load or silently use `DATABASE_URL`; explicitly supply `DEMO_PREFLIGHT_DATABASE_URL` from a verified server-side secret manager and pass `--read-only-preflight` in the same operator session. **Never paste the URL into a chat, issue, log or GitHub Action input.**
- This code uses Prisma, a single `SET TRANSACTION READ ONLY` transaction and only hard-coded SELECT queries. No migration, restart, credit, order or withdrawal mutation.
- Run from the reviewed repository on the trusted application host with the existing dependencies and generated Prisma client:
  `node scripts/demo-production-preflight-readonly.cjs --read-only-preflight`
- Check its result in **private** logs; public Github issue should receive only a sanitized count summary or a boolean flag. Do not copy user IDs, emails, or database information into issues.

## Aggregates (three required plus one withdrawal safety cross-check)
1. `legacyActiveDemoOrders`: count of malformed active old `DemoOrder` rows and number of affected pairs.
2. `dualLedgerAccounts`: count of nonblocked accounts both demo-credited and funded in ordinary `Balance`. Owner must review their private identities before switching ledgers.
3. `legacyOrdinaryFundedAccounts`: count of nonblocked accounts with ordinary funds but no `DEMO_BALANCE_ADJUSTED` audit. Their old Spot behavior must remain unchanged.
4. `unheldCrossWithdrawals`: aggregate PENDING/APPROVED `Withdrawal.balanceHeld=false` (old claims must remain unmodified on any change to Cross withdrawal policy).

The script produces `MANUAL_REVIEW_REQUIRED` even when all counts are zero. Counts alone can never approve a financial merge or certify source-of-funds. Inconsistency makes the command exit non-zero; dual-ledger and legacy claims require owner/operator assessment.

## Separate release decision
- PR #596 changes **Cross demo withdrawal** behavior even with `DEMO_SPOT_ENABLED=false`. This is the remaining financial behavior decision; no preflight command makes it automatically safe. Old PENDING/APPROVED requests must not be auto-cancelled.
- Existing `Balance` credits remain potentially withdrawable by request; the owner chooses future test grants only through `demo-topup`, and no current balances may be reclassified silently.
- PR #599 must be merged **after** #596 and code-released with `DEMO_LIQUIDITY_ENABLED` OFF. Stock orders, TYVN and ECLAVO remain independent.
- No merge/deploy/flag activation is implied by a clean or completed preflight.

## Test
`node --test scripts/demo-production-preflight-readonly.test.cjs`

It tests the read-only transaction and redacted aggregator with simulated database responses, **not** a live production PostgreSQL read.

## Additional real PostgreSQL proof (disposable database only)

The PR workflow also starts a new GitHub-hosted PostgreSQL 16 fixture named `demo_preflight_fixture` using hard-coded synthetic data; `scripts/demo-production-preflight-fixture.cjs` **refuses any non-loopback/non-fixture URL**. It runs the same four queries, verifies 2 malformed orders / 1 dual-ledger account / 1 ordinary legacy account / 2 pending Cross claims, and proves the audit did not modify fixture rows. This demonstrates SQL compatibility on PostgreSQL, **not** the actual data on Hetzner.
