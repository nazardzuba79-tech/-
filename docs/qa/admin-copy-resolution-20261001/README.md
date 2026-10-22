# Admin copy signals: pending until credit or Ignore

Owner follow-up to #368. Base main: ea5699535ae2ef239b3b741cbac4e3664873343e. No production financial action is part of this task. The shared integration ref returned 404; this is an isolated follow-up to the published feature, preserving current main and concurrent OTC work. The GitHub content reader returned no text for docs/AI_HANDOFF.md, so this supplemental handoff does not overwrite it.

## Behaviour

Unresolved copy signals sort first in the default Users list and participate in its «Пополнения» filter. The counter is a union of users with a pending signal or a real pending deposit, not a sum that counts the same user twice. A bell on the tab flags unresolved copies. Sorting, viewing, opening details, and elapsed time do not acknowledge anything. Explicit last-login sorting remains available; entering «Пополнения» restores work-first order.

«Игнорировать» inserts immutable processing receipts for the selected event and its older duplicates for that exact user/asset/network/address/memo. Newer and other-destination signals remain. Original journal events are retained. The UI replaces the signal only after the server confirms; errors keep it visible. Same-key receipts make retries and competing admins idempotent. An old in-flight Users read cannot restore a locally acknowledged snapshot.

A genuine manual deposit approval captures pending copy IDs before external verification. After all existing financial validation/locks/ledger/referral work succeeds, only captured copies for the credited user/coin/network and actual treasury recipient are acknowledged inside the same transaction. A rollback leaves the money and signals unchanged. A replay returns before resolution, so it cannot clear new copies. A copy is not payment evidence and never chooses a beneficiary or an amount. A legitimate deposit remains creditable with no copy, or after Ignore.

## Storage and budget

No schema migration or new table. Existing immutable AuditLog receives one deterministic-primary-key resolution receipt per processed copy. The existing Users copy-summary SQL adds a NOT EXISTS primary-key lookup; browser request count and background cadence are unchanged. No new polling, WebSocket, timers, notifications, market or blockchain requests.

Ignore is one explicit POST, with auth/role checks, a short acknowledgement transaction and a next-pending-summary read. It is exempted server-side from waking unrelated loops. Actual credit adds one candidate read and, when matching copies exist, one batched INSERT in its existing transaction. No per-user HTTP requests or per-row SQL loop. These are design counts, not measured production billing.

## Verification

New route/query tests and rendered Users tests cover authorization, counter/filter/sort, non-expiry, duplicate clicks, failure, next-signal handling, and session change. The guarded localhost PostgreSQL harness verifies real persistence, double-admin Ignore, newer events, exact credit, unrelated rails/recipients, no-copy credit, failure, transaction rollback and replay. Existing frontend/admin/deposit suites still run. No claim of a test pass before exact-head CI completes. The working container cannot resolve GitHub/npm, so execution is via isolated CI with synthetic data only.

Preserved: #367 logging and clipboard guard, #368 layout, deposit minimum 500 USD, financial eligibility/proof/idempotency rules, OTC, trading and previously published designs.

## Review continuation — ChatGPT, 2026-10-01

Head e228925f8e23a937e9bfbe5dfdd2136ad8272c84 failed seven new rendered-page assertions in three workflows. The fixture set visibilityState to visible but retained JSDOM's hidden=true; the actual browserActivity guard correctly suppressed its initial activity read, leaving deposit counts unknown. Correction 21e20e01194ee29804169593f77b6f11f06108cb aligns both document visibility properties, as the existing Users fixture does, and adds an assertion that the initial activity request really ran once. No production code, financial checks, assertion expectations, or idle guards were weakened. Exact-head CI and the disposable PostgreSQL check must pass before promotion; no local test pass is claimed.
