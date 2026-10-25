# Wallet Conversion — financial isolation and invariants (Issue #617)

Independent code-level review of PR #591 on base `main` `98261cc8`. Reviewed head: the commit that adds this file;
the previous head was `780b2901`.

**Коротко для власника.**
- Шляху, яким демопоповнення стає реальним балансом або грошима для виведення, у коді **немає**. P0 не знайдено.
- Знайдено й виправлено одну помилку **P1**. Коли ціновий фід падав під час підтвердження, сервер відповідав 500, а інтерфейс показував «результат невідомий». Тепер це однозначна відмова: нічого не списано, обмін треба перерахувати.
- Лишається один **умовний** шлях. Він існував до конвертації і стосується лише нативних Cross-гаманців тестерів. Він відкривається, тільки якщо вимкнути **всі** три перемикачі: Demo Spot, демоліквідність і захист виведення. Поки ввімкнений хоча б один із перших двох, шлях закритий.
- Рішення: **NO GO для активації**, доки ви не погодите цифри (розділ 6). **GO** для подальшого рев'ю як Draft. Обидва перемикачі вимкнені.

## 1. Scope and method

- Code: `src/services/WalletConversionService.ts`, `src/api/routes/walletActivity.ts`, `frontend/src/pages/wallet-v3/ConversionModal.tsx`, plus every writer of `Balance`, `FuturesBalance`, `DemoBalance` and `Withdrawal` on the base.
- Evidence comes from code paths (file:line) and from tests that run on a **fresh disposable PostgreSQL** cluster:
  - `scripts/test-wallet-conversion-postgres.cjs`: `Balance` ledger, 25 checks, plus a browser phase in CI;
  - `scripts/test-wallet-conversion-demo-postgres.cjs`: `DemoBalance` ledger, 24 checks;
  - `src/services/__tests__/WalletConversionService.test.ts`: unit;
  - `frontend/src/lib/__tests__/walletConversion.test.ts`: UI contract.
- Green tests are not treated as proof on their own. Two deliberate mutations were run against the demo test to show it fails when the code is wrong:
  - an unconditional debit;
  - the confirm-time ledger re-check removed.
- The new outage check also failed on the previous head `780b2901` before the fix (section 5, P1-1).
- Not reviewed: production configuration or data. Production flag values come from the Issue #592 record of 2026-10-23 (Demo Spot, Demo Liquidity and the guard all ON). I did not read production.

## 2. Ledger map: can demo value reach a withdrawable asset?

**Withdrawable** here means any asset that can leave VOLTEX through an admin-processed request. Those are a `Withdrawal` row and an OTC cash-out. Both draw on `Balance`. `FuturesBalance` is included because it transfers back into `Balance`.

| Writer (base `98261cc8`) | Ledger | Funded from | Demo input? |
|---|---|---|---|
| `WithdrawalService.requestWithdrawal` (`src/services/WithdrawalService.ts:63`) | debits `Balance` | `Balance` | no |
| `OtcCashService` (`src/otc/OtcCashService.ts:85`; simulation-only users refused at `:77`) | debits `Balance` | `Balance` | no |
| `WalletTransferService` (`src/services/WalletTransferService.ts:12-16`) | `Balance` ↔ `FuturesBalance`, same user | the other real ledger | no |
| Futures / CFD / liquidation / funding (`src/futures/*`, `src/cfd/*`) | `FuturesBalance` | `FuturesBalance` margin, real prices | no |
| `OrderService` (real Spot) | `Balance` | `Balance`; the real book never matches the demo book | no |
| `banking/service.ts` (principal locked from `WALLET_AVAILABLE` `:133`, rewards `:240`, `:255`) | `Balance` | `Balance` principal | no |
| `PurchaseService`, `DepositBatchService` (admin-confirmed), `BalanceAdjustmentService` (admin), `listings/ownerAllocation`, `testMarkets/nrxAllocation` (ADMIN owner only) | `Balance` | admin action or real deposit | no |
| `WalletConversionService` `'spot'` path (`:327-338`) | `Balance` ↔ `Balance`, same user | `Balance` | no |
| `DemoTradingService` (`:390-419`), `VtaDemoSales` (`:91-94`), private trading (`src/private-trading/store.ts:80`), native Cross init (`src/private-trading/native/store.ts:258`), Stocks test cash (`services/stocks-global/postgres-authority.mjs:130`), `WalletConversionService.settleDemo` (`:348-361`) | `DemoBalance` (and the demo containers fed from it) | `DemoBalance` | — |

- **Code fact.** No file writes both a real ledger (`Balance`/`FuturesBalance`) and `DemoBalance`. Demo containers (`NativeDemoAccount`, private trading, `StocksTest*`) only ever take `DemoBalance`. None of them writes a real ledger.
- **No user-to-user transfer.** There is no user-to-user (P2P) transfer route, and the only transfer is the user's own Spot↔Futures.
- **The only demo-valued exit** is the *unheld* withdrawal request of a native Cross wallet: the owner or `PRIVATE_TRADING_TEST_USER_IDS`. Its value comes from the native wallet's valuation of `DemoBalance` (`src/private-trading/native/withdrawable.ts:19-41`). It is refused while `demoWithdrawalGuardEnabled()` is on (`src/api/routes/withdrawals.ts:109,142`; `src/services/WithdrawalService.ts:60,137`). The guard is forced on by `DEMO_SPOT_ENABLED` or `DEMO_LIQUIDITY_ENABLED` (`src/services/demoSpotAccess.ts:40-41`). See P1-2.

## 3. How conversion picks a ledger, and why it cannot cross

- **Ledger choice.** `ledger()` (`WalletConversionService.ts:193`) uses `demoSpotLedger` (`demoSpotAccess.ts:67`):
  - `'demo'` only while Demo Spot is ON, and only for an admitted account (an ADMIN, or a USER with a `DEMO_BALANCE_ADJUSTED` credit) that is unblocked and holds no ordinary non-test `Balance`;
  - every other account settles on `'spot'`.
  - The quote stores the ledger. The confirm re-reads it under the account lock and refuses a change (`:320`).
- **The demo swap** (`settleDemo`, `:348`) runs in the confirm transaction:
  - it takes the account lock (`:312`), then the `demo-spot-book` lock shared with every demo Spot fill;
  - the user's debit and the liquidity account's debit are conditional (`available >= amount`);
  - credits go to the other side, and the receipt is `WALLET_DEMO_CONVERTED` with id `conversion:<quoteId>`;
  - all of it commits or rolls back together;
  - the backing is the Demo Liquidity account's already-credited `DemoBalance`, so nothing is minted.
- **A demo conversion can never:**
  - write `Balance` or `FuturesBalance`;
  - create a `Withdrawal` or OTC row;
  - count towards `Balance` reserve exposure (`exposure()` reads `WALLET_CONVERTED` only, `:218`).
- **Withdrawals and OTC** hold `Balance` only. The demo result is never there.

## 4. Invariant matrix (expected = actual unless marked)

Abbreviations below: **PG-B** = `test-wallet-conversion-postgres.cjs`, **PG-D** = `test-wallet-conversion-demo-postgres.cjs`, **U** = unit test, **FE** = frontend contract test.

| # | Scenario | Expected | Evidence | Result |
|---|---|---|---|---|
| 1 | Demo funds reach `Balance` / a withdrawal | never | §2 code map; PG-D «the demo result cannot be withdrawn…» (400 `Insufficient BTC balance`, native 403 `DEMO_FUNDS_NOT_WITHDRAWABLE`, 0 `Withdrawal` rows); PG-D final check: no demo account holds a `Balance` row | PASS |
| 2 | New account, zero balance | nothing quotable, no row created | PG-D «new account with zero balance…»; PG-B «account without owner/admin-issued funds…» | PASS |
| 3 | Insufficient demo funds (at quote; spent by a demo order after the quote) | `INSUFFICIENT_BALANCE`, nothing moves | PG-D «insufficient demo funds…» | PASS |
| 4 | Mixed wallet (both `Balance` and `DemoBalance`) | converts on `Balance` only; `DemoBalance` untouched | PG-D «an account holding ordinary Balance…»; U «an account with ordinary Balance stays on Balance» | PASS |
| 5 | Ledger changes between quote and confirm | `QUOTE_CHANGED`, nothing moves | PG-D «an account that gets ordinary Balance after its demo quote…»; mutation-checked | PASS |
| 6 | `Balance` reserve exhausted; demo liquidity exhausted | refuse at quote / confirm; never over the reserve or the inventory | PG-B «reserve: many accounts…»; PG-D «concurrent conversions can never take more than the liquidity inventory holds» | PASS |
| 7 | Concurrent conversions and demo orders on one balance | never overdrawn; every unit accounted for | PG-B «withdrawals and many conversions race…»; PG-D «concurrent demo orders and conversions…» + `DemoBalance` conservation after every demo check | PASS |
| 8 | Stale quote / changed price / feed down at confirm | `QUOTE_EXPIRED` / `QUOTE_CHANGED` / `PRICE_UNAVAILABLE`, nothing moves | PG-B «expiry, changed price, outage…» (outage code now asserted); PG-D «stale, changed or missing price…» | PASS after fix P1-1 (was a raw 500) |
| 9 | Cancelled / abandoned quote | there is no cancel: a quote reserves nothing and expires 15 s after the feed time | PG-D same check (full balance quotable again; expired → `QUOTE_EXPIRED`) | PASS |
| 10 | Atomic rollback | any failure after a debit undoes every leg | PG-B «audit insertion failure rolls back BOTH balance legs», «destination write failure…»; PG-D «rollback: a failed receipt write undoes all four DemoBalance legs; a short liquidity leg undoes the user debit» | PASS |
| 11 | Repeated request / double click / lost response / restart | one receipt, one debit; replay returns the same receipt, also with the feed down | PG-B «lost response…», «as after a restart…», «concurrent expiry…»; PG-D «double confirm click…», «lost response…», «after a restart…» | PASS |
| 12 | Other account / permissions | another user can neither confirm nor read a quote or receipt; revoked session 401; blocked account refused, also after the quote | PG-B «expiry … other owner…», «anonymous, deleted, revoked-session and pending-2FA…», «an admin block…»; PG-D «another account…», «session revocation…», «blocked account…» | PASS |
| 13 | 0% fee keeps the spread | source at bid, destination at ask; a round trip returns less | PG-B «0% fee keeps the market spread…»; PG-D exact `toAmount` at bid/ask | PASS |
| 14 | Rounding to zero / finer than the asset | `INVALID_CONVERSION` before any write | U «the result rounds DOWN once…»; PG-D «rounding to zero and oversized requests…» | PASS |
| 15 | Large request | over 1000 USD → `LIMIT_EXCEEDED`; over 18 integer digits → `INVALID_CONVERSION`; no quote row | PG-B «single-conversion limit…»; PG-D same check | PASS |
| 16 | Daily limit across both ledgers | committed receipts of 24 h, demo + `Balance` | PG-B «daily limit…» (concurrent); PG-D «daily limit counts demo conversions» | PASS |
| 17 | Listing / simulation assets (VTA, NRX, AITH, managed listings) | never admitted, on either ledger, even when priced | PG-B «admission…»; PG-D «listing and simulation assets…» | PASS |
| 18 | Switches | server OFF → no route at all; Demo Spot or Demo Liquidity OFF → demo funds convert nothing | PG-B «default-OFF…» + OFF browser build; PG-D «default-OFF server switch…», «switches…» | PASS |
| 19 | Third-party balances | unchanged | PG-D «third-party balances unchanged…» | PASS |
| 20 | UI messages | every refusal code is a definite refusal with its own message; only a transport failure is «unknown» | FE (every code mapped; `PRICE_UNAVAILABLE` definite at confirm) | PASS after fix P1-1 |

## 5. Findings

**P0 — none found.** No code path turns demo value into `Balance`, `FuturesBalance`, a `Withdrawal` row or OTC cash-out.

**P1-1 — fixed in this commit.** A provider failure surfaced as an unexpected error.
- **Before:** at confirm, `prices.read()` failing (for example a Kraken socket error) was re-thrown raw. The route answered 500, so `ConversionModal` showed «result not confirmed» and kept the pending state, although nothing had been debited. The same happened at quote and assets time, and a throwing `depth()` did the same.
- **Fix:**
  - `feed()` (`WalletConversionService.ts:230`) maps any non-`ConversionError` to `PRICE_UNAVAILABLE` (503);
  - `admit()` treats a failing depth read as unknown depth (`INSUFFICIENT_LIQUIDITY`);
  - `ConversionModal` lists `PRICE_UNAVAILABLE` as a definite refusal at confirm. That is safe: the server decides it inside the transaction, after the receipt check and before any write.
- **Tests:** PG-B outage now asserts the code, PG-D adds the outage case, plus a new unit test and the FE assertion.

**P1-2 — pre-existing on `main`, configuration-dependent, not introduced by #591.**
- **The path.** A native Cross wallet (owner, `PRIVATE_TRADING_TEST_USER_IDS`) is valued from `DemoBalance` and can file an *unheld* withdrawal request that an admin pays by hand. The guard refuses it, and the guard is forced on only while `DEMO_SPOT_ENABLED` or `DEMO_LIQUIDITY_ENABLED` is on.
- **When it reopens.** If an operator turns Demo Spot, Demo Liquidity **and** `DEMO_WITHDRAWAL_GUARD_ENABLED` off, the request path reopens for every demo-valued native wallet. Demo top-ups alone are enough; demo conversion results would count too, because they also sit in `DemoBalance`.
- **Why conversion does not depend on it.** A demo conversion itself can only run while Demo Spot is on, so the guard is on whenever one runs.
- **Removal criterion (owner decision; it changes withdrawal behaviour):** make the guard permanent for demo-valued requests. Proposed patch, not applied here: in `withdrawals.ts:142` and `WithdrawalService.requestUnheldWithdrawal`, refuse when the guard is on **or** the account has any `DEMO_BALANCE_ADJUSTED` / `WALLET_DEMO_CONVERTED` history.
- **Until then, activation precondition:** never switch Demo Spot, Demo Liquidity and the guard all off while demo-valued native wallets exist.

**P1-3 — pre-existing (#592), documented.**
- Admin `Balance` credits have no provenance and stay requestable for withdrawal (`WithdrawalService` on `main`).
- **Conversion does not widen this by default.** A `Balance` conversion needs an operator-verified reserve per destination, and `WALLET_CONVERSION_RESERVES` defaults to empty. With no reserve configured, every `Balance` conversion is refused (`RESERVE_UNVERIFIED`).
- If reserves are configured, a `Balance` conversion can change which asset such a credit is held in. Its market value can only go down (bid/ask).

**P2.**
- **(a) Wallet display.** The Wallet Funding view lists `Balance` only. A demo-ledger tester sees demo results in the conversion form, the history (`ledger: 'demo'`) and the Spot terminal, but not in the Funding table. This is a UX gap, not a financial one.
- **(b) Per-order cap units.** The Demo Liquidity per-order cap is denominated in the quote asset (USDT). The conversion compares the source's USD value against it, so there is a small USDT/USD difference.
- **(c) Quote rows.** Each preview writes one `AuditLog` row (20/min/user).
- **(d) Destination inventory.** A demo destination needs inventory on the liquidity account for that asset. Assets with no inventory are refused as capacity.

## 6. Numbers that need the owner's decision (all current settings, none approved)

| Setting | Current | Applies to |
|---|---|---|
| `WALLET_CONVERSION_MAX_USD` | 1000 | both ledgers, per conversion, at the source's bid |
| `WALLET_CONVERSION_DAILY_USD` | 5000 | both ledgers together, per account, rolling 24 h |
| `DEMO_LIQUIDITY_MAX_ORDER_QUOTE` | 1000 (Demo Liquidity default) | demo conversions and demo Spot fills |
| Demo Liquidity inventory per asset (USD, EUR, USDT, USDC, BTC, ETH) | unknown on production | caps every demo destination |
| `WALLET_CONVERSION_RESERVES` | empty → no `Balance` conversion | `Balance` ledger only |
| `WALLET_CONVERSION_ASSETS` | `USD:2,EUR:2,USDT:6,USDC:6,BTC:8,ETH:18` | both ledgers |

Policy fit:
- Conversion caps equal the liquidity per-order cap (1000).
- A single tester's 24 h ceiling (5000) can drain at most that much of any inventory asset per day. The inventory, not the limit, decides how many testers can convert.

## 7. GO / NO-GO

- **Code review:** GO to continue as Draft, with no P0 open.
- **Activation:** NO-GO until the owner:
  - approves section 6;
  - decides P1-2;
  - credits Demo Liquidity inventory for each destination asset to be offered.
- Both switches stay OFF. No merge or deploy. No production read or write.

**Unknown / not verified:**
- production flag values and liquidity inventory (taken from the #592 record);
- Kraken EUR/USD book availability on the day;
- legal classification of a demo conversion.
