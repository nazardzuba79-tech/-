# Demo Spot for admin-credited accounts (Issue #592) — code-only candidate

Owner policy (Issues #558, #592, 2026-10-23): VOLTEX currently uses test funds, not real customer deposits.
An admin credits a chosen account; only that amount (plus results of demo trading) can be traded; a new account
has nothing and cannot trade; demo funds never become a cash-out claim. **Default OFF on the server and in the
frontend.** No migration, deploy, flag, balance or production write is part of this change.

## Ledger facts on main `9265e997` (reproduced on a disposable PostgreSQL)

| Situation (flag unset = today) | Result |
| --- | --- |
| Registered USER, no credit → `POST /orders` | 400 `Insufficient USDT balance or reserved funds`; no Balance/DemoBalance row is created |
| USER with an admin **Balance** credit (`balance-adjustments` / `adjust-balance`) → `POST /orders` | 201: trades the **real** Spot ledger (OrderService) |
| USER with an admin **demo-topup** credit (DemoBalance) → `POST /orders` | 400 (Balance is empty) |
| Same USER → `POST /demo/orders` | 403 `Admin access required` |
| USER with an admin Balance credit → `POST /withdrawals` | 200 `PENDING`, amount locked (**see BLOCKER 1**) |
| Owner / configured native tester (Cross trading wallet, valued from DemoBalance) → `POST /withdrawals` | main: recorded as an unheld `PENDING` request against demo funds. **Fixed here: 403.** |

## What this change does

**One ledger, already isolated:** demo Spot trades `DemoBalance` / `DemoOrder` / `DemoTrade` — the admin
`demo-topup` ledger. `WithdrawalService`, wallet transfers, the Wallet Conversion candidate (#591) and every real
Spot path read and write `Balance` only; nothing moves value from `DemoBalance` to `Balance`. No new wallet, table
or migration.

**Admission (server, `src/services/demoSpotAccess.ts`):**
- ADMIN: unchanged, independent of the flag.
- USER: only with `DEMO_SPOT_ENABLED=true` **and** an admin demo credit on record (`DEMO_BALANCE_ADJUSTED`,
  written only by `demo-topup`). Registration, a page view or a client flag admit nobody and grant nothing.
- Blocked accounts (`User.blockedAt`) are refused, also with a live session; revoked sessions/forged tokens get 401
  from `requireAuth`. A USER may trade only pairs the real market feed lists (`isSpotPair`), never test
  markets, listings, NRX/AITH/VTA.
- Flag OFF: the `/demo/*` Spot routes behave byte-for-byte as before (admin-only). VTA routes stay admin-only.

**Engine fixes (the admin sandbox had three accounting defects, now on the real Spot mechanism):**
1. A maker's `DemoOrder` row was never updated on a fill (stayed OPEN with its full quantity): cancelling a filled
   maker could refund funds already paid out. Now every changed maker is persisted (as `OrderService` does).
2. The in-memory book was mutated inside the DB transaction and never rolled back. Now `SpotBookTransaction`
   (generalised to a ledger; `DEMO_SPOT_LEDGER`, own advisory lock `demo-spot-book`) loads the book from committed
   rows, matches in the transaction and publishes only after PostgreSQL reports the commit.
3. Resting demo orders vanished from the book on restart while their funds stayed locked. The book is now
   reloaded from the rows on every transaction; `GET /demo/orderbook` reads the rows.
A legacy row whose fills are not reflected (written by the old engine) stops trading on its pair instead of
refunding twice (fail closed) — see *Activation*.

**Order semantics:** LIMIT and MARKET only (what the demo engine supports). LIMIT reserves at placement, partial
fills keep the rest reserved, cancel releases exactly the remainder. MARKET fills only resting demo depth (2% buffer,
the rest refunded); with none it is refused (`NO_LIQUIDITY`) — never an invented fill or price.

**Uncertain outcome / retries:** every terminal order carries a client `requestId` (UUID). The order ID is derived
from (account, requestId), checked under the book lock and unique in the table, so a retry after a lost response —
or several at once — returns the order the first attempt committed (HTTP 200) and reserves nothing again; the same
ID with other terms is refused (409 `REQUEST_CONFLICT`). The terminal keeps the ID while the outcome is unknown
(network error, 5xx) and releases it on any definite answer. Without a `requestId` (old clients) behaviour is as
before.

**Terminal (frontend, `VITE_DEMO_SPOT_ENABLED`, default off):** the ordinary Spot terminal on ordinary pairs:
- admitted account: balances, orders, open orders, history and assets from the demo ledger; LIMIT/MARKET tabs only;
  insufficient funds shows the existing «Недостаточно USDT на балансе.»;
- account without an admin credit (or access not yet known): Buy/Sell stay clickable and **nothing is sent or
  shown**; balance reads 0.00;
- test markets, listings and VTA keep their own paths; no «demo»/«unavailable» wording is added;
- the frontend flag alone activates nothing: with the server flag off the terminal stays on the ordinary ledger.

**Withdrawals:** a Cross trading account (owner / `PRIVATE_TRADING_TEST_USER_IDS`) is valued from DemoBalance, so
`GET /withdrawals/options` lists nothing and `POST /withdrawals` answers 403 `DEMO_FUNDS_NOT_WITHDRAWABLE` before
anything is written. **This is a behaviour change on merge** (not flag-gated, by design: it closes a demo→cash-out
path). Accounts without a Cross wallet are unchanged.

This guard does not read `DEMO_SPOT_ENABLED` (verified in both states on PostgreSQL). It applies only to an account
whose native Cross wallet is opened — the pinned owner (`PRIVATE_TRADING_ENABLED` + `PRIVATE_TRADING_OWNER_ID`) or
an ID in `PRIVATE_TRADING_TEST_USER_IDS`; a configured tester without an opened wallet and every ordinary account
keep the `Balance` request path (verified with a Balance-funded tester). **Rollback:** revert the
`src/api/routes/withdrawals.ts` change and redeploy the API; no data migration — refused requests wrote nothing.

## Activation (separately approved) and rollback

1. Owner approval of this code and of the BLOCKER decisions below.
2. Read-only check for legacy demo rows (each listed pair refuses demo trading until reconciled by an approved
   data change):
   ```sql
   SELECT o.id, o.pair, o."originalQuantity", o."remainingQuantity", COALESCE(SUM(t.quantity), 0) AS filled
   FROM "DemoOrder" o LEFT JOIN "DemoTrade" t ON t.pair = o.pair AND (t."makerOrderId" = o.id OR t."takerOrderId" = o.id)
   WHERE o.status IN ('OPEN', 'PARTIALLY_FILLED')
   GROUP BY o.id
   HAVING o.type <> 'LIMIT' OR o.price IS NULL OR o."originalQuantity" - COALESCE(SUM(t.quantity), 0) <> o."remainingQuantity";
   ```
3. API: `DEMO_SPOT_ENABLED=true`, restart only the API. Check: `GET /api/v1/demo/spot/access` → `{enabled:true}`;
   an uncredited test account → `admitted:false` and `POST /demo/orders` 403.
4. Admin credits testers **only through demo top-up** (not «adjust balance» / balance adjustments). A Balance credit
   is withdrawable by request (BLOCKER 1), so activation is NO-GO unless the owner confirms this rule.
5. Frontend build with `VITE_DEMO_SPOT_ENABLED=true`, published only after step 3.

**Rollback:** unset `DEMO_SPOT_ENABLED`, restart the API → testers are refused at once (403), the admin sandbox and
every demo balance/order stay; republish the frontend without the flag. No database restore.

## BLOCKED / open — concrete reasons

1. **Balance credits stay withdrawable by request.** `adjust-balance`, confirmed deposits, banking rewards and Spot
   fills all write the same `Balance` rows, which have no provenance column. Once funds are traded, a per-asset
   lineage cannot be reconstructed exactly from `AuditLog`/`Deposit` without a schema change, so this PR does not
   fake it. Options for the owner: (a) issue tester funds only through demo top-up (no code); (b) an optional,
   default-off gate capping each asset's requestable amount at *credited deposits − non-rejected withdrawals* of
   that asset (conservative, testable, no migration; withholds trading gains); (c) a provenance column (migration).
   No global withdrawal change was made.
2. **Admin UI:** the two credit forms (Balance vs demo) are easy to confuse; clearer labels/confirmation are a
   separate admin change.
3. **Liquidity:** the demo book holds only testers' orders; MARKET needs resting LIMIT orders (the admin can provide
   depth from its own demo funds). Paper fills against the real Kraken book would be a new fill/pricing policy.
4. **Futures for credited USERs:** unchanged — the existing native mechanism (`PRIVATE_TRADING_TEST_USER_IDS`).
5. **Wallet page** shows `Balance`; demo balances are shown in the terminal's assets tab.
6. **Replay without a request ID** (old clients only): an identical POST is a second order, as on real Spot. The
   terminal always sends one. A replay after logout/revocation is refused.
7. **Stocks** silent no-op is Issue #558's separate work; Wallet Conversion #591 stays Draft/OFF (it converts
   `Balance` only and never reads `DemoBalance`).

## Reproduce QA (disposable only)

```sh
npm ci --ignore-scripts && npm ci --ignore-scripts --prefix frontend && npx prisma generate
npm install --prefix output/demo-qa-deps --no-save --ignore-scripts pg@8.23.1 playwright@1.63.0
DEMO_QA_PG_BIN="$(pg_config --bindir)" node scripts/test-demo-trading-postgres.cjs          # PostgreSQL only
(cd frontend && VITE_DEMO_SPOT_ENABLED=true npx vite build) && DEMO_QA_PG_BIN="$(pg_config --bindir)" DEMO_QA_BROWSER=1 node scripts/test-demo-trading-postgres.cjs
(cd frontend && npx vite build --outDir ../output/demo-off-dist) && DEMO_QA_PG_BIN="$(pg_config --bindir)" DEMO_QA_BROWSER=1 DEMO_QA_EXPECT_OFF=1 DEMO_QA_DIST=output/demo-off-dist node scripts/test-demo-trading-postgres.cjs
```
The runner ignores `DATABASE_URL`, starts a new loopback-only PostgreSQL cluster, applies the repository
migrations only there, denies outbound network, and stops the cluster in `finally`.
