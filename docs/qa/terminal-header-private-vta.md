# Terminal headers and private VTA settlement — 2026-09-28

Base: `9d7aa1bfef6fd358f7c7f548d36ec647010ddeb0` (fresh origin/main).

## Scope

- Futures and Spot desktop market metrics use equal 24 px gaps. Existing mobile composition and typography are retained. The Futures mobile tools toggle is no longer rendered on Spot.
- An unblocked administrator may credit VTA only to their own DemoBalance through the existing audited admin adjustment. No customer balance is credited by this change.
- The private VTA market sale uses the authenticated administrator ID, the server's live listing phase and current simulated quote. A client cannot select another account or execution price. Decimal settlement, conditional debit, unique request ID, order, trade and audit are one transaction. Failed writes roll back; matching retries return one receipt; conflicting retries return 409.
- The Spot form calculates an indicative total; the wallet funding view displays the separate private balance and links to the form. It does not contribute to real wallet totals, transfers or withdrawals. No public VTA matching, real credit, schema migration or production trade is introduced.

## Verification

- 113/113 backend tests in seven suites, including 15 tests on disposable local PostgreSQL: exact self-credit, real-ledger isolation, listing gate, market/partial sale, persistence, duplicate/conflict, concurrent oversell prevention, forced-audit rollback, invalid quantity and blocked/non-admin rejection. Existing Spot MatchingEngine and OrderService suites included.
- 42/42 existing Futures ticker/mobile/parity tests.
- Additional wallet/test-market suites: 97 pass, 25 fail. An untouched snapshot of the exact base produces the same 25 failed assertions in walletUxRefinement and walletOverview (stale source hashes, unresolved toast test import and native-account fixture assumptions). The new FundingView child was added to its isolated render test's import stubs; no new failed assertions remain. This is not a claim that full Jest is green.
- Backend and frontend TypeScript checks pass; production frontend build passes with the existing large-chunk warning.
- Header geometry checks: Futures + Spot at 1920, 1440, 1366, 430 and 390 px; desktop gaps 24 px, no horizontal page overflow, Spot ellipsis absent. Fixture market connectivity is deliberately blocked; this validates layout, not live feeds.
- Private VTA production-bundle browser QA at 1440 and 390 px: prelisting disabled, automatic quote/estimate, post-commit 503 followed by same-key retry, one fill, reload persistence, wallet visibility, zero page errors/overflow. Wallet light-theme contrast inspected and corrected. Reproducible harness: `scripts/qa-vta-demo.cjs` (isolated fixture API; real transaction behavior is covered separately by PostgreSQL tests).
- Existing public VOLTORA listing browser QA passes at 1440, 430, 390, 360 and 320 px with zero writes, errors and overflow.

No account allocation or production sale was performed as part of these tests. The owner's separately authorized manual allocation is 50,000 / 0.011 = 4,545,454.54545454 VTA, without a USDT debit. It is not a fabricated historical purchase.
