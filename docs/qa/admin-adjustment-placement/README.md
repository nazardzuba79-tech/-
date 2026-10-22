# Admin user Deposits: existing balance adjustment entry

Base: 964d62daf07cc545bcf085b2d5836c7f8e913da4. Evidence generated from the built frontend on 2026-10-08.

Only the entry location and related read refresh changed. The existing AdminBalanceAdjustment form, permission guard, API adapter, confirmation, idempotency key and timeout receipt recovery remain unchanged. Delete remains in Additional actions. Unsupported/absent balance data disables the entry with an explanation. Successful adjustment refreshes profile, selected history and admin summary; it does not create a blockchain deposit in the UI. Test balances stay separate.

Validation:
- Five focused suites / 139 tests passed: adminDetailRead, adminAdjustmentRecoveryUi, adminApiCompatibility, adminAuditView, adminDepositRails.
- Frontend TypeScript + Vite build passed; existing bundle-size warning remains.
- New built-browser fixture QA: 26 checks; desktop 1920/1440/1366 and mobile 430/390/360/320. Confirmation/cancel, double-submit, validation/500 errors, two real 15-second timeout cases, receipt recovery and same-key retry after reopening, refresh, audit/deposit separation, legacy incompatibility and admin permission gate passed.
- Existing admin workflow interaction QA: 22 checks passed, including navigation, cancellation, lost-response receipt recovery and no duplicate POST.
- All accounts and receipts were synthetic; HTTP outside the loopback fixture was blocked and all WebSockets closed. No production access, real balance operations, merge or deployment.

Run after frontend build: QA_PLAYWRIGHT_MODULE=<Playwright module> node scripts/qa-admin-adjustment-placement.cjs. CI runs it inside the existing admin-practicality workflow. report.json contains fixture results; screenshots match the final built UI.

- [deposits-1920.png](deposits-1920.png)
- [deposits-1440.png](deposits-1440.png)
- [deposits-1366.png](deposits-1366.png)
- [deposits-430.png](deposits-430.png)
- [deposits-390.png](deposits-390.png)
- [deposits-360.png](deposits-360.png)
- [deposits-320.png](deposits-320.png)
- [confirmation-desktop.png](confirmation-desktop.png)
- [confirmation-mobile.png](confirmation-mobile.png)
- [unsupported-desktop.png](unsupported-desktop.png)
