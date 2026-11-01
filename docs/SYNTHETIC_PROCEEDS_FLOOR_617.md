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
- **Futures.** Not counted in real value (conservative). Correction (review 1 Nov): Futures fills ARE user-vs-user (FuturesPositionService matches other users' resting orders), so a held account places no Futures order and its legacy resting Futures orders never fill.
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

## 1 Nov 2026 (owner decision) — temporary provenance quarantine, not confiscation

Owner decision on PR #630 (comment 6554357792): identified unverified legacy synthetic USDT and its derived
proceeds are held while origin is reconciled. Implemented server-side in `syntheticProceedsFloor.ts`:

| Account | Status | Cash-out (withdrawal create/approve/SENT, OTC reserve/payout, Spot→Futures, Banking principal) | Spot order / fill |
|---|---|---|---|
| No simulation-sale receipt (every ordinary customer, admin `BALANCE_ADJUSTED` alone) | `CLEAR` | never priced or refused | unchanged |
| Receipt(s) `NRX_SIMULATION_SOLD` / `TEAM_SPOT_SIMULATION_SOLD` (S > 0), no decision | `UNVERIFIED` (default hold) | **always refused** | refused if it lowers the account's worst-case value at the marks (overpaying, self-trade, old adverse resting order); value-neutral trades allowed |
| After an admin `RELEASE_TO_FLOOR` decision | `RELEASED_TO_FLOOR` | only realized stable cash (USDT/USDC) above S | may not take the account below S |

- Decisions: `POST /admin/synthetic-provenance/:userId/decision` (`requireAuth` + `requireAdmin`), body
  `{decision: QUARANTINE | RELEASE_TO_FLOOR, reason (10–1000 chars), requestId}`. Each is one append-only
  `AuditLog` row `SYNTHETIC_PROVENANCE_DECISION` {seq, decision, reason, adminId, requestId}; latest seq wins;
  serialized with every outflow by the account's floor lock; requestId replay returns the recorded decision,
  reuse for a different decision is refused. An unreadable decision row counts as QUARANTINE and wins.
  `GET /admin/synthetic-provenance` lists identified accounts with status and history (no balances).
- User status: `GET /withdrawals/restriction` → `NONE | UNDER_REVIEW | FLOOR`; refusals return code
  `SYNTHETIC_PROCEEDS_LOCKED` with "under provenance review" message.
- Never: debit, zero, relabel to DemoBalance, delete, cancel paid obligations. Reject of a held withdrawal and
  order cancellation stay available. A decision writes only its audit row.
- Operator preflight (read-only, aggregates only): `scripts/synthetic-provenance-preflight.sql` inside
  `BEGIN TRANSACTION READ ONLY` — identified accounts, malformed receipts, accounts on hold, open/sent
  withdrawals, trades with other accounts after the first synthetic sale, open orders, non-zero Futures balances.
  Downstream accounts that received value from an identified account are NOT automatically held: the preflight
  counts the trades; any further account needs its own evidence and owner review.
- Tests (disposable PostgreSQL 16): `syntheticProvenanceQuarantine.pg.test.ts` 11/11 — owner counterexample at
  marks 120000/30000/60000, cross-ledger paths, laundering via accomplice/market/old resting order, value-neutral
  partial fills, pre-filed withdrawal approve/SENT refused + reject, genuine excess after release (reversible),
  concurrent withdrawals, many accounts + innocent user, malformed receipt/decision/missing price, decision
  idempotency, read-only preflight. Mutation (quarantine branch disabled) → 6/11 fail.
- Not deployed. Live API `/health` still reports `3636cf80`. Operator step: compose over the actual running API
  after the #668 security hotfix, backup, run the preflight read-only, deploy, then confirm with the preflight that
  `accounts_on_hold` equals the identified count. Rollback: previous API image (no schema change, no data to undo).

### Owner correction 2026-11-01 (comment 6554371962): realized ≠ verified

- While `UNVERIFIED`, the only value that can leave is a **USDT/USDC withdrawal of independently evidenced genuine
  deposits**: `Deposit` rows of the account that are `CREDITED`, proven on-chain (`verifiedAt`) and not ignored.
  All the account's non-rejected stable withdrawals together must stay within that sum, and the stable cash left
  must still cover S — a deposit spent in trading counts as consumed. Admin `BALANCE_ADJUSTED` credits, trades,
  transfers and sale proceeds are never evidence.
- Mandatory regression (PG): synthetic 100000 → buy 1 BTC at 60000 → sell at 120000 → withdrawals of 160000,
  60000 and 1 all refused, Spot→Futures refused. Positive: an evidenced 10000 deposit is withdrawable (10000 yes,
  10001 no), approved and SENT; next to synthetic profit only the 10000 leaves; spent, unproven, ignored or
  admin-credited funds are refused; two concurrent 10000 withdrawals → exactly one.
- OTC, Spot→Futures, Banking and non-stable withdrawals stay fully refused while UNVERIFIED.
- `RELEASE_TO_FLOOR` remains an explicit audited admin decision after manual provenance resolution; nothing
  releases automatically.

### Owner review 2026-11-01 (comment 6554472895): no Spot execution at all while UNVERIFIED

A fair-price fill still hands unverified USDT (or base) to an unrestricted counterparty, who could withdraw it.
While `UNVERIFIED`, every Spot path that reaches `assertFloor` with a `before` value is refused regardless of price:
placement (LIMIT, MARKET, conditional, OCO), trigger amendment, conditional activation, and any fill where the
account is maker or taker (an innocent taker hitting its legacy resting order is refused; nothing is written).
Still available: reads, order cancellation (returns the hold to the same account), request-ID replay of an already
committed order, admin REJECT of withdrawals. PG tests: fair-price buy/sell/market/resting with an innocent
counterparty → Balance/Order/Trade/Withdrawal/audit rows byte-identical; the innocent account trades with others and
withdraws normally; the legacy resting order is replayed and cancelled.
Operational note: a legacy resting order of an identified account blocks takers at its price until it is cancelled
(by the account itself or an admin; funds return to the same account). The preflight reports
`open_orders_on_identified`; it should be 0 before deploy, or those orders cancelled right after.

### Downstream exposure (finance gate 6554577049): NOT contained by code

The hold covers only accounts with their own simulation-sale receipts. Value an identified account already moved to
another account **before** the hold (a fair or overpriced Spot fill, a Banking referral reward, a deposit
re-attribution) sits with that counterparty, whose status is `CLEAR`. Code cannot undo that retroactively; it must
be measured and decided.

The read-only preflight now reports, as aggregate counts only (no identifiers, no amounts):
`counterparty_accounts_after_first_sale`, `counterparties_paid_quote_by_identified` (the identified account paid
USDT/quote to them), `counterparties_with_withdrawals_after_contact`, `banking_referral_rewards_from_identified`,
`deposit_reattributions_touching_identified`. PG test: a pre-hold trade paying a counterparty who then withdrew moves
the three counterparty counters by exactly 1 each, and the counterparty stays `CLEAR`.

Release condition: authenticated read-only production preflight shows these downstream counters at **0**. If any is
non-zero, a bounded flow-trace and a recipient-hold policy are a **separate explicit owner decision** (proposal: an
admin may place a specific, evidenced counterparty on the same audited hold with a reason; never automatic, never a
blanket hold of ordinary customers). Not implemented here; #630 must not be described as containing all tainted
proceeds until that is resolved.

### Independent adversarial review 2026-11-01 (multi-agent, read-only) — confirmed findings fixed

| Finding (head reviewed cf551870 / 2c8eb202) | Fix | PG test |
|---|---|---|
| Fair or near-zero-price Spot fills could move value (incl. unvalued alts like SOL) to a counterparty | held account takes part in no Spot execution (6eec3d6a) | innocent counterparty, byte-identical |
| ADMIN / simulation-only MARKET SELL took the house-sale shortcut without any provenance check | `assertNotHeld` before the shortcut | ADMIN MARKET SELL → hold |
| Futures fills are user-vs-user; no provenance check on the Futures path | held taker refused; held legacy maker never fills | held Futures order → hold |
| Product purchases debited Balance with no check | `refuseFloorBound` (any S>0 account) | purchase refused; ordinary account buys |
| Held account's resting order rolled back every ordinary taker crossing it | held users' resting orders are left out of the matching book (stay in DB, cancellable) | innocent taker not refused, never fills it; cancel + replay work |
| Banking placement judged the floor on a SERIALIZABLE snapshot older than the floor lock | Banking principal refused for every S>0 account, released or not | released account → refused |

Rejected by the skeptic pass (not real or out of scope): an admin releasing their own account (admins are the trusted
role; decisions are audited), preflight malformed-receipt counting (diagnostic only; server fails closed), CI path
coverage (extended anyway).
