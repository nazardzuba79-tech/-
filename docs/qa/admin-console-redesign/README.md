# Admin console redesign — review evidence

Base: freshly fetched `origin/main` at `ab564ae46dcbad3b2e6f4ea8bed874eb4115961b`.
Branch: `codex/admin-console-redesign`, created from that main, separate from inverse/options/CFD work.
No merge, deployment, production access, environment change or migration was performed.

## Behavior and scope

- Compact light operations console: 216px sidebar, grouped navigation, overview at `/admin`, searchable tables, sticky headers, scroll contained inside tables on mobile.
- Deposit addresses are asset-first rows derived from the admin wallet response. One public treasury address remains stored per chain. A shared indicator and the editor's affected-rail list explain the relationship.
- Save/reset require a second confirmation with chain, affected rails, old and new/default public address. Existing PUT/DELETE endpoints and audit writes are unchanged. Basic format checks are advisory/conservative, not checksum or ownership verification.
- The wallet GET response adds public `defaultAddress` and `nativeDepositsSupported`. Native TRX is not supported by the existing verifier. Bitcoin does not gain token rails from arbitrary token configuration. No verifier/configuration/storage semantics change.
- One admin-only aggregate endpoint supplies total users, users with pending KYC, pending withdrawals and credited deposits today. Credited deposits count the existing transactional `DEPOSIT_CREDITED` audit events in a UTC-day window, not deposit creation time.
- Unmatched incoming count is explicitly unavailable (`null` / em dash): the existing provider feed is best-effort, bounded and skips failed networks. A fabricated global count would be misleading. The overview links to the feed.
- Products navigation, route, lazy page and four unused admin API methods are removed. Backend products, Prisma Product/Purchase and user purchase APIs/history remain because they have business references and removal could affect data or user features.
- Balances, credit/matching/withdrawal handlers, treasury mutations/audit, authorization middleware, market data and financial/execution services are preserved. `api.ts` before the admin methods and its support suffix compare byte-identical to the base after removing the new overview declaration. The existing full-file Futures API fingerprint was updated for the reviewed admin-only changes; no assertion was skipped.

## Rails shown by the local QA configuration

These are **synthetic configured fixtures**, not a claim about production configuration. The deployed UI will use the actual backend response and will not invent USDT or native support.

| Asset | Network | Standard | Shared address in this fixture |
|---|---|---|---|
| BTC | Bitcoin Network | Native | BTC only |
| USDT | TRON | TRC-20 | USDT only; native TRX absent |
| ETH | Ethereum | Native | ETH + USDT |
| USDT | Ethereum | ERC-20 | ETH + USDT |
| BNB | BNB Smart Chain | Native | BNB + USDT |
| USDT | BNB Smart Chain | BEP-20 | BNB + USDT |
| SOL | Solana | Native | SOL + USDT |
| USDT | Solana | SPL | SOL + USDT |
| TON | TON | Native | TON + USDT |
| USDT | TON | Jetton | TON + USDT |

Other configured tokens receive their network's standard and share its address. Unconfigured networks are identified without claiming supported rails. Historical unknown/free-text withdrawal network values remain visible; the helper does not guess a chain from the asset alone.

## Browser QA

Actual headless Microsoft Edge against the locally built production frontend. API responses are synthetic fixtures, visibly marked in every screenshot. External requests are aborted. The local harness accepts only fake treasury save/reset; financial writes return 405. No signed-in production admin session was used.

`scripts/qa-admin-console.cjs` reproduces the checks after a frontend build, using installed Playwright (`QA_PLAYWRIGHT_MODULE` can point to an existing installation) and Edge. `QA_FRONTEND_DIST` optionally selects a local bundle.

- All seven pages checked at 1440x900, 1920x1080, 1366x768 and 390x844: 28 layouts, no page errors or horizontal page overflow.
- Ten configured address rails fit each desktop viewport. Measured address-row height: 48.5px; sidebar: 216px.
- Real native dialog opens, lists ETH and USDT together, sends no write before confirmation, then exactly one Ethereum PUT, and refreshes both rows.
- Mobile navigation opens as a drawer. Narrow tables scroll internally.
- React interaction tests additionally cover reset, failed save/retry state, cancellation and allowed/denied admin gating. Existing backend route tests cover authentication and mutation/audit behavior.

Machine-readable results: [browser-results.json](browser-results.json).

1440x900 captures: [overview](overview-1440x900.png), [deposit addresses](wallets-1440x900.png), [deposits](deposits-1440x900.png), [withdrawals](withdrawals-1440x900.png), [users](users-1440x900.png), [KYC](kyc-1440x900.png), [audit log](audit-log-1440x900.png), [address confirmation](address-confirmation-1440x900.png).
All other requested sizes are alongside these files.

## Validation commands

```text
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath src/api/routes/__tests__/adminUsers.test.ts src/api/routes/__tests__/adminDeposits.test.ts src/api/routes/__tests__/adminWallets.test.ts src/api/routes/__tests__/adminWithdrawals.test.ts src/services/__tests__/TreasuryWalletService.test.ts frontend/src/lib/__tests__/routeCodeSplitting.test.ts src/api/routes/__tests__/adminAuditLog.test.ts src/api/routes/__tests__/admin.test.ts src/api/routes/__tests__/adminOverview.test.ts frontend/src/lib/__tests__/adminDepositRails.test.ts frontend/src/lib/__tests__/adminConsoleInteractions.test.ts frontend/src/lib/__tests__/futuresTickerHeader.test.ts
node node_modules/typescript/bin/tsc
cd frontend
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

Focused results: 95/95 admin/rail/routing tests plus 20/20 Futures header preservation tests, 12 suites total. Backend TypeScript, frontend TypeScript, production Vite build, QA script syntax and `git diff --check` pass. Existing dependencies were reused through local node_modules junctions; no lockfile or dependency change.

The full repository Jest suite was run in both the candidate and a pristine worktree at the exact base, with `--runInBand --silent --json`.

| Full suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Pristine base | 2585 | 50 | 17 |
| Final candidate | 2603 | 50 | 17 |

**Zero new regression failures.** All 50 failed assertion identities match the base exactly. Both runs exit 1 because main already has failures. [regression-results.json](regression-results.json) records the exact failed assertion names, not just totals. No financial or unrelated test failures were repaired or hidden. Initial candidate had one additional API fingerprint failure; the reviewed admin-only fingerprint update described above restored that suite, and the complete candidate suite was rerun afterward.

Complete material file list: [changed-files.txt](changed-files.txt).

## Remaining manual verification

- Review with real staging admin permissions and actual configured rails after separately authorizing a deployment. Production configuration and public treasury addresses were not queried for this task.
- Exercise treasury save/reset on a disposable staging setup and inspect actual audit records; local tests cannot prove production DB/provider connectivity.
- Verify KYC document rendering with authorized staging fixtures, real-world very long identifiers and keyboard/clipboard behavior in the team's browsers.
- Confirm overview aggregate performance on staging data volume. No production DB query or benchmark was performed.
- Incoming-provider completeness remains an existing limitation, explicitly disclosed in the interface.

## Local start-page follow-up (after published head a4416eb)

The first screen now shows up to five newest registrations, available incoming transfers, and pending KYC before the KPI totals. Users/KYC load independently of the provider feed. Links open the user detail, select the matching KYC user and highlight/scroll to the selected deposit in the existing queue. No financial action is performed by these links.

Follow-up validation: 39/39 focused tests; frontend TypeScript and Vite build; all 28 local browser layouts and user/KYC/deposit navigation checks PASS. Screenshots/browser-results reflect this follow-up. Full regression-results.json above remains evidence for the earlier published candidate; the full suite was not rerun for this local UI change. The update is local for owner preview, with no push/deployment.

Deployment preparation: the owner subsequently approved publication of this local follow-up. Final focused suite now passes 118/118 across 12 suites, and backend TypeScript passes. Runtime changes are the reviewed start-page follow-up only. No merge/deployment is implied by this preparation entry.
