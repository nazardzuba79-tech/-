# Deposit minimum $300 and USDT TRC20 audit

Date: 2026-09-09. Branch: `codex/deposit-minimum-300-trc20-audit`.
Base: freshly fetched `origin/main` at `e51dccbc10a2ee6fe2189d9cc8b2c1daa02e0426`.
The checkout was clean before creating this branch. No merge, deployment,
production write, treasury change, migration, or dependency change was performed.

**TRC20 CODE/CONFIG VERIFIED / LIVE END-TO-END DEPOSIT NOT YET PROVEN**

## Policy and frontend

The credited-deposit minimum changes from $1000 to **$300 USD equivalent**.
`src/config/limits.ts` owns `MIN_DEPOSIT_USD` and the existing USD peg policy
(USDT, USDC, USD, DAI). `DepositService` enforces it at credit time, including
admin manual credits. Stablecoin units are valued at USD parity; other assets
use the existing injected market ticker. Missing, invalid or nonpositive prices
retain the existing permissive rule, rather than incorrectly recording
`BELOW_MINIMUM`. No fabricated price was introduced.

Authenticated `GET /api/v1/deposit-chains?includeConfig=true` returns
`{ chains, minDepositUsd, usdPeggedAssets }` with `Cache-Control: no-store`.
Each chain includes explicit `supportedAssets`; Tron includes configured tokens
only, never native TRX. The unparameterized endpoint retains its original array
shape for compatibility.

Both `frontend/src/components/DepositModal.tsx` and
`frontend/src/pages/wallet-v3/DepositModal.tsx` use `useDepositOptions`.
Neither contains a 1000/300 minimum literal or an independent stablecoin list.
Configuration is fetched on opening; addresses and supported assets come from
the existing deposit-address endpoint. Late responses cannot restore an address
from a previously selected network. There is no guessed minimum while config
loads or fails. Volatile-asset equivalents use the existing
`getExternalTicker(asset/USDT)` API and refresh every 30 seconds while open.
Unavailable prices remove the equivalent and leave the backend USD minimum.
The displayed conversion is an estimate; credit-time pricing remains authoritative.
The public support guide in all seven languages now points to the current
minimum in the deposit form instead of quoting a stale $1000 literal.

## Production configuration and code path

Read-only production checks used the owner-selected Render workspace
**Крипто Биржа**, service `exchange-api`, and the Neon project's default
production branch. No secret or treasury address is included in this report.

| Check | Result / evidence scope |
| --- | --- |
| Tron treasury configured | **YES**; nonempty `TreasuryWallet` production override exists |
| Intended USDT contract and decimals | **YES**; Render `TRON_TOKENS` contains the exact intended USDT contract with 6 decimals |
| Historical production Tron deposit | **NO**; no `Deposit` row with `chain='tron'` |
| Historical CREDITED production Tron USDT | **NO** |
| Chain appears only when treasury exists | Route tests using real configuration resolution, with/without override |
| Returned address equals configured treasury | Route test; comparison asserted without printing the address |
| USDT available, TRX unavailable | API/config tests and both actual browser forms |
| Public TronGrid API compatibility | **YES**; actual verifier accepted a sampled public USDT Transfer event, including hex recipient, with at least 19 confirmations |
| Exchange production deposit end-to-end | **NOT PROVEN**; the public transaction is not an exchange deposit |

The official intended token contract is
`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`; this public token identifier is confirmed by
[Tether's supported protocols](https://tether.to/en/supported-protocols/).
TRON's [event documentation](https://developers.tron.network/docs/event) and
[transaction event endpoint](https://developers.tron.network/reference/get-events-by-transaction-id)
support the event/address-format audit. The deployed token's 6-decimal setting
was checked directly, without exporting the environment value.

Self-service claim and admin manual-credit routes resolve the same chain and
treasury configuration and instantiate the same `DepositService`/verifier.
The admin incoming feed uses that configuration's per-token contract filter and
decimal divisor. Final credit re-verifies the event and actual confirmations;
the incoming feed's confirmation display is not authority to credit.

The audit found and fixed additional credit-path defects:

- TronGrid decoded recipients can be hex, while configured addresses use
  Base58Check. Normalize both recipient and contract encodings, preserving
  case-sensitive Base58 and validating its checksum.
- Asset symbols are canonicalized before valuation and balance crediting.
  Lowercase `usdt` previously bypassed the stablecoin peg lookup when the price
  feed was unavailable.
- Tron chain spelling and hex transaction hashes use one persisted casing,
  preventing case variants from creating different idempotency keys. Solana
  signatures retain their case-sensitive behavior. Production has no existing
  Tron deposit rows, so no historical Tron key migration was needed.
- Malformed event responses, invalid configuration/blocks/amounts and
  nonpositive token transfers are rejected. Only a matching Transfer event,
  contract and treasury recipient can supply the credited amount; confirmations
  use the newest matching event block and the current Tron block.

No treasury addresses, referral percentage (5%), referral arithmetic, trading,
withdrawal, copy-trading eligibility, balance arithmetic or transaction rollback
logic changed. Referral behavior remains gated by `CREDITED`.
Existing recorded `PENDING` and `BELOW_MINIMUM` rows still return their recorded
status on retry; this change does not retroactively reprocess them. A separate
review would be needed to change that pre-existing lifecycle.

## Validation actually run

Backend TypeScript: **PASS** (`node node_modules/typescript/bin/tsc`).
Frontend TypeScript: **PASS** (`node node_modules/typescript/bin/tsc -b` in frontend).
Production Vite build: **PASS**, using the existing build configuration with
in-process `esbuild-wasm` 0.21.5 because native Windows child-process pipes were
blocked in this environment. No lockfile/build-config changes. The existing
large-chunk warning remains. This is not a claim that the native CLI build ran.

Full Jest: **1998 / 2001 tests pass**, **134 / 137 suites pass**.
Measured unchanged base: **1918 / 1921 tests pass**, **131 / 134 suites pass**.
All 80 added tests pass; no new failure. The same three historical preservation
hash failures remain in `avatarIdentityPresentation`, `nazaraCardPresentation`
and `walletUxRefinement`, with identical expected/received hashes to the base.
The wallet modal fingerprint was refreshed for its intentional change; API
preservation checks strip only the exact new API method and still enforce the
old hashes, including the already-failing wallet API expectation.

| Focused suite (included in full run) | Passed / total |
| --- | --- |
| DepositService | 11 / 11 |
| DepositMinimum | 23 / 23 |
| deposits routes | 15 / 15 |
| adminDeposits routes | 12 / 12 |
| depositMinimumTron routes | 21 / 21 |
| TronDepositVerifier | 17 / 17 |
| frontend depositMinimum (hook and both real TSX forms) | 27 / 27 |
| **Focused total** | **126 / 126** |

Coverage includes $299.99/$300/$300.01 stablecoin and BTC/ETH boundaries;
299.99/300/300.01/500 USDT through both self-service and admin routes;
wrong event/contract/recipient, unsupported TRX, 18 versus 19 confirmations,
duplicate hash/chain/symbol variants, valid transfers, address encoding/checksum,
malformed amounts, unchanged referral math, price outages, backend-supplied
alternative minimums, cancellation and old-network address races.

Browser QA used the actual production bundle and actual compiled deposit GET
routes behind `scripts/qa-deposit-minimum.cjs`. Its account data, market prices
and obviously nonpayable treasury strings are isolated fixtures; financial
writes are refused. This is browser integration QA, not a production deposit.

Both Wallet and nav forms were checked at **1440x1000** and **390x900** for:

- Tron / USDT / $300, with USDT as the only offered Tron asset;
- BTC / $300 approximately 0.006 BTC using an explicit $50,000 QA ticker;
- unavailable BTC ticker / $300 only, with no fabricated equivalent.

All 12 cases have screenshots and DOM measurements. No horizontal overflow;
all dialogs fit their viewport. No browser console errors or warnings were
captured. Local output artifacts include `browser-qa.json`, `test-summary.json`,
`production-config-audit.json`, `public-trongrid-probe.json` and the screenshots.
The QA server binds only to loopback; open `/wallet?action=deposit` for Wallet
or `/otc` and the nav Deposit button. `/qa/normal` and `/qa/no-price` select the
controlled price scenario. The optional `QA_TRONGRID_PROBE=1` performs only a
public read and exports booleans.

## Owner handoff

**READY FOR OWNER REVIEW: YES.** Not merged or deployed. The final branch SHA
is reported in the delivered handoff; the implementation SHA is recorded in
`AI_HANDOFF.md`. The remaining live check is an actual exchange production
deposit, which was neither created nor invented during this task.
