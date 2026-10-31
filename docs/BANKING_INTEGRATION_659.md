# Banking integration candidate — Issue 659

Main baseline: c1f13828c5d398c6792c2a20be551a7132ecf77a.

## Composition

- #656 exact commit 2bbaca1be203997ba8937b2e4c7f51225a0ee575: calendar fixture clamp, pinned clock, disposable PostgreSQL CI. No production math change.
- #657 exact commits 4d2c2408f8ebdd37702ccd04a01d728f1e973078, d87beb8f1ca5c79c2bc6c3277625b58dda7233ef, dcd93171663f0403303ed637cabe7878da62a863: real BankingPage browser review, preserving its original 70 checks.
- Narrow customer correction discovered in authenticated live failure state: unavailable Banking state displayed activeCount 0 and an empty placements statement. The two JSX expressions now show an unknown em dash while loading/absent; a successful zero state still shows 0 and the existing empty message. No new wording, CSS, rate, calculation, financial API or schema change.
- Browser fixture adds loading/failure modes and eight assertions at 1440/390. Preview server binds loopback and accepts query parameters. No production API calls in this harness.

## Evidence

Calendar/math 100/100 local PASS; original browser 70/70 PASS. Expanded fixture 78/78 PASS locally. GitHub run41204666241 executed all78 checks successfully on final loading expressions, then failed only the obsolete expected-count70 assertion. The workflow now requires exactly78 passing checks and also triggers on the actual covered Banking component/API/CSS. Final-head CI remains authoritative. Full exact-head workflow results must be read, not inherited from earlier head 5eaab99c.

Pages deployment metadata declares source 9ed179c697ea86dc6fb97dbbfa5b8674705f2e57, deployment 8ac0fa93-4230-408c-a7a5-f8c29cb4ebee. BankingPage source blob in this baseline equals current main byte-for-byte BEFORE this patch, verified with git show. This does not establish whole-main release compatibility. Fresh public HTTP evidence on 31 October also found a provenance mismatch: release-build.json declares 21b105602e5c79d32d2f9fe82b3c110171e22a33 and the actually served root entry is index-wS4Z9N50.js (SHA256 3f7a3a730be51bd7c78ee55bea12830dcac603fe7f505966a43806507a6fe1cb). The exact 9ed179c6 CI artifact 12959472968 instead references index-oD3uJukg.js. The immutable Pages deployment URL also serves index-wS4Z9N50.js; this is not established as a custom-domain-only cache issue. Treat installed full frontend source as UNATTESTED until the uploaded artifact is reconciled. No runtime replacement or cache purge is authorized.

Local production-base patch: G:/Codex/voltex-evidence659/banking-unknown-state.patch, SHA256 3c2d8371b3a50dbe48ce8f643c9eada522616795581aa67525b804e9410ddae1. Only frontend/src/pages/BankingPage.tsx. The patch is a source candidate, not a published or sealed built artifact.

## Controlled promotion and rollback

1. Require all applicable CI for the final branch SHA. The new customer correction must not be reported deployed until a separate owner-authorized frontend release.
2. Resolve the live artifact provenance mismatch first. Before permission, create a source/artifact candidate from the attested installed Pages base (9ed179c697ea86dc6fb97dbbfa5b8674705f2e57 is currently a metadata claim only), apply only this two-expression patch, preserve the existing deployment build environment and all feature OFF settings, run the targeted browser review and seal artifact hash. If live base changed, stop and reconcile; do not deploy the whole integration branch/main.
3. Owner permission is separately required for code-only main integration and frontend deployment. No API release, migration, balance or timer operation is needed.
4. Retain deployment 8ac0fa93-4230-408c-a7a5-f8c29cb4ebee as frontend rollback. After approval, switch only Pages to the reviewed artifact; verify identity, authentication, loading/failure and successful zero states at 1440/390. Regression: restore that exact retained deployment. No database rollback is involved.
5. Code-only rollback: reviewed revert of the integration merge. Keep #656/#657 tests when reverting only customer behavior.

## Live financial read boundary

POST /api/v1/wallet/portfolio-snapshot can persist an analytics row; GET /banking/state can settle accruals. The earlier Wallet visit returned recorded:true and must not be called read-only. The route writes an analytics snapshot, not a balance/ledger. Do not delete that record. Subsequent restricted browser QA blocked both routes BEFORE navigation. Actual me/config/referral reads returned 200 at 1440 and 390 after reload; full live settlement and cross-user flows remain NOT_VERIFIED.

Conversion activation is not approved. #630 remains NO-GO for unresolved legacy provenance and a financial counterexample; #629 must not be redeployed from its obsolete base. Copy Trading, Futures and Wallet UI remain owned by Claude and unchanged here.
