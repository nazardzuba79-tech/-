> Integration update 2026-10-27, main #625: the historical notes below predate the permanent synthetic-sale fence. NRX/other model-priced USDT sales stay default-OFF and, when separately enabled, settle only in DemoBalance. History20 uses its separate admitted SIMUSDT path, with restricted Balance rows; it never credits USDT or DemoBalance. Both paths remain atomic, and the global demo-settlement flag does not bypass History20 admission or a cold registry. No production flag was changed.

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

**Update 2026-10-19 08:07 (owner, PR #551):** `SIMUSDT` approved as the settlement **design** and for code-only implementation. This is not approval to activate it or to move real balances.

## Spike and evidence (review branch `claude/voltex-mobile-audit-7rpjni`, 2026-10-19)

The branch includes #544, #546, #548 and #551 (head `a9aee9cc`). It does not include #552, which another session opened in parallel and which covers the same refusals; see "Overlap with #552" below. Everything listed here is **inert in production**: the registry builds only `/USDT` pairs, and no route, store or Worker creates a `SIMUSDT` market. `listings/privateTest.ts` is not imported on any request path.

### Legacy sales before and after #551 (disposable PostgreSQL)

Covered by `legacySimulationSaleEquivalence.pg` and #551's pins in `managedListingSimulationSale.pg`.

| Case | `main` | This branch |
|---|---|---|
| AITH under a valid lease, MARKET and LIMIT | refused by its own gate, no write | identical |
| Older managed listing, owner MARKET SELL | no sale: the venue has no price, no write | no sale, no write; only the reason changes |
| Ordinary user, book path | unchanged | identical |
| NRX legacy sale | credits USDT at the model price | identical |
| Venue pair (`ETH/USDT`) owner sale | venue price | identical |

No legacy managed-listing sale ever executed, so #551 removed nothing that worked. The `SIMUSDT` exception does not reopen the stop for any `/USDT` pair.

### What the spike adds (default off)

- `testAssetConfig.ts`: `SIMULATION_QUOTE` and **one canonical guard, `isSimulationSettled`**, used at every call site. It matches, bare or on either side of any pair (`/`, `-`, `_` or compact):
  - the `SIMUSDT` unit itself;
  - a **reserved History20 private ticker, `VHX01`–`VHX99`** (the `VHX-NN` scenario numbering; the owner's BotLab 01 draft already uses `VHX01`). This match needs no registry. The rule is in the pure `src/shared/history20PrivateSymbol.ts`, which is safe for the Worker;
  - as a second line, any base the registry quotes in `SIMUSDT`.

  `isTestAssetPairOrSymbol` includes it, so every existing guard refuses it.
- `privateTestSimulationConfig` and `checkPrivateTestable` (`PRIVATE_TEST_SYMBOL`): a private `SIMUSDT` market can be built only for a reserved ticker.
- `OrderService.sellTeamSpotSimulation`: the #551 stop now lets through only a market quoted in `SIMUSDT`. Its proceeds land in the `SIMUSDT` row.
- `WalletTransferService` and `PurchaseService`: refuse `SIMUSDT`-settled value (the #552 session found the purchase path first). Other assets are unchanged.
- `WalletPortfolioService.pricesFor`: a base quoted in anything but USDT has no USD value.
- `listings/privateTest.ts` (unwired): the pair builder, the `SIMUSDT` market config, `privateTestEnabled` (`HISTORY20_PRIVATE_TEST=enabled`) and `isPrivateTestParticipant` (the verified owner, an ADMIN, plus allowlisted testers; never another ADMIN or a blocked account).

### Paths proven on disposable PostgreSQL (`history20SimusdtSettlement.pg`)

The fixture account holds 500 real USDT next to `SIMUSDT` (simulated profit).

| Path | Result |
|---|---|
| Withdrawal: Spot (held) and trading account (unheld) | `SIMUSDT` and the window asset refused; `/withdrawals/options` shows USDT 500 only |
| Deposit claim and observation | refused before any write |
| Admin adjustment (`adjust`, `adjustOnce`), demo top-up | refused |
| Spot↔Futures transfer | `SIMUSDT` and the window asset refused; USDT unchanged |
| Banking placement | `asset_unavailable` |
| Product purchase | `SIMUSDT` and the window asset refused; USDT product unchanged |
| OTC cash | not in the route's asset enum, USDT/USDC/BTC/ETH (code reading, `otcCash.ts`; not exercised by this test) |
| Wallet valuation, card trading-volume test | no USD value; not eligible |
| Pairs naming `SIMUSDT` (`SIMUSDT/USDT`, `BTC/SIMUSDT`, `X/SIMUSDT`) with no admission | refused for everyone before any row |
| **Indirect cash-out:** the window asset bought with `SIMUSDT`, then sold on `X/USDT`, `X/BTC`, `USDT/X` or `X-USDT` | refused before any row. **RED→GREEN:** before `isSimulationSettled`, a LIMIT SELL on `X/USDT` rested in the ordinary book |
| Settlement, with a test-only stand-in for admission on that one pair | the owner sale is priced at the canonical model price (= ticker = chart close); book fill, cancel (lock released exactly), conditional take-profit fired by `PriceWatcherService` and concurrent owner sales all move only the window asset and `SIMUSDT`. No USDT row moves; the venue is never asked |
| Without the stand-in | the real gate refuses the private market for everyone |
| **Registry cold, stale, withheld or unpublished** (the listing is absent from `managedListingAssets()`; fixture holdings remain) | every pair with the reserved ticker (`X/USDT`, `X/BTC`, `USDT/X`, `X/SIMUSDT`) refused for the tester, an ordinary user and the owner, before any row and before asking the venue. `assertSpotListingReady` with an unresolved registry refuses the same way. Withdrawal (both), transfer, deposit claim, adjustment, demo top-up and purchase are refused for the ticker and for `SIMUSDT`; options show USDT 500 only. **RED→GREEN:** before the reserved-ticker rule, `X/USDT` was not recognised once the registry no longer knew the listing |
| Same window quoted in USDT | owner sale still stopped (#551) |
| Publication | `HISTORICAL_RIGHTS_UNVERIFIED` unchanged |

**Mutation check:** each guard was removed in turn and the file re-run. All 10 mutations make at least one test fail:
- the reserved-ticker match;
- the registry second line (pinned by a test that bypasses the builder);
- compact `XSIMUSDT` parsing;
- `isSimulationSettled` in the restricted-asset guard;
- the transfer guard;
- the purchase guard;
- the sale narrowing;
- the valuation quote check;
- the builder's reserved-ticker rule;
- `checkPrivateTestable`'s reserved-ticker rule.

The file passed 11/11 five times in a row on the same reused database.

The unit is matched before pair normalisation, which reads `SIMUSDT` itself as `SIM/USDT` (#552 noted this trap). The recognition test pins it.

### Findings that shape the wiring

1. **Admission cannot reuse `isTradable`.** `testMarketSimulation.ts` applies a listing's scenario path only while it is not tradable. A tradable private market would lose its History20 prices, so admission must be a separate, per-user gate in `assertSpotListingReady`/`placeOrder`.
2. **The synthetic sale is reachable by any ADMIN** (`role === 'ADMIN' || isSimulationOnlyUser`). The per-user admission must run before that branch, so another ADMIN is refused on a private pair.
3. **Reserved tickers make the guards independent of the registry, not the market.** The registry must still know a private market to price and trade it. When it does not, the market simply closes (fail closed). Caveat: a non-window listing already published under a `VHX01`–`VHX99` ticker would also lose transfer and purchase. The production listing store could not be checked from here; a window listing can never be published (rights gate).
4. **Still to build before activation:**
   - the private listing channel (the Worker DO and the Render registry; the public catalogue never shows it);
   - per-user admission;
   - the terminal for participants;
   - one-time audited test funding (the `allocateListingOwner` pattern, per tester);
   - OCO/stop-loss and restart proofs on the private pair.

### Legacy behaviour found, not changed (NRX unchanged by owner rule)

Probed on synthetic rows on this branch. Its NRX paths are unchanged from `main`.
- An NRX holder's LIMIT SELL on `NRX/BTC` filled against another user's BTC bid, so the holder received withdrawable BTC. `USDT/NRX` is also accepted. The guard knows only each test asset's own `/USDT` pair.
- `transferWalletBalance` moves NRX into `FuturesBalance`.
- A product priced in NRX can be bought.

These are transfers between users, not minted value. Closing them would change legacy NRX behaviour, so that is a separate owner decision.

### Scope diff: #552 (`99064e93`) ↔ #553 (this branch)

CTO coordination (#553, 19.10): #553 is the candidate integration line and #552 a reference. #552 is **not merged** here: an automated permission check stopped merging another session's open PR, and the CTO asked not to merge it automatically. No #552 code was copied. Missing regression cases were written here independently.

| Aspect | #552 | #553 |
|---|---|---|
| Canonical guard | `isRestrictedSettlementUnit` + `RESTRICTED_SETTLEMENT_UNITS` | `isSimulationSettled` (single exported guard) |
| `SIMUSDT` bare, `/` or `-` pair, either side | yes | yes (also `_`) |
| Compact `XSIMUSDT` | **no** (pinned as false) | yes |
| History20 base on another pair (`X/USDT`, `USDT/X`, `X/BTC`) | no (no base concept) | yes |
| Base while the registry is cold, withheld or unpublished | n/a | yes (reserved `VHX01`–`VHX99`) |
| Withdrawal, deposit, adjustment | via `isTestAssetPairOrSymbol` | same, plus the base |
| Transfer, purchase | refused with `TEST_ASSET_NOT_TRADABLE_MESSAGE` | refused with "This asset cannot be transferred" / "…cannot be used for purchases" |
| Owner synthetic sale | #551 stop (not in #552) | #551 stop narrowed to a `SIMUSDT`-quoted market |
| Valuation | `SIMUSDT` unpriced | same, plus a non-USDT-quoted base |
| Settlement path (fills, cancel, take-profit, concurrency) | none | proven with a test-only admission stand-in |
| Tests | `restrictedSettlementUnit.pg` (7) | `history20SimusdtSettlement.pg` (11) |

Cases first present in #552 and now covered here:
- the recognition matrix, including the negatives `SIM`, `SIM/USDT`, `BTCUSDT`, null and empty;
- legacy guard results for USDT, BTC, ETH, VTA, NRX and AITH;
- OTC assets;
- no venue call for `SIMUSDT` pairs;
- the purchase guard.

**Semantic differences to settle when consolidating:**
- compact `XSIMUSDT`: #553 refuses it, #552 does not. #553 is stricter.
- the transfer/purchase refusal text.

Adopting #553's guard keeps every #552 refusal.

## Wired private mode (integration, 2026-10-19)

The owner assigned the final #553 integration to the #551/#552 session. The private mode is now wired on this branch, still default off: `docs/HISTORY20_PRIVATE_SPOT_MODE.md` covers rules, admission, the registry-independent cash-out guard (CTO P0), funding, the private channel, the reads, the terminal and the admin control, plus the evidence and the remaining blockers. The "not wired" notes above describe the spike as it was before.
