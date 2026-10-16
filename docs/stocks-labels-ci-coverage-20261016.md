# Stocks label cleanup and quote-admission CI coverage

This follow-up builds on local source `1587ee6f13f86dc5e4e87e342a87496bc1bedb56`. It does not change market data, order execution, account access or the frozen capacity-test build.

## Narrow interface correction

The existing header action opens account settings, so its label now uses the existing translated account-settings text. The quotes panel no longer adds a test-trade prefix before the instrument name. Balance controls use the existing translated balance labels.

The exact disclosure that funds and positions are test-only and orders do not reach the real market is retained inside the existing accessible account-settings disclosure. Financial errors, viewer restrictions, callbacks, all 178 translation entries and the account ledger remain unchanged. No new design, colors, fonts or layout were introduced.

The original requested Stocks v0 reference remains a separate visual acceptance gate. A recovered archive associated with PR #471 must not be called the owner-selected v0 reference until that identity is confirmed. Figma Professional B is not a substitute for that confirmation.

## CI coverage

The existing two-trader workflow command now explicitly includes `services/stocks-global/quote-admission.test.mjs`. Its historical workflow guard gains one exact transition from the frozen `1587ee6f` workflow. All 22 jobs, conditions, pinned dependencies and previous mutation checks remain intact.

The runtime and new tests require FULL current-head backend validation. Prior `9dd11ad` results cannot be inherited through the protected-source admission mechanism.

## Local validation

- Label rendering, viewer isolation and localization: 3 suites, 35 tests passed; zero failed or skipped. Rendering covers ru/en/es/zh/hi/ja/ko and the accessible disclosure.
- CI admission, workflow and backend closure guards: 74 tests passed; zero failed or skipped.
- Frontend TypeScript: passed.
- Production frontend build: passed, 6,188 modules, 10.11 seconds. The existing large-chunk warning remains visible.
- Browser: desktop 1440 px retains a 792 x 548 px chart; no page overflow. At 320, 360, 390 and 430 px the trade inputs and Stocks tabs remain within the viewport, with no horizontal page overflow. The exact disclosure opens in the existing account settings; editing the existing balance remains disabled. Captured browser warnings/errors: zero.

The before/after desktop and mobile screenshots use explicitly marked local synthetic fixtures. The before preview retains prior test trades and 731.24 USDT; the after preview has a separate newly initialized fixture directory with 731.25 USDT and no trades. That difference is not a reset or deletion of the earlier history. Screenshot/log hashes and geometry are in [local validation](evidence/stocks-labels-ci-coverage-20261016/local-validation.json).

These checks do not establish resource capacity, provider redistribution rights, production activation or exact-reference visual acceptance. Exact-head CI and the separately admitted affected capacity proof are recorded independently.
