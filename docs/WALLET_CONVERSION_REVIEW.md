# Wallet Conversion — integration candidate, financial review, activation

Owner decision: **0% VOLTEX fee**. An internal conversion of existing **available Funding/Spot
`Balance`**, not a bank/card payout, blockchain transfer or external venue order. Locked funds,
`DemoBalance`, synthetic/managed listing assets and native simulation funds are never a source or a
destination. **Default OFF on the server and in the frontend.** No migration, deploy or production write.

Sources: Codex #478 (`fa81df84`) → reconciliation #543 (`d800233c`) → this candidate, rebuilt on
main `9265e997` (2026-10-23) with the review fixes below.

## Price: market bid / ask, never the last trade

- Existing Kraken spot feed and its freshness metadata (no new provider, credential, poller or cron).
  The quote **sells the source at the market's best bid and buys the destination at its best ask**
  (USD per unit; inverse fiat pairs such as USD/CHF are inverted side-correctly). A 0% fee therefore
  never removes the market spread, and a round trip can never return more than it started with
  (unit and PostgreSQL tests: USD→USDT→USD 5 → 5.01002 → 4.99).
- A crossed book (bid above ask) or one wider than 2% is not admitted. Stablecoins use their real USD
  book, never a 1:1 assumption. `/USDT` mirror pairs are ignored.
- Feed older than 15 s, from the future, missing or invalid: fail closed (`PRICE_UNAVAILABLE`, 503).
  No automatic repricing: if the bid or ask moved before confirmation, `QUOTE_CHANGED`.
- The cache timestamp is feed freshness, not an executable depth guarantee: this is a top-of-book
  conversion, not slippage-protected size (see *Risks*: size limits).

## Admission and precision (server-side)

- Only assets on `WALLET_CONVERSION_ASSETS` convert — default `USD:2,EUR:2,USDT:6,USDC:6,BTC:8,ETH:18`
  (`ASSET:decimal places`). A Kraken price alone is not enough (the feed lists hundreds of instruments
  the wallet does not support). Test/managed listing symbols (VTA, NRX, AITH, published listings) can
  never be configured or converted. A malformed list keeps conversion off and logs why.
- An amount with more decimals than the source keeps is refused (`0.001 USD`, 9 BTC decimals). The result
  is rounded **down once** to the destination's places (never up); a result that rounds to zero is refused.
- An admin-blocked account (`User.blockedAt`) is refused at quote and again inside the confirmation
  transaction — also with a session issued before the block (403 `ACCOUNT_BLOCKED`).

## Settlement, idempotency, recovery

- The quote is server-owned in `AuditLog` (`WALLET_CONVERSION_QUOTED`), bound to user, assets, amounts and
  both prices; it reserves nothing. The browser sends only the quote ID (strict schema): it cannot change
  an amount, price or asset.
- Confirmation: per-user `pg_advisory_xact_lock`, re-check of receipt, expiry, admission, block and
  prices, then the conditional source debit and the destination credit through the existing
  `mutateSpotBalance`, and one `WALLET_CONVERTED` receipt with the unique ID `conversion:<quote UUID>` —
  all in **one** PostgreSQL transaction. Any failure (receipt insert, destination write, block) rolls back
  both legs. Other writers (orders, withdrawals, transfers, admin adjustments) keep their conditional
  atomic updates; a race can never overdraw (PostgreSQL test with 10 conversions + 3 withdrawals).
- Retries with the same quote ID return the same receipt; a lost response is recovered from
  `GET …/receipt/:quoteId` (also with the feed down, also from a new service instance). The UI stores the
  pending ID **before** sending, never auto-retries, and blocks a new conversion until the outcome is known.
- A deadlock or serialization abort with another writer rolls the whole transaction back; the client sees
  an unknown outcome and retries the SAME ID safely.

## Interface

Wallet → Конвертация (overview and portfolio strip), seven languages. Before confirmation the user sees
what is debited, what is received, the effective rate (bid/ask), 0% fee and how the rate is formed. Amounts
finer than the asset's places are refused in the form. Errors say what happened and what to do (no
«unavailable» wording). After success the balances re-read by themselves and the history shows the
conversion once (debit and credit legs). Admin reasons/identities, Demo activity and quote previews never
appear in customer history.

## Activation (both switches, separately approved) and rollback

1. Owner approval of this code, of the asset list, and of the withdrawal policy for owner-issued balances
   (see *Which ledger this is* and *Risks*).
2. API: set `WALLET_CONVERSION_ENABLED=true` (and, if needed, `WALLET_CONVERSION_ASSETS`) on the API
   container and restart **only the API**. Check: `POST /api/v1/wallet/conversion/quote` without a token
   → 401; with an owner test session and a tiny amount → a quote; the logs show no
   `[wallet-conversion] … invalid` line.
3. Frontend: a build with `VITE_WALLET_CONVERSION_ENABLED=true`, published only after step 2 is verified.
   The frontend flag alone activates nothing: without the server flag every `/wallet/conversion/*` is 404.
4. Monitor `AuditLog` actions `WALLET_CONVERSION_QUOTED` / `WALLET_CONVERTED` and the treasury positions.

**Rollback:** unset `WALLET_CONVERSION_ENABLED` and restart the API → all conversion routes 404 at once
(history stays readable); then republish the frontend without the flag. Applied conversions remain on the
ledger with their receipts; nothing is reversed automatically, and no database restore is ever part of a
rollback.

## Which ledger this is (code on main `9265e997`) and the owner's demo-only policy

Owner statement of 2026-10-23 (Issue #558): VOLTEX currently holds **no real customer funds**; balances are
issued by the owner/admin to the team and approved testers, and registration grants nothing. The table name
`Balance` does not mean real money. What the code does, separately from that policy:

- **Where issued funds live.** An owner/admin credit (`BalanceAdjustmentService` → `mutateSpotBalance`) is a
  `Balance` row; Spot orders reserve and spend the same rows (`OrderService`). Other writers of `Balance`:
  confirmed deposits (`DepositBatchService`), banking rewards (`src/banking/service.ts`), listing owner
  allocation. `DemoBalance` is a separate ledger that conversion never reads or writes.
- **Registration** creates no `Balance` (no balance write in `src/api/routes/auth.ts`); an account without
  issued funds is refused before any write (PostgreSQL check *account without owner/admin-issued funds*).
- **Withdrawals** (`WithdrawalService.requestWithdrawal`): any positive non-test `Balance` can be put into a
  request; the amount is locked and an admin reviews it and sends by hand, recording the txHash. Nothing is
  paid automatically.
- **Conversion adds no cash-out path.** It changes which asset an already-issued balance is held in, at
  bid/ask, so its market value can only go down; the result is subject to exactly the same manual request
  as the source was. Whether owner-issued balances should be requestable for withdrawal at all is a
  question about `WithdrawalService` on main, outside this PR, for the owner to decide.

## Risks and open decisions (not code defects; production NO-GO until decided)

- **Hypothetical liabilities:** only if real deposits and cash-out operate does a conversion carry a real
  obligation (e.g. USD → BTC would then be BTC the treasury must hold), which would need inventory limits,
  exposure monitoring and hedging before activation. Under the current demo-only policy these are not
  established VOLTEX liabilities.
- **Size limits:** no per-conversion or per-user daily caps exist; top-of-book pricing does not cover size.
- **Feed coverage:** EUR (and any fiat) needs an actual Kraken book; if absent, the asset is simply not offered.
- **Quote rows:** each preview writes one `AuditLog` row (rate-limited to 20/min/user); retention is unchanged.

## Reproduce QA (disposable only)

```sh
npm ci --ignore-scripts && npm ci --ignore-scripts --prefix frontend && npx prisma generate
npm install --prefix output/wallet-qa-deps --no-save --ignore-scripts pg@8.23.1 playwright@1.63.0
npx jest --runInBand --runTestsByPath src/services/__tests__/WalletConversionService.test.ts frontend/src/lib/__tests__/walletConversion.test.ts
WALLET_QA_PG_BIN="$(pg_config --bindir)" node scripts/test-wallet-conversion-postgres.cjs   # PostgreSQL only
(cd frontend && VITE_WALLET_CONVERSION_ENABLED=true npx vite build) && WALLET_QA_PG_BIN="$(pg_config --bindir)" WALLET_QA_BROWSER=1 node scripts/test-wallet-conversion-postgres.cjs
(cd frontend && npx vite build --outDir ../output/wallet-off-dist) && WALLET_QA_PG_BIN="$(pg_config --bindir)" WALLET_QA_BROWSER=1 WALLET_QA_EXPECT_OFF=1 WALLET_QA_DIST=output/wallet-off-dist node scripts/test-wallet-conversion-postgres.cjs
```

The runner ignores `DATABASE_URL`, starts a new loopback-only temporary PostgreSQL cluster with its own
socket directory, applies the repository migrations **only there**, and stops it in `finally`. The browser
uses the real production React bundle and the real conversion/activity routes on that database; unrelated
reads are fixtures; outbound network is denied. Nothing touches production.
