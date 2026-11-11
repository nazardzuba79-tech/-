# Issue 697 — exact prior-credit ticker correction

This change does not detect a new deposit or issue another credit. Incident
identifiers, chain proofs, account data and full audit receipts are retained
only in owner-restricted local/server evidence, never in this repository.

## Proven causes and scope

- A native TRON receipt was manually entered with the network abbreviation
  `TRC` instead of asset `TRX`. Existing funds were subsequently moved to the
  legacy Cross ledger; a second Spot credit would duplicate them.
- The ordinary-account Wallet fallback omitted `real.futures` rows even though
  its headline already included that ledger. It now includes those owned units
  once and identifies the Cross quantity. Spot availability/reserves, transfers,
  withdrawals, native demo accounts and collateral decisions are unchanged.
- Both legacy and idempotent manual Spot corrections reject ambiguous `TRC`
  before a transaction. The admin form offers `TRX / TRON (Native)` distinctly
  from `USDT`, rejects the typo before confirmation, and retains recovery keys.

## Recovery procedure and guards

`scripts/lib/trx697Correction.cjs` is an explicit one-time offline primitive,
not an API, importer, migration, account search or automatic funding source.
Its private caller supplies the independently reviewed account/receipt hashes.
It derives quantity exclusively from the original successful receipt, requires
the intact unlocked amount, no prior financial use, unchanged three-ledger
snapshot, the original administrator and exact receipt identity. The private
production caller additionally checks the configured owner.

One serializable transaction takes the existing wallet-transfer advisory lock,
row-locks all three ledgers for the target, conditionally debits the wrong Cross
asset, credits exactly the same Cross quantity under the native ticker, and
writes one deterministic unique audit receipt. Spot/Demo, unrelated Cross
assets and the original receipt are asserted unchanged. No automatic retry:
a serialization conflict requires a fresh review. A repeated completed key
returns the existing receipt without another mutation.

The owner-authorized correction has been executed and read-back verified in
production. The existing installed Wallet overview service reports the native
asset and quantity. This is service/DB evidence, not an authenticated customer
browser check. The only supplied browser session is the administrator's.

## Verification

- `node scripts/qa-trx697-correction.cjs`: isolated loopback PostgreSQL 18.6;
  conservation, unchanged receipts/accounts, read-only preview, stale/spent/
  reserved/previously-transferred funds, existing native holdings, wrong actor,
  order history, audit rollback, restart and concurrent transfer/apply.
- Narrow Jest: admin financial intents, idempotency/recovery, Wallet projection,
  known/unknown valuation and unchanged native Cross accounting.
- `node scripts/qa-trx697-browser.cjs`: built application, synthetic API fixture,
  1440/390, native quantity + Cross location, reload, zero financial writes.
  Every external request and financial mutation is blocked. Not live evidence.
- Exact-head CI is required; see the PR checks for the final SHA.

## Narrow installation / rollback

API baseline verified before correction:
`voltex-deposit693:0ab4c0fc`, image
`sha256:46b2061167c8cd60c21e9c813f077ab9bb0784f8d6b90f9734028f87a23ad0e3`.
The financial correction required no API deployment or DB schema change.

Pages baseline: canonical deployment
`5f4615ba-1d9e-422d-8f65-c8085c057df0`, source
`19ca4e3c18d5f56e5242af6d88f33c74ef2d9325`.

To install prevention, overlay only the compiled BalanceAdjustmentService on
the verified installed API image. Preserve runtime bootstrap, compose, config,
mounts and every other module. Compare its exact byte diff and isolated smoke
before cutover; on failure restore the baseline image and verify health.

To install display, use a separate candidate derived from the actual Pages
source with only the five changed frontend runtime files in this PR. They
were identical between that baseline and main before this fix. Retain #691's
viewer-ticket behavior. Use current production build parameters; never upload
the loopback QA bundle. On regression roll Pages back to the pinned deployment.
Automatic production/preview GitHub deployments remain disabled.

Code rollback MUST NOT reverse the audited asset correction or issue a second
credit. A financial reversal would require fresh authorization and proof of
the then-current unspent/unlocked ledger state. Do not overwrite saved rows.
