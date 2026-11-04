# History20: candidate over the installed API and Worker

This is a local/CI release candidate, not a deployment or activation. PR #676 stays at its reviewed SHA and is not repurposed. No second History20 module, frontend edit, new financial ledger or duplicate PR is introduced.

## Identity and composition

- Canonical runtime input: `20972f4e343ff4d3df3ab53fa0fb0e6af5285d75` (runtime identical to main `9d864a0dfa60391ee3a64d7b174cc90a038116fa`).
- Installed API receipt: `41a755a9e163d278e786202be61627697149eb2a`; image `sha256:a5311f57832b0ba59eaf2db39324bb462e6ee71cff3083cd0d6e8402d8d20c35`.
- Installed Worker version `f13215c0-4767-47df-a901-673770569570`, deployment `eee80eb4-d5b7-4ac0-adfe-27acb2cd0e5d`, script SHA256 `38de0f2aa96056df1a2ef2d4b9a741c29fa52fd139bcc64e75d4d8c9a9d0dede`.
- Captured API archive SHA256 `71d7c639aff759230d1fb57343786a8fb7aaf8e09e97baca37d0b8001177d04a`. Application code/package/schema only: no environment, credentials or database rows.
- `scripts/ops/build-history20-installed-candidate.cjs` verifies these inputs, builds a complete API filesystem from the installed baseline, and applies the reviewed dependency closure, public exclusion/financial exit guards and private route mount. The manifest records every before/after file hash; unrelated installed modules remain byte-identical.
- The earlier 17-module comparison was insufficient: public API responses and outflow consumers must also be included. The reviewed roots/closure are pinned in `scripts/qa/fixtures/history20-installed-closure.json`.
- Blind main replacement failed ECLV validation/trajectory parity. Installed parsing/model/market-data behavior is therefore retained for non-History20 listings; canonical historical helpers apply only to historical/private inputs. An ECLV regression is not accepted as an installation tradeoff.

## Verification

`verify-history20-installed-candidate.cjs` checks the actual composed binaries, not only source main:

- Manifest integrity, relative module closure, sole private route mount, allowed changed-module set.
- AITH/ECLV/QVTR/NRYIA/AELRI validation, public metadata and 20,160 model points equal the installed baseline.
- Private Worker OFF/refusal, private publication in a loopback fixture, public catalogue exclusion and complete restart/replay: four checks.
- `--postgres`: existing five suites (42 checks) redirected to the candidate binaries; reserved symbols, cold registry, withdrawals/transfers/purchases/card/valuation exclusion, once-only SIMUSDT funding, access control and settlement. Only a loopback `voltex_listing_test` database is accepted.
- `--browser`: existing real-router/workerd/browser harness redirected to candidate API and Worker. Local owner pack acceptance: 51 checks, all 20 at 1440/390, no external calls/financial writes. CI has the synthetic window only; restricted source data is not uploaded.
- Initial composition failed two public-exclusion tests; adding `listingPublic` and preserving legacy public metadata fixed the closure. A Windows QA loader path mismatch created duplicate error classes and an incorrect 503; normalized module paths fixed the loader, not the application.

CI workflow `history20-installed-candidate.yml` has read-only GitHub permissions, disposable PostgreSQL 18.6, no production credentials or deploy jobs. The runner is pinned to Ubuntu 24.04: the initial ubuntu-latest run failed before testing because Playwright 1.56.1 cannot install Chromium on its Ubuntu 26.04 image; no test gate was weakened. Its artifact includes the full composed API, Worker, hashes and Dockerfile; dependency symlinks/database files are excluded. The Dockerfile requires the pinned installed base image locally: CI does not pull a private production image or claim a built container.

## Production dependencies / authorized release sequence

1. Obtain separate owner deployment authorization. Re-read the API image and Worker version immediately before applying. Run the read-only `check-history20-install-base.cjs` against the actual installed dist, image ID, captured Worker code and sealed manifest. It compares **every installed module**, not just the image/health SHA, and detects in-place edits with an unchanged image ID. Any drift, including #630 or another authorized release, invalidates this base and requires recomposition; do not overwrite newer work.
2. Verify the sealed CI artifact and manifest. Preserve the current image/Worker version as rollback; capture existing managed-listing configuration/version/timer receipts read-only. Keep all existing env bindings and flags, especially `HISTORY20_PRIVATE_TEST` OFF on both API and Worker. No funding/account creation/publish/timer request is part of installation.
3. **Migrations: none.** History20 uses existing Balance/Order/Trade/AuditLog and existing Worker storage. Keep the installed Prisma client/schema and lockfile; do not run `prisma migrate deploy`, `db push`, or all-main installation. Unapplied NativeFundingModel is outside this candidate.
4. Install the complete pinned API candidate as one component, not individual copied files; check health/identity, anonymous/unauthorized private-route refusal and existing Spot/Wallet/Banking/auth availability. Do not call `/banking/state` on an accrual-bearing account as a read-only smoke test.
5. Install the coordinated Worker while its private flag remains OFF. Check existing public listing metadata/candles and market-data paths against captured receipts, private endpoints remain inaccessible, and no timer or published revision changes. Frontend is outside this artifact and remains Claude's responsibility.
6. Any regression: restore the previous API image and/or Worker version, preserving bindings/configuration. No financial reversal, database restore, candle rewrite or timer reset is permitted. Before activation and with no intervening listing writes, this is code-only rollback. If new-format drafts/data have been saved, freeze writes and review data compatibility before rollback; never delete records to force it.
7. Private activation, participant funding and source-rights decisions are separate owner gates. Public historical publication remains refused; this candidate does not authorize activation, real USDT creation or private test trading in production.

## Banking dependency and migration receipt

Read-only schema metadata was collected from the API's database selected by the installed runtime bootstrap. No financial rows or `/banking/state` were read. Installed code is equivalent to the tested source for all six relative dependencies:

`api/routes/banking.js`, `api/middleware/auth.js`, `services/ContactEmailPolicy.js`, `banking/service.js`, `banking/config.js`, `banking/math.js`.

External dependencies: existing Express/Zod/Prisma/BigNumber/Node crypto, User/Session authorization, Balance, AuditLog, banking placements/ledger and BankingReferralReward. CoinGecko prices use the configured API base/key, a 7-second timeout and 15-second cache; failures must remain errors, not zero prices. DemoBalance must remain unchanged.

Already applied (confirmed schema metadata): `20260914170000_banking_earn_ledger`, `20260921140000_banking_referral_rewards`, `20260926210000_admin_account_deletion`. The period unique index, unique referral reward source and ledger no-update/no-delete triggers are present. **No new Banking migration or runtime overlay is needed for #676.**

Future authorized smoke: authentication/ownership; `/banking/config`, calculate and referral reads; separately approved `/banking/state` on a known safe account; placement/settlement only in an explicitly funded test scenario. State can append monthly accruals; per-period resumability is not whole-request atomicity. Settlement must atomically record paid marker, balances, referral reward and audit. Existing 17 PG tests × eight calendar CI variants and 78 browser checks are reused, not rerun without a code change. A code rollback never erases accruals or reverses settled balances.

## Other boundaries

#630 `f7c61c96987f0a34838a1f9edb82bf4787b81b5d` independently rejects the previous synthetic USDT→BTC probe with no balance/receipt mutation and passes 24 PG checks including genuine BTC/ETH/USDT withdrawal/manual settlement. It is not silently bundled into this History20 candidate. Conversion stays OFF pending its release/reserves/limits gates.

Stocks runtime #613 remains `ad833ee6d16c4c573809fdc14e6fa16a4e371271`; no new runtime fix was found, so the calibrated 50+2 failure (+18.227612%, limit +5%) is not rerun. The preserved #661 harness is ready for an actual runtime change. Beget remains untouched.
