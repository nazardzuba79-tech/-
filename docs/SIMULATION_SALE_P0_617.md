# Issue #617 P0: the Spot "simulation sale" minted withdrawable USDT

**Коротко для власника.**
- **Знахідка.** Незалежна перевірка #620 (27.10) знайшла шлях, яким модельна, тобто несправжня, вартість стає грошима для виведення. Він був на `main` ще до #620 і не пов'язаний із `DemoBalance`.
- **Механізм.** Власник, адмін або тестер ставить ринковий продаж NRX чи лістингового токена. Сервер не виставляє його в книгу, а «продає симуляції» за ціною моделі і зараховує звичайні USDT у Spot. Ці USDT можна вивести або передати звичайному користувачу через реальну книгу.
- **Виправлення.** Цей Draft зупиняє такий продаж для **будь-якого** симульованого активу (NRX, керовані лістинги, тестові ринки) ще до будь-якого запису. Звичайні пари (BTC, ETH…) не змінюються.
- **Потрібне ваше рішення.** 19.10 ви вирішили, що продаж NRX власником лишається «як є». Це виправлення його змінює. Без вашого рішення не зливати. Варіанти — у розділі 4.

## 1. What happened (main `63d6b02c`, and #620 `5b80fc3e` alike)

`OrderService.placeOrder` sends every `SELL` + `MARKET` of an ADMIN, or of a simulation-only user (`isSimulationOnlyUser`: the private-trading owner and `PRIVATE_TRADING_TEST_USER_IDS`), to `sellTeamSpotSimulation`.
- That function never touches the book.
- It credits `price × quantity` of the quote asset to the ordinary Spot ledger (`mutateSpotBalance`), against the synthetic maker `simulation:<base>`.
- For NRX the price is the model price (`simulationFor(NEURIX).priceAt`); #551 already stopped managed listings.

The credited USDT cannot be told apart from deposited USDT:
- it is requested through the ordinary held withdrawal (`WithdrawalService.requestWithdrawal`);
- it is spent on the real book.

### Independent reproduction

All three ran on a disposable PostgreSQL through the real routes with real JWTs, on #620 `5b80fc3e`. Evidence: the verifier's `run3.log`, section S7.

| # | Path | Observed |
|---|---|---|
| P0-1 | `allocateNrxOwner` credits 6250 NRX with no USDT debit. The owner (ADMIN) makes a MARKET SELL of 6000 at the model price 6897.4541. | **+41,384,724.6 USDT** in `Balance`. Withdrawals reached **SENT** in four setups: private trading off; on with no Cross account; on with the reader absent; every demo switch on. |
| P0-2 | A simulation-only tester (USER, no Cross account) buys 100 NRX at 0.01 on the real book and sells them to the simulation. | **+689,744.41 USDT**, withdrawal **SENT** |
| P0-3 | The owner bids 40 000 USDT for 1 NRX on the real book. An ordinary USER sells 1 NRX bought at 0.01. | the USER holds **40 000.99 USDT**; withdrawal of 15 000 **SENT** |

Every withdrawal still needs manual admin approval: nothing is paid automatically. By the #617 definition, demo or simulated value leaving as a payable claim is P0.

## 2. Fix in this candidate

- **`OrderService.sellTeamSpotSimulationOnce`:** for any simulated asset (`isTestAssetPairOrSymbol`), it refuses with *Simulation Spot sale is not available for this listing* after the canonical price read and before any write. That covers NRX, every managed listing and every test market.
  - It writes no order, trade, balance or audit row.
  - The now unreachable NRX audit/source branches are removed.
- **Unchanged:**
  - the listing gates;
  - the normal book path for everyone (owner LIMIT orders, user BUY/SELL);
  - ordinary pairs' sale at the venue price (see 5);
  - allocations;
  - withdrawals.
- **Merged as a base:** #551 (`a9aee9cc`, another Claude session), which had already stopped the managed-listing case. Its tests are kept.

## 3. Tests

`src/services/__tests__/simulationMintFence.pg.test.ts` (new, disposable PostgreSQL, runs in `nrx-market.yml`):
- the owner with allocated NRX: the sale is refused, nothing is written, the USDT supply is unchanged, and only the real 1000 USDT can be requested;
- a simulation-only tester with book-bought NRX: refused, nothing written, no new withdrawable USDT;
- concurrent attempts and attempts after a service restart: never any USDT.

**RED on the unfixed tree (main + #551): 3/3 fail**, "promise resolved instead of rejected". GREEN after the fix.

Changed expectations, all now **stricter** (nothing is written):
- `nrxSpot.pg.test.ts`:
  - «owner MARKET SELL executes against `simulation:NRX`» is now «refused, nothing written»;
  - «31,250 inventory sells half, then the remainder» is now «no sale, also after restart»;
  - «locked NRX» refuses with the new message, and no writes is unchanged.
- `managedListingSimulationSale.pg.test.ts`: the NRX half of «unchanged» is now «refused, nothing written». The ETH half is unchanged.

Local run (Node 22.23.3, disposable PostgreSQL 16, synthetic data): 13 suites / 174 tests pass:
- the new suite and NRX Spot PG;
- managed-listing sale PG;
- `OrderService`, `WithdrawalService`, `withdrawals`, `PriceWatcherService` and `WalletPortfolioService`;
- the NRX serving and public suites, `testMarkets` and `simulationOnlyIsolation`.

Backend `tsc` passes.

## 4. Owner decision (one of)

| Option | What the owner gets | Withdrawable model value |
|---|---|---|
| **A — this PR (recommended now)** | NRX and listing MARKET SELL by the owner or a tester is refused. They sell to real users with LIMIT orders on the book, like everyone else. | none |
| B — settle into `DemoBalance` | The synthetic sale keeps working, but its proceeds land on the demo ledger, which #620 never lets out. Needs a separate change and a UI view of the demo balance. | none |
| C — `SIMUSDT` restricted unit (#552 / #553 design) | Simulated pairs are quoted in a non-withdrawable unit. A larger change in the History20 package (Codex). | none |
| keep main as is | the 19.10 behaviour | **yes, P0 stays open** |

## 5. Not changed here (documented)

- **P1:**
  - an ADMIN or simulation-only MARKET SELL of an **ordinary** asset still fills against `simulation:<base>` at the venue price;
  - the value is equivalent at the feed price, but no real counterparty exists (a treasury/hedging question);
  - the verifier saw 1 BTC become 100 000 USDT at the fixture price.
- **Existing balances.** USDT already minted on production by earlier simulation sales stays in those accounts. It can still be spent on the book or requested.
  - The operator should run the read-only queries below and the owner should decide reconciliation.
  - Nothing is changed or cancelled automatically.
- **P2** (verifier): `approveWithdrawal` does not check that a `balanceHeld=true` row is backed by a lock. Reaching that needs direct database tampering.

### Read-only operator queries (production; no writes)

```sql
-- Model-priced proceeds ever credited to Spot by the synthetic sale, per account and asset.
SELECT "userId", metadata->>'asset' AS asset, metadata->>'quote' AS quote,
       count(*) AS sales, sum((metadata->>'proceeds')::numeric) AS proceeds
FROM "AuditLog"
WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD')
GROUP BY 1, 2, 3 ORDER BY proceeds DESC;

-- Withdrawals requested by those accounts since their first synthetic sale.
SELECT w."userId", w.asset, w.status, count(*), sum(w.amount)
FROM "Withdrawal" w
JOIN (SELECT "userId", min("createdAt") AS first_sale FROM "AuditLog"
      WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD') GROUP BY 1) s
  ON s."userId" = w."userId" AND w."createdAt" >= s.first_sale
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- Real-book trades in which those accounts paid quote currency to someone else (P0-3 route).
SELECT t."takerUserId", t."makerUserId", t.pair, count(*), sum(t.price * t.quantity) AS quote_amount
FROM "Trade" t
WHERE t."makerUserId" NOT LIKE 'simulation:%'
  AND (t."takerUserId" IN (SELECT DISTINCT "userId" FROM "AuditLog" WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD'))
    OR t."makerUserId" IN (SELECT DISTINCT "userId" FROM "AuditLog" WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD')))
GROUP BY 1, 2, 3 ORDER BY quote_amount DESC;
```

The column names follow `prisma/schema.prisma` on `main`; verify them against production before running. These queries were not run here: this session has no production access.


## 6. Follow-up: private DemoBalance settlement candidate (default OFF, 27 October)

The owner requested preserving NRX MARKET SELL without turning model-priced proceeds into withdrawable USDT. This candidate adds server-only `SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED` (absent/false by default). With the flag OFF, the original fail-closed refusal and tests remain unchanged. When explicitly enabled for a reviewed private environment, the existing server-allowlisted ADMIN/tester synthetic sale debits the source asset from normal `Balance` and atomically credits the modeled quote proceeds **only** to `DemoBalance` (Decimal(36,18)). The `Order`/`Trade` audit path is retained for request-ID replay; the audit entry now identifies `settlementLedger: DemoBalance` and `withdrawableProceeds: false`.

The dedicated disposable PostgreSQL suite additionally proves a filled NRX synthetic sale, unchanged real USDT supply, unchanged real USDT withdrawal allowance, one-time credit after retry/restart, and insufficient-inventory rollback. The existing OFF-gate regressions stay in place.

**Release limitation:** The demo proceeds need explicit portfolio UI labeling before any customer-facing activation. This branch does not enable the flag or deploy. It does not remove the separately documented real-orderbook risk (P0-3) from unbacked/mispriced listing tokens, nor the legacy minted USDT. Both require distinct reconciliation and settlement analysis; do not claim global financial go-live.
