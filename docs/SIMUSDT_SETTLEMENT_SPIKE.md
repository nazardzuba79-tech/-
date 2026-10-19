# SIMUSDT restricted settlement unit: feasibility spike (default off)

> **Update (2026-10-19, 08:07 UTC):** the owner approved SIMUSDT on PR #551. The private mode built on this spike is described in `docs/HISTORY20_PRIVATE_SPOT_MODE.md`. The text below records the spike as it was.

This spike prepares History20's private Spot test mode (owner decision of 2026-10-19 on PR #544): profit made at a model price must not be withdrawable. The proposed design is in PR #551 (`docs/HISTORY20_PRIVATE_SPOT_SETTLEMENT.md`): History20 private pairs settle in `SIMUSDT`, a restricted unit held in the existing Spot `Balance` rows. It is not a second wallet.

**The owner has not chosen this settlement yet.** So this spike adds refusals only:
- nothing credits `SIMUSDT`;
- no pair quotes `SIMUSDT`;
- no ledger row is written.

## In this spike (code)

| Path | Before (main) | Now |
|---|---|---|
| Withdrawal, Spot ledger (`WithdrawalService.requestWithdrawal`) | `SIMUSDT` accepted | refused (`isTestAssetPairOrSymbol`) |
| Withdrawal, owner/tester trading wallet (`requestUnheldWithdrawal`) | accepted | refused |
| Withdrawal options list (`/withdrawals/options`) | listed | hidden (same guard) |
| Deposit observation (`DepositService`) | proceeds to the chain RPC | refused before any read or write |
| Admin balance adjustment | accepted | refused |
| Spot ↔ Futures transfer (`WalletTransferService`) | accepted, any asset | `SIMUSDT` refused; every other asset unchanged |
| Product purchase (`PurchaseService`, `priceAsset` is admin-set) | accepted | `SIMUSDT` refused |
| Spot order on any `X/SIMUSDT` pair | accepted (normal path) | refused before any row (`assertSpotListing`) |
| OTC cash (`OTC_ASSETS`) | not an OTC asset | unchanged |
| Banking (`ASSET_IDS`) | not a banking asset | unchanged |
| Wallet valuation (`pricesFor`) | no price (not pegged, no venue pair) | unchanged: never valued |

**Legacy unchanged.** USDT, ordinary pairs, VTA, NRX and AITH keep their guard results; this is tested. The new transfer and purchase refusals match `SIMUSDT` only.

**Recognition.** The exact token is matched **before** pair normalisation. Normalisation reads `SIMUSDT` as `SIM/USDT`, so a listing ticker `SIM` is not affected.

**Tests.** `src/services/testMarkets/__tests__/restrictedSettlementUnit.pg.test.ts` uses disposable PostgreSQL. The user holds 1000 deposited USDT and 250 `SIMUSDT`; the `SIMUSDT` row is a fixture for future simulated profit. The tests show:
- the unit leaves through no path above;
- USDT withdrawals stop at 1000.

With the restriction disabled, all 7 tests fail: the unit is withdrawn, transferred, spent and traded.

## Not in this spike: what a live private mode still needs

Each item below needs the owner's settlement approval first.

1. **Per-listing quote.** These places assume USDT:
   - `LISTING_QUOTE = 'USDT'`, `listingPair` and `listingSlug` (`listingConfig.ts:22,129-130,251`);
   - `TestAssetConfig.quote: 'USDT'` (`testAssetConfig.ts:25`).

   A History20 window would need quote `SIMUSDT` in Render, in the Worker catalogue (`workers/market-edge`) and in the frontend. The frontend builds `${slug}/USDT` in `nrxMarket.ts:14` and `${symbol}/USDT` in `AdminListingsPage.tsx:235,326,337,347,462`.
2. **Ticker clash.** `SIM` should become a reserved listing ticker (`RESERVED_LISTING_SYMBOLS`) once a unit exists. Today it is not reserved. Reserving it now could invalidate an already published listing named `SIM`, which cannot be checked from here.
3. **Exact admission.** History20 window orders should be admitted only for `isSimulationOnlyUser`: the verified owner plus `PRIVATE_TRADING_TEST_USER_IDS`. The `role === 'ADMIN'` shortcut of `sellTeamSpotSimulation` must not apply to these pairs.
4. **Private publication.** Render must know the listing while the public catalogue does not. `HISTORICAL_RIGHTS_UNVERIFIED` keeps refusing public publication.
5. **Funding.** Testers receive explicit, once-per-account, audited test allocations of the base asset and/or `SIMUSDT`. This extends the `allocateListingOwner` pattern.
6. **Native trading wallet.** Its holdings come from `DemoBalance`, not Spot `Balance`, so `SIMUSDT` cannot reach it. Nothing was changed there (no Futures/NativeDemo changes).
7. **Proof before enabling.** Fills, cancel/OCO, concurrent fills, retries and restarts must move only the base asset and `SIMUSDT`. Each must be tested on disposable PostgreSQL.
