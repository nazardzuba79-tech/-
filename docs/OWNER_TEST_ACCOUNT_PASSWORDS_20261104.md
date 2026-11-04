# VOLTEX owner decision — 2026-11-04: access to existing test-account credentials

This file records the owner's explicit product decision, following loss of the previously visible `Админ-панель → Пользователи → Пароль` field. Do not silently remove the owner's ability to recover his existing, self-managed test-account credentials again. Changes to this workflow require the owner's express approval recorded in the relevant GitHub issue or PR.

## Scope of this review candidate

- Restore the **existing historical** `AdminPasswordVault` values to the Users password column in the owner's admin session, **only if** `PRIVATE_TRADING_OWNER_ID` matches the authenticated session's user ID AND `requireAdmin` passes.
- Other admins, ordinary users, anonymous requests, and hidden accounts **must not** be able to obtain vault plaintext. Never expose the vault as an unauthenticated/bulk public API. Page the paged endpoint; no unrelated vault rows may be queried.
- Both legacy and paged Admin Users responses have `Cache-Control: private, no-store`; never include recovered passwords in logs, GitHub issues, CI artifacts, screenshots, telemetry or public error messages.
- The preserved vault records are **historical**. Password changes/new registrations must **not** start making new reversible copies of every user's password: only legacy vault rows can be shown, and missing/undecipherable entries display a dash.
- This is a review change, not a production attestation. The previous security fix #664/#668 deliberately removed recoverable password visibility because such a feature can expose account credentials if an owner session or browser is compromised. This risk is acknowledged; use a dedicated test-credential manager for future accounts rather than weakening general customer credential storage.
- Owner requests that no assistant/Codex/Claude remove this specifically approved owner workflow without discussing it beforehand. Tests must assert exact owner-only access and nonowner denial; do not casually weaken them.
- **Enforcement caveat:** a document and tests cannot make software immutable forever. GitHub branch rules/required owner reviews must be configured by the repository administrator to technically enforce prior approval. Do not claim that documentation alone prevents future changes.

## Release acceptance

1. Validate actual live API, previously stored vault row count (aggregate only), expected owner identity and encryption-key compatibility without retrieving or logging any plaintext credentials.
2. Run exact-head backend/Jest/isolated Postgres and frontend desktop/mobile tests. Confirm owners see **only historical entries**, other admins see null, missing/corrupt vault remains a dash.
3. Release a narrowly reviewed API + Pages candidate on actual live baselines with verified rollback. Do not deploy raw main or revert unrelated #668 fixes.
4. No changes to logins, passwordHash, sessions, deposits, balances, orders, KYC, timers, payment flags or external integrations.
