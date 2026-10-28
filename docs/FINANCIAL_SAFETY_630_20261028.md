# Financial safety review #629 / #630 — 28 October 2026

Production remains unchanged by this review. NO merge or deploy of #630.

## Actual production evidence

Read-only existing Hetzner console checker completed at 2026-10-28T10:56:06.894776Z.
- API source: `210aefacb319374194392624d75b312b87b42e94`.
- API immutable image: `sha256:07a4c3e07ff36d17eb611e4d7a5a86bbbd1c2e36eaf7b1c9f041ef774b9d2a77`.
- Healthy Node22.23.3 / PostgreSQL18.6; existing database container unchanged.
- All14 pinned runtime module hashes match; five #629 modules exactly match the reviewed executable payload. They must NOT be reinstalled.
- Observed existing `DEMO_SPOT_ENABLED`, `DEMO_LIQUIDITY_ENABLED`, `DEMO_WITHDRAWAL_GUARD_ENABLED` remain ON. `SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED` remains OFF/unset. Runtime signature and financial flags match the retained pre-NRX checkpoint.
- Historical NRX rows and balances digest unchanged, rollback image retained; fatal log lines0.
-32 pure deployed-module gates PASS, zero network/financial commands in that diagnostic process; bounded BTC, ETH, CFD and Futures candles GETs PASS. No real order, transfer, withdrawal or balance change.
- Current main fresh-fetched `57c7592f7c87287d9a080d09b06aec5301b10bb9`. Original #630 `23709c42034b928cbba226bb31f7cbb40305f32d`; review branch now includes main, never the reverse.
- Pages is still `6118e18e49edd226a6b250154d3893773b4522e2`, canonical95010b1c. Production auto-deploy OFF, previews none; main-only manual deployment workflow is unchanged.

## Five #629 runtime pins (SHA256)

| Executable module | SHA256 |
|---|---|
|api/routes/withdrawals.js|ea9aa95ca1d3f5a6dbc36eb78bca60a6a9308b3c258c30b810be961da5dfbf34|
|api/routes/adminWithdrawals.js|c904e8c2bfb283c447691d60a29347aaa19163c68288132b6523cf99cd21279a|
|services/WithdrawalService.js|b5fbd7301412712db15674ca40595053dd70fc5825bde1cab88a49b379200470|
|services/demoSpotAccess.js|723a5386cf90284af3f6a4ec5a67a0a2490fdc53250e87645baaf6696a9cca26|
|services/OrderService.js|c03a392fd4f90a637e45e7c18a9f30a1457c1aa5cca97732522a098e6be2ef97|

## Review changes

- Missing/negative/malformed audited simulation amounts and non-finite wallet values fail closed. Baseline original630:9FAIL/6PASS; fixed helper:15PASS. No receipt is edited.
- OTC checks the existing floor under the same per-account lock when reserving and before paying an existing obligation. Allowlisting or USER role is not treated as proof of genuine money. Refund/cancel and committed idempotent replay remain available.
- Spot→Futures transfers cannot move floor-bound principal into ordinary margin; genuine value above the floor remains eligible. Futures→Spot does not itself generate a credit, only atomically transfers an existing available balance.
- New Banking placements cannot invest the protected synthetic principal and generate ordinary interest/referrals from it. Existing placements are not rewritten.
- Actual Spot settlement checks every participant, including legacy resting makers and triggered conditionals. A loss forecast for an executing order is excluded from its BEFORE baseline, so a bad fill cannot masquerade as a loss already incurred. OCO sibling cancellation stays in the same rollback-safe transaction and releases no second hold.
- Approve/SENT recheck test-asset status, also for old Balance-held SIMUSDT/VHX requests; rejection stays available.
- Original NRX audit receipt fixtures are preserved. Financial order exercises use FLOORX, an unvalued fixture asset, because main permanently retired NRX. Actual retirement guards are unchanged.

No migration, price/fee/margin/PnL math change, new ledger, activation switch, user edit or production write. ECLV/QVTR configs, seeds, approved assets, dates, timers and tradable flags are byte-unchanged.

## Actual checks / pending gates

- Backend TypeScript/build PASS locally (Node24.22.1).
-8 focused unit/route suites,148 tests PASS, zero skipped. New helper suite15 included.
- Original630 helper with the new tests:9FAIL/6PASS, same fixture assertions, then restored fixed source in finally.
- Real new PostgreSQL cross-ledger suite is prepared (12 cases), plus existing changed floor/withdrawal/History20 compatibility suites. Local PG unavailable: this execution environment exposes only UID0 and rejects setresuid; no attempt to bypass PostgreSQL root protection. No local PG PASS claim.
- Existing nrx-market workflow gains an exact-head Ubuntu24.04/Node22.23.3/PostgreSQL16 service job with fixture-only credentials/loopback URLs, no production secrets/permissions or deployment. Its result must be recorded after actual execution.

## Remaining NO-GO / owner policy

1. Existing synthetic-derived value already moved to ordinary Futures balances/positions, Banking placements or a different account is not retrospectively identifiable from a current Balance alone. The proposed floor only sizes the original sale receipts. Legacy derivative PnL, paid Banking/referral rewards and downstream transfers need a separate read-only provenance inventory and an owner-approved treatment. Never zero, relabel or seize old balances automatically.
2. Already-resting exposures may have adverse price risk; refusing a new synthetic outflow does not resolve previously open obligations. Existing withdrawal/OTC holds remain in place until separately reconciled, and rejection remains supported.
3. Market marks are a valuation policy, not proof of cash backing. Genuine-over-S rule and treatment of price gains/shortfalls require explicit owner acceptance. A floor alone is not a provenance ledger.
4. Wallet Conversion is not present in this reviewed main/PR source. Its separate candidate/rights/flags remain out of scope and unactivated; no claim that an absent conversion implementation was exercised.
5. Historical admin Balance credits have no automatic genuine/synthetic provenance. Existing owner policy leaves them unchanged; this review does not override that decision.
6. No production financial write is an acceptable test here. All release decisions stay blocked on integration evidence and legacy policy, not just green CI.

## Release boundary

Continue only existing #630; no duplicate PR. A later production candidate must be composed over actual API210aefac and retain the ECLV peak interpreter,629 fences,619 notifications,633 Admin Delete and NRX alternate-pair guard. Do not deploy the stale original branch image or all of main. Exact runtime identity, no-migration diff, measured flags, encrypted backup/restore proof and retained immutable rollback must be checked again before a separately authorized release.
