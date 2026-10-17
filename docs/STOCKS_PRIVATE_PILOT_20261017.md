# Stocks private pilot — operator preflight (read-only)

Source: post-merge main `b27bca2786f7a8a438980106581701fedf3159b4` (2026-10-17).
This is not production launch authorization, a migration plan or a data licence.

## 1. Required separate decisions

- Two immutable `User.id` values confirmed privately as the owner and Ksenia. Never infer these from display names, public profiles, email prefixes or frontend selectors. `STOCKS_TRADE_PRINCIPALS` must contain exactly two `{issuer,subject}` pairs; owner verifies names against authenticated admin records. Do **not** paste them into Git, comments, CI or chat.
- Confirm existing User/Session and `DemoBalance USDT`. Do not create a new wallet or reset funds. The read-only script prints only counts, not IDs or amounts.
- The additive Stocks migration must be reviewed and explicitly applied in a later controlled release with backup/restore proof. No `prisma migrate deploy` as part of this preflight.
- Stocks API remains disabled (`STOCKS_TEST_CASH_ENABLED` absent/false). Frontend `VITE_STOCKS_ENABLED` absent/false; Binance WS `STOCKS_BINANCE_WS_ENABLED` absent/false. Never turn these on as part of preflight.
- Preserve private loopback-only Stocks service; no public proxy until Host/Origin/CSRF and session routing are reviewed, with an authenticated limited-access path for 50 viewers and two traders.

## 2. One bounded, read-only verification on Hetzner (operator-run only)

Use the **already configured** environment of the actual API container and a read-only database role where supported. Do not print environment values. Only after approving a read-only database connection, set `STOCKS_PILOT_READONLY_ACK=READ_ONLY` in the invoking process and run:

```sh
node services/stocks-global/pilot-preflight.cjs
```

Required private variables: `DATABASE_URL`, `STOCKS_IDENTITY_ISSUER`,
`STOCKS_TRADE_PRINCIPALS`. Do not run against an unknown database.
The code executes `SET TRANSACTION READ ONLY` and finite SELECTs, checks two
accounts are present/not blocked, existing USDT DemoBalance is available,
unrevoked Session rows exist, and migration status. No balances, passwords or
tokens are displayed. **PASS means only DB structural precheck**, not
confirmation the IDs belong to the requested people, no rights clearance,
no live authentication, no trading acceptance or deployment permission.

If migration is not applied, the result is `BLOCKED`, by design. Do not
make the test pass by modifying the production DB or test assertions.

## 3. First isolated acceptance — after separate approval

- Use synthetic, clearly labeled quotes in a private non-public environment until a specifically applicable licence and instrument/source provenance are confirmed. No external exchange orders or providers in synthetic tests.
- Reuse exact-head financial evidence (21 disposable PostgreSQL, 24 two-trader/ledger, 32 Jest, 16 WS tests) and prior 351/119 checks; do not run a new 24-hour monitor or broad CPU audit.
- One finite matched target-host test only once a representative isolated CX23 clone is ready: baseline crypto workload vs crypto + Stocks with **50 read-only viewers and 2 fixture traders**, same workload and settings. Record total requests, timeouts, crypto p95 before/after, server CPU/RAM, quote starts and DB contention. Crypto degradation must be at most **+5%**. Old Windows diagnostic was **+14.3481% FAIL**; WS wiring alone is not proof of resolution. Stop on failure; retain failed evidence.
- Before activating the real private account bridge: verify permissions on each request and immediately before commit, idempotency, existing USDT authority, reauthentication/revocation, missing quote denial, stop/restart and lost-ACK recovery. No double funding and no simultaneous wallet mutation bypass.
- Node runtime compatibility must be verified on actual Hetzner image: the opt-in `stocksTestCashRouter` lazy load documents Node 24 require(ESM) behavior. No assumption that production has that runtime.

## 4. Data rights and live enablement

For live Binance/Bybit/xStocks prices, check the exact **commercial display and redistribution** licence for provider, endpoint, instruments, user count, geography, derived candles and screenshots. Availability of public endpoints is not licence. Never substitute Binance `AAPLB` for Bybit `AAPLX` or xStocks issuer reference without explicit instrument/multiplier mapping. Sources:
- Bybit API terms: https://www.bybit.com/en/help-center/article/API-Terms
- Binance Vision *historical dataset* terms: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md (not proof of live REST/WS licensing)
- xStocks developer integration: https://docs.xstocks.fi/developers

Keep the original public provider flags OFF until written rights and separate
owner approval. This runbook deliberately does not contain a production
deployment or credentials-changing command.
