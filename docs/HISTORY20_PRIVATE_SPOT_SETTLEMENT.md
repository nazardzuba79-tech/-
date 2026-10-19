# History20 private Spot test mode: why model proceeds are stopped, and the smallest safe design

Owner decision of 2026-10-19 (PR #544):
- the first 20 History20 listings run in a private Spot test mode, open only to the verified owner and the allowlisted testers;
- profit from a model price must not be withdrawable;
- NRX and AITH stay byte-for-byte unchanged.

This note records:
- what this branch enforces now;
- the precise blocker;
- the smallest design that would remove it without a schema migration.

It is a proposal. Nothing here is enabled.

## Enforced now (this branch)

`OrderService.sellTeamSpotSimulation` handles the owner's and testers' MARKET SELL with a synthetic counterparty. Its price now comes from the pair's canonical server source (`spotPriceSource`), the same one used by the Spot ticker, the chart, conditional triggers and wallet valuation. A modeled pair is never priced by the venue.

For a published managed listing (anything other than NRX), the sale then **stops before any write**. Its proceeds would land in ordinary Spot USDT, and that USDT can be withdrawn.

Unchanged:
- **NRX:** the legacy sale.
- **Ordinary pairs:** the sale at the venue price.
- **Everything else:** the listing gates and the normal book path.

Covered by `src/services/listings/__tests__/managedListingSimulationSale.pg.test.ts`. On `main` and on the previous commit `a495d030`, the sale credits USDT; those two cases fail on that code and pass here.

## The precise blocker

The existing data model cannot keep model-priced USDT from being withdrawn.

1. **One fungible row.** The Spot ledger keeps one row per user and asset (`Balance.available` / `locked`). USDT credited from a model price cannot be told apart from deposited USDT.
2. **Withdrawals read that row.**
   - Ordinary accounts and every ADMIN that is not simulation-only withdraw straight from it (`WithdrawalService.requestWithdrawal`; proved in the test above).
   - The owner and testers withdraw from their native trading wallet (`private-trading/native/withdrawable.ts`). They fall back to the same Spot row when that account is not opened or there is no market data (`withdrawals.ts:46`, `withdrawable.ts:20-24`).
3. **USDT can be converted.** USDT spent on an ordinary pair in the internal book can be withdrawn as another asset. A USDT-only cap would not be enough; the restriction would have to follow the value across assets.

## Smallest design without a schema migration (recommended)

Settle History20 private pairs in a **restricted test unit, `SIMUSDT`**, instead of USDT. `SIMUSDT` is already the preview's unit. Balance rows are keyed by asset, so no migration is needed.

1. **Restricted unit.**
   - Add `SIMUSDT` to the restricted-asset guard (`isTestAssetPairOrSymbol`). That refuses it for withdrawals, deposits, adjustments, collateral and transfers.
   - Value it at 0 in wallet equity and in every withdrawal cap.
2. **Per-listing quote.**
   - A History20 window listing trades as `SYMBOL/SIMUSDT`.
   - NRX, AITH and every other listing keep USDT.
   - This touches the Render listing config, the Worker catalogue and the frontend's pair routing.
3. **Exact admission.**
   - A History20 window admits orders only from `isSimulationOnlyUser`: `PRIVATE_TRADING_OWNER_ID` while enabled, plus `PRIVATE_TRADING_TEST_USER_IDS`.
   - Every other account is refused, ADMIN or not.
   - The synthetic sale for these pairs drops the `role === 'ADMIN'` shortcut.
4. **Private publication.**
   - Render must know the listing for private trading, while the public catalogue must not.
   - `HISTORICAL_RIGHTS_UNVERIFIED` keeps refusing any public publication.
   - Whether real Coin Metrics or Binance data may be used even privately in production is a rights question for the owner. Local and synthetic fixtures are allowed now.
5. **Test funding.**
   - Base-asset (and optionally `SIMUSDT`) allocations go to the owner and to each allowlisted tester.
   - They use the existing `allocateListingOwner` pattern: explicit, once per account, audited, with no USDT moved.
6. **Proof before enabling.** Disposable-PostgreSQL tests must show:
   - model proceeds and fills move only the base asset and `SIMUSDT`;
   - `SIMUSDT` is refused by withdrawals, transfers and collateral after retries, cancel/OCO, concurrent fills and restarts;
   - the public user is denied;
   - NRX and AITH flows are byte-for-byte unchanged.

**Alternative (not recommended):** a migration adding a restricted-credit ledger that every withdrawal, transfer and conversion path enforces. It changes settled-money logic in many places.

## Owner decision still needed (one)

Approve `SIMUSDT` as the non-withdrawable settlement unit for History20 private pairs, with explicit per-tester test allocations (design above), or choose the migration alternative. Until then the synthetic sale of a managed listing stays stopped, and History20 windows admit no orders (`DEMO_ONLY`).
