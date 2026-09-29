# Account/presentation gate repair — 2026-09-29

Base: `c237649ccd93e74c68013c861ab9cbd38af56726`. All observations here are local; this subtask does not claim release or production verification.

## Demonstrated display defect

`useWalletData` derives `btcEquivalent` from economic `walletEquityUsd`. The Overview reconstructed the BTC mark from `totalEquityUsd`, which measures enabled collateral instead. With collateral disabled, the USD balances stayed correct but the BTC equivalents were overstated.

The discriminating fixture has economic wallet value **1,000,250.50 USD**, margin equity **800,250.50 USD**, real funding **230,701 USD**, and a **100,000 USD/BTC** mark. The old runtime displayed **15.38593045 BTC** for the combined **1,230,951.50 USD**; the correct answer is **12.309515 BTC**. The strengthened test fails against the unmodified base runtime and passes with the bounded fix. The old source was restored to the candidate before final checks.

The fix uses the hook's same economic value, validates finite positive inputs, and falls back only to an explicitly supplied valid BTC mark. Missing/zero/negative/nonfinite equivalents and missing/invalid economic values cannot invent a rate. All USD totals and account operations are unchanged.

## Updated tests

The seven old suites now follow approved current behavior: server collateral preferences, separate real/simulation funding scopes, shared marketplace prefetch, a 16 ms deferred profile analytics mount, localized selected-period metrics, real pending/dash providers, and decoded-photo overlays over stable initials. Tests retain exact canonical response snapshots and byte guards for unchanged code. Superseded whole-file/function hashes are replaced with observable money, geometry, session, deposit and account-source boundaries; no new accepted hashes replace old ones.

`copyPresentation.ts` evaluates actual production declarations and the real `LiveMetric` provider with explicit test dependencies. No production API is loaded by these presentation fixtures.

## Verification actually run

- Seven owned suites: **149 tests PASS**, 20.741 s.
- Four adjacent preservation suites: **71 tests PASS**, 12.160 s: `walletUnifiedAccount`, `copyDepositUx`, `copyPerformancePeriods`, `copyHiddenTradeHistory`.
- Combined: **220 tests / 11 suites PASS**. This is not the full frontend gate.
- Old-runtime discrimination: **one expected failure**, proving the BTC test catches the bug.
- `git diff --check`: PASS.

Reproduce with the repo-root Jest command `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath`, followed by the suite paths listed in `verification.json`. The JSON records exact source SHA-256 fingerprints and individual suite results. Root integration still needs its full build/test gate; no remote mutation or deployment is part of this subtask.

## Integrated browser lifecycle follow-up — 16:59 UTC

Implementation: `384dbb90b74775aec89efd3be8a05e9d21bf0fc3`, based on root integration `f2cd6616fd8e7ad566fb50268574e608ce81cd29`. This follow-up changes four tests only.

With the actual browser idle policy integrated, the two Copy DOM fixtures were hidden because JSDOM defaults to a nonvisual document. The store correctly suppressed their initial reads. The unchanged two-suite run reproduced **17 failures / 1 pass**. The fixtures now describe a visible foreground document, start and stop the real browser lifecycle, share its actual singleton with evaluated components, and restore the replaced globals during teardown. A new mounted check also proves a hidden route issues no request and hydrates its existing cards with exactly one request on visibility wake. No always-active lifecycle stub is used.

The Wallet hook and Copy transport evaluation fixtures now resolve their new browserActivity import to the actual Jest module. Their economic/collateral equity, unknown value, captured bearer, abort signal, session rejection and no-write assertions remain intact.

- Four repaired suites: **73 tests PASS**, 19.470 s, with `--detectOpenHandles`; process exited naturally with code 0 and no reported open handles or skips.
- Earlier diagnostic isolation: **220/220** account/adjacent tests passed and exited naturally in 32.166 s on `54bba32b6bec91a0413fe294acae7f4a3bf5eac9`; **66/66** root market/widget cases passed and exited naturally in 5.561 s on `0e0f76fc99443b2d8bf43a4f1aaa8a8d90f096a7`. These two runs are separate source checkpoints and do not establish a full-suite result.
- `git diff --check`: PASS. No runtime, CI gate, timeout suppression or force-exit change.

`idle-integration-verification.json` records the exact source hashes and scoped results. Root owns the remaining full-suite failure and open-handle fixes and must rerun the combined gate.
