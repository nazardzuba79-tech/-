# Issue #617: legacy synthetic proceeds and cold listing registry (27.10)

## Коротко (для власника)

- **Проблема.** До #625 продаж NRX або лістингового токена «в симуляцію» зараховував у звичайний `Balance` USDT за модельною ціною. Ці USDT нічим не забезпечені.
  - #625 зупинив нові такі зарахування.
  - Уже зараховані USDT досі можна було:
    - вивести;
    - передати звичайному користувачу через книгу ордерів, виставивши для нього вигідну ціну (наприклад, купити в нього 1 NRX за 40 000 USDT чи продати йому BTC за 1 USDT).
- **Що зроблено.** Нічого не списано, не обнулено і не перекласифіковано. Але ці USDT більше не можуть залишити рахунок як справжня вартість.
  - Рахунок, який колись отримав такі USDT (сума S), після будь-якого виведення чи невигідного для себе ордера має зберегти справжньої вартості щонайменше на S.
  - Справжні кошти понад S виводяться як завжди.
  - Звичайних клієнтів правило не торкається (для них S = 0): їх ніхто не оцінює і не блокує.
- **Холодний реєстр лістингів** (після перезапуску API, поки не прочитано Cloudflare):
  - лістинговий токен, виданий власнику, тепер не можна подати на виведення;
  - його не можна продати «будинку» за ціною біржі, якщо там випадково існує такий самий тикер.
- **Рішення лишається за вами:** як урегулювати вже зараховані синтетичні USDT. Нижче є read-only запит, який показує, чи вони є на production і скільки.

## Rule (`src/services/syntheticProceedsFloor.ts`)

**S (floor).** The sum of `proceeds` over the account's `NRX_SIMULATION_SOLD` / `TEAM_SPOT_SIMULATION_SOLD` audit rows:
- whose pair is quoted in USDT;
- whose base is not a valued real asset;
- that were not settled into `DemoBalance`.

Every version of that sale wrote the audit row in the same transaction as the credit. The read goes through the `userId` index with the Prisma model API, not a raw query: before the Spot transaction the only raw read is its commit-outcome check, and a fault there must still halt the engine. A demo-settled sale (#625 opt-in) adds nothing. A receipt whose amount cannot be read refuses the operation rather than counting as zero.

**Real value.** Counted only for USDT (1), USDC, BTC and ETH, at the venue's last price (`<asset>/USDT`):
- every other asset counts 0, including listings, NRX and anything a cold registry does not recognise;
- open withdrawals that hold `Balance` and held OTC reserves are subtracted;
- every open Spot order is taken at its worst fill: a BUY pays its limit for what the base is worth, a SELL the reverse;
- a MARKET-family conditional is taken at its whole hold (BUY) or at nothing received (SELL);
- for an OCO pair, only the worse leg counts.

**Checks.**

| Operation | Check |
|---|---|
| `WithdrawalService.requestWithdrawal` | After the hold, value ≥ S |
| `approveWithdrawal`, `markSent` | Value ≥ S, inside the row-locked transaction; also applies to requests filed before this change. `rejectWithdrawal` stays open. |
| `OrderService.placeOrder`, `placeOcoOrder`, `updateConditionalOrder` | Inside the Spot book transaction, after the fills: refused if value < S **and** the operation lowered the value. A trade at the market and a listing sale for real USDT therefore stay open even when the account is under its floor. |

**Fail-closed behaviour.**
- An advisory lock per account (`synthetic-floor:<userId>`) serialises these operations.
- Missing prices are refused, never valued at 0.
- A service built without a price source refuses a floor-bound account entirely.
- Accounts with S = 0 never read a price and never take the lock.

**Cold registry.** `isMintedListingAsset` reads the durable `LISTING_OWNER_ALLOCATION` / `NRX_OWNER_ALLOCATION` receipts. It is used by:
- the withdrawal asset check;
- the house-bought sale (`simulatedAsset`), so a minted token is never settled into `Balance`, whatever the in-memory registry knows.

## Evidence (disposable PostgreSQL 16, synthetic users)

`src/services/__tests__/syntheticProceedsFloor.pg.test.ts` (11 cases). It seeds the legacy sale exactly as the live API wrote it: `Balance` credit, `FILLED` order, maker `simulation:NRX`, and the audit row.

**Results:**
- **Unchanged `main` `b2387f96`: 10 FAIL / 1 PASS.** The pass is the positive control: a demo-settled sale must not taint.
- **With the fix: 11/11.**

**What the failures on `main` were:**
- a request for 1 000 000 synthetic USDT was filed;
- a legacy request was approved;
- a 40 000 USDT bid for 1 NRX was placed;
- BTC was sold to an accomplice for 1 USDT;
- a MARKET BUY at 1 000 000 filled;
- under the floor, a buy above the market was placed;
- two parallel withdrawals both passed;
- with prices down, the request still passed;
- a cold-registry TYVN withdrawal was filed;
- a cold-registry house sale credited 500 USDT.

## Not changed / open (owner decisions)

- **Legacy synthetic USDT.** Not debited, zeroed or relabelled: settlement needs your plan. The check below sizes it read-only.
- **Admin `Balance` credits (`BALANCE_ADJUSTED`).** Unchanged. Earlier owner policy: old Balance accounts are left as they are; new tester credits go only through demo top-up. These credits cannot be told apart automatically from manual credits of genuine funds.
- **OTC cash-out.** Already closed to ADMIN and simulation-only accounts (`role === 'USER'`, not simulation-only, on the approved list). It is not wired to the floor.
- **Futures.** Not counted in real value (conservative). Futures settle against the house, not other users, so they are not a path to another account.
- **Conservative counting.** A legacy house-bought sale of a real asset outside the valued set (e.g. SOL) counts towards S. This only ever restricts the owner and test accounts.

## Read-only production sizing (operator, aggregate output only)

```sql
SELECT COUNT(DISTINCT "userId") AS accounts, COALESCE(SUM((metadata->>'proceeds')::numeric), 0) AS synthetic_usdt
FROM "AuditLog"
WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD')
  AND split_part(metadata->>'pair', '/', 2) = 'USDT'
  AND NOT (split_part(metadata->>'pair', '/', 1) = ANY(ARRAY['USDT','USDC','BTC','ETH']))
  AND COALESCE(metadata->>'settlementLedger', 'Balance') <> 'DemoBalance';
```

## 1 Nov 2026 — unrealized-mark cash-out closed (fail-closed, nothing debited)

The counterexample from the 28 Oct review (100000 synthetic USDT → buy 1 BTC at 60000 → mark doubles →
the remaining 40000 USDT became withdrawable) is closed in code:

- **Cash-out** (withdrawal create/approve/SENT, OTC reservation/payout, new Banking principal, Spot→Futures
  transfer — every `assertFloor` call without `before`) now values the account on **realized stable cash
  only** (`FLOOR_CASH` = USDT, USDC; `cashOutMarks`). BTC/ETH at an unrealized mark count zero there.
- **Spot trading** is unchanged: orders are still judged at venue marks, so the account can sell its BTC to a
  real buyer at the market. Realized USDT above S is free; one unit more is refused.
- Only accounts with S > 0 are affected (production read-only sizing on 28 Oct: 1 account). Ordinary
  customers are never priced or refused by the floor.
- Nothing is debited, frozen, relabelled or migrated. No schema, flag or balance change.
- Regression (disposable PostgreSQL): `syntheticFloorCrossLedger.pg.test.ts` — mark rise → withdrawal 40000,
  withdrawal 1, Spot→Futures 1 and OTC all refused; sell BTC at 120000 to a real counterparty → withdraw 60000
  accepted, 60001 refused. RED on the previous rule (1 failed / 12 passed), GREEN now; all 13 financial suites
  205/205.

Still open (owner): the existing synthetic principal S itself — reconcile, settle or keep floor-bound
indefinitely. Release stays NO-GO until the owner accepts this policy.
