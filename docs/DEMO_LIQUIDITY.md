# Internal demo liquidity (Issue #592, CTO review 6361475787) — code-only candidate, default OFF

**Problem (measured on PR #596, `d20200ca`):** a demo tester with funds on an empty demo book gets
`400 No liquidity available for this market order` for a MARKET BUY and a `CANCELLED` MARKET SELL without a fill.
The demo book holds only testers' own LIMIT orders, so funds alone never make a MARKET order work.

**What this adds:** option (b) of `docs/DEMO_TRADING.md` → BLOCKED 3 — an internal counterparty for the demo
ledger only. It is a separate, default-OFF module (`src/services/DemoLiquidity.ts`), stacked on #596. Nothing is
enabled by merging it.

## How it works

1. The owner picks one **dedicated liquidity account** and credits it through the ordinary admin
   «Тестовое начисление» (demo top-up, audited `DEMO_BALANCE_ADJUSTED`), e.g. some BTC/ETH and USDT. That
   DemoBalance is the whole inventory. The module never credits, mints or tops anything up.

   **Account rule, enforced on every quote** (owner/CTO review 6362235524; `liquidityAccountRefusal`):
   - the account must be an unblocked `USER` (not `ADMIN`);
   - it must be neither the owner (`PRIVATE_TRADING_OWNER_ID`) nor a native tester (`PRIVATE_TRADING_TEST_USER_IDS`);
   - it must hold **no ordinary `Balance` at all** — any asset, available or reserved.

   The rule is checked inside the demo book transaction on committed rows, and every `Balance` row of the account
   is read `FOR SHARE`:
   - a credit in flight to an existing row is waited for, then seen, and the quote is refused;
   - a credit creating a new row that commits after the check is ordered after that quote, and the next quote is
     refused.

   Configuration alone is never trusted for this rule.
2. When a demo Spot order arrives on a listed pair, the server reads the **market reference** (bid/ask with the time
   the provider actually answered) from the existing market-data cache — before taking the book lock, never an
   order to any venue.
3. Inside the same demo book transaction (advisory lock `demo-spot-book`) it offers **one quote** to this taker only:
   - a buyer: the reference **ask + spread** (default 10 bps), rounded up;
   - a seller: the reference **bid − spread**, rounded down;
   - prices are kept to 8 significant digits;
   - size: the account's *available* demo funds, capped per order (default 1000 in the quote asset), rounded down
     to 8 decimal places.
4. The quote is matched by the ordinary engine with price-time priority. A resting tester order at a better price
   fills first. A filled part is settled like any maker:
   - the account's funds are reserved conditionally (`available ≥ amount`) — never overdrawn;
   - a `DemoTrade` is written, plus a `FILLED` `DemoOrder` receipt for the executed part.
5. Whatever the quote did not fill is removed before the book is published, so a quote **never rests**. It
   therefore can never be filled later at a price that has gone stale.

**No quote (fail closed)** — the order then meets only the resting demo book, exactly as without this module — when:
- the reference is missing, `stale`, older than 10 s, in the future, invalid, crossed, or wider than 1 % of mid;
- the reference read fails;
- the pair is not listed;
- the liquidity account is missing, blocked, not a `USER`, the owner or a native tester, or holds any ordinary
  `Balance`;
- the taker is the liquidity account itself;
- the needed side of the inventory is empty.

## What it never does

- Writes `Balance`, `Order`, `Trade`, `Withdrawal` or a wallet transfer.
- Sends an order to Kraken or any venue.
- Creates or emits funds: every demo unit stays traceable to an admin demo top-up, checked by the PG runner after
  every step.
- Changes ordinary Spot, Futures, TYVN, AITH, NRX, VTA, listings or Stocks.
- Lets demo funds become a withdrawal: a demo-valued (unheld) request is refused permanently, under every switch
  (Issue #617; `WithdrawalService`). Before that fix, liquidity forced the old guard on.
- Quotes test markets, managed listings or VTA: the configuration refuses them, and they have no market reference.
- Uses a native Cross trading account (owner / `PRIVATE_TRADING_TEST_USER_IDS`) as inventory: the configuration
  refuses it, because that DemoBalance values a Cross wallet.

The demo ledger has no fees, so every fill is an exact zero-sum transfer between two DemoBalances.

## Configuration (API environment, all optional except the first three)

| Variable | Default | Allowed |
| --- | --- | --- |
| `DEMO_LIQUIDITY_ENABLED` | unset = **OFF** | `true` only |
| `DEMO_LIQUIDITY_ACCOUNT_ID` | — | an account UUID, not a native trading account |
| `DEMO_LIQUIDITY_PAIRS` | — | 1–50 ordinary pairs, e.g. `BTC/USDT,ETH/USDT` |
| `DEMO_LIQUIDITY_SPREAD_BPS` | 10 | 1–500 |
| `DEMO_LIQUIDITY_MAX_ORDER_QUOTE` | 1000 | > 0, ≤ 1e9 (quote asset per taker order) |
| `DEMO_LIQUIDITY_MAX_QUOTE_AGE_MS` | 10000 | 1000–60000 |
| `DEMO_LIQUIDITY_MAX_REFERENCE_SPREAD_BPS` | 100 | 1–1000 |

Any malformed value keeps the module **off**. The API logs `[demo-liquidity] off: <reason>`, and the admin status
shows it.

**Admin status (read only):** `GET /api/v1/demo/liquidity` (ADMIN) returns:
- the configuration;
- `account`: `OK`, or why the account backs no quotes (`MISSING`, `BLOCKED`, `NOT_USER`, `NATIVE_ACCOUNT`,
  `ORDINARY_FUNDS`);
- the account's inventory;
- per pair, whether the reference may be quoted right now (`OK` / `STALE` / `MISSING` / `CROSSED` / `TOO_WIDE` /
  `INVALID`) and its age.

A USER gets 403.

## Terminal behaviour (unchanged code, new outcomes)

| Order on an empty demo book | Liquidity off (today) | Liquidity on |
| --- | --- | --- |
| MARKET BUY | «Не удалось разместить ордер», nothing reserved | filled at ask + spread, «Ордер размещён» |
| MARKET SELL | «Ордер отменён без исполнения…», reserve returned | filled at bid − spread |
| LIMIT crossing the quote | rests | filled at the quote price; the difference is refunded |
| LIMIT not crossing | rests | rests; it fills only against other testers (a quote never rests) |
| More than the balance | «Недостаточно USDT на балансе.» | same |
| Reference stale / unavailable | — | same as «off» for that order |

## Verification (all local, synthetic data)

- **Unit:** `src/services/__tests__/DemoLiquidity.test.ts` — 33 tests:
  - configuration rules;
  - quote pricing and rounding;
  - inventory and cap sizing;
  - every fail-closed case, including the account rule;
  - BUY/SELL, MARKET/LIMIT, priority, partial fill and refund;
  - insufficient funds, retries, and a rollback when inventory is spent concurrently.
- **Route:** the admin status route is admin-only and read-only (`demoTrading.test.ts`).
- **Disposable PostgreSQL:** `scripts/test-demo-liquidity-postgres.cjs`, 15/15. It uses the real routers on a new
  loopback cluster, a fixture reference and denied outbound network. It covers:
  - the baseline;
  - MARKET BUY and SELL;
  - LIMIT crossing and passive;
  - insufficient funds;
  - fail-closed (stale, old, future, crossed, too wide, missing, unlisted);
  - empty inventory side and the per-order cap;
  - 5 parallel retries with one request ID → one fill, then 409 on other terms;
  - 12 parallel BUYs against 0.005 BTC → exactly 5 filled, 7 refused, never overdrawn;
  - priority of a better resting order;
  - restart;
  - the account rule: a USER funded only on the demo ledger quotes; ADMIN, blocked, owner, native tester and an
    ordinary `Balance` credit each give no quote (with nothing moved); back to zero it quotes again; an ordinary
    credit in flight during a quote is waited for and then refuses it; no self-trade;
  - the admin status route;
  - no cash-out (no `Balance`, `Withdrawal`, `Order` or `Trade` row);
  - zero outbound requests;
  - conservation against the audited top-ups after every step.
- **Browser** (production bundle with `VITE_DEMO_SPOT_ENABLED=true`, 1440 and 390 px, real demo routes) covers:
  - MARKET BUY and SELL filled on an empty book;
  - a crossing LIMIT filled;
  - a passive LIMIT resting and cancelled from open orders;
  - history;
  - «Недостаточно USDT»;
  - a stale reference giving the existing refusal and cancellation lines with balances unchanged;
  - only `/demo/orders` posted.
- **CI:** `.github/workflows/demo-liquidity.yml` (pull_request only, no secrets, no deploy) repeats the above.

## Integration plan (each step separately approved; nothing here is done by merging)

1. Merge #596 (Demo Spot) first; this PR is stacked on it. If #596's branch is deleted on merge, GitHub retargets
   this PR to `main`. Otherwise retarget it by hand. Then wait for exact-head CI.
2. Merge this PR → deploy the API with **no** `DEMO_LIQUIDITY_*` set. Behaviour is byte-identical to #596.
3. Owner chooses and creates a **dedicated** liquidity account:
   - a plain USER;
   - not the owner;
   - not a native tester;
   - no ordinary `Balance`.

   Operator preflight, read-only (the server enforces the same rule on every quote; this only confirms the choice):
   ```sql
   SELECT u.id, u.role, u."blockedAt",
          (SELECT COUNT(*) FROM "Balance" b WHERE b."userId" = u.id AND (b.available <> 0 OR b.locked <> 0)) AS ordinary_rows
   FROM "User" u WHERE u.id = '<liquidity account id>';
   -- expected: role USER, blockedAt NULL, ordinary_rows 0
   ```
4. Admin credits that account through «Тестовое начисление» only — e.g. 0.05 BTC, 1 ETH, 5 000 USDT. This is the
   inventory limit for every quote.
5. Set the environment variables and restart only the API:
   - `DEMO_LIQUIDITY_ENABLED=true`;
   - `DEMO_LIQUIDITY_ACCOUNT_ID=<that id>`;
   - `DEMO_LIQUIDITY_PAIRS=BTC/USDT,ETH/USDT`;
   - optionally the spread and cap values.

   Smoke check: `GET /api/v1/demo/liquidity` as admin → `enabled: true`, `account: OK`, each pair `OK`,
   inventory as credited.
6. One admitted tester places a small MARKET BUY and SELL on desktop and phone. Compare the fill prices with
   reference ± spread, and check that the inventory moved by exactly the fills.
7. Watch for a day: the admin status, the account's `DemoOrder` receipts, and the PG conservation query below.

```sql
-- Read-only: demo units held vs credited by admin demo top-ups, per asset (must be equal).
SELECT b.asset, SUM(b.available + b.locked) AS held,
       (SELECT COALESCE(SUM((a.metadata->>'delta')::numeric), 0) FROM "AuditLog" a
         WHERE a.action = 'DEMO_BALANCE_ADJUSTED' AND a.metadata->>'asset' = b.asset) AS credited
FROM "DemoBalance" b GROUP BY b.asset ORDER BY b.asset;
```

On production this equality holds only if no other writer touches DemoBalance. The native private-trading allocations
and VTA demo sales do. So compare the **liquidity account's** movement against its own receipts instead:
`SELECT side, SUM(price*"originalQuantity"), SUM("originalQuantity") FROM "DemoOrder" WHERE "userId" = '<id>' GROUP BY side;`

**Rollback:** unset `DEMO_LIQUIDITY_ENABLED` and restart only the API (withdrawals need no switch since Issue #617).
- Quotes stop at once.
- No order rests, so nothing is left to clean up.
- Balances and receipts stay as they are.
- No database restore.

## Open / owner decisions

1. **Spread and caps:** defaults are 10 bps, 1 000 USDT per order and 10 s reference age. The owner may choose
   others.
2. **Passive LIMIT orders** fill only against other testers, never against the moving reference. A resting quote
   would need its own repricing/expiry policy (a background job). This was deliberately not built: a stale resting
   quote is the main risk this design avoids.
3. **Inventory drift:** testers who buy more than they sell drain the BTC side, which then refuses BUYs
   (`NO_LIQUIDITY`, the existing refusal) until the admin tops it up again. There is no automatic rebalancing,
   by design.
4. **Order book display:** the terminal still shows the market reference book (display data). The internal quote
   is transient: it exists only for one taker inside one transaction and is not published as firm, executable public
   depth. Fills are near the displayed prices (± spread).
