# Opt-in native test account access

## Scope
An explicitly approved second USER account already has DemoBalance credits, but ordinary Wallet reads do not show them. Do not credit the same amounts again or move them into Balance/FuturesBalance. This change adds a narrow server-side native tester permission without promoting any USER to ADMIN.

## Activation (not performed by this PR)
After reviewed merge and production deployment, set `PRIVATE_TRADING_TEST_USER_IDS` to the comma-separated UUIDs of ONLY the owner-approved test accounts. Default is empty. Keep the existing `PRIVATE_TRADING_ENABLED=true` and primary `PRIVATE_TRADING_OWNER_ID` unchanged. IDs are server configuration, not frontend flags, role claims, emails or balance heuristics. No production account IDs are committed here.

The allowlisted USER may access its own native ledger and public chart candles. Its ordinary ADMIN permissions remain absent and the legacy private engine remains owner-only. The real Futures policy refuses these IDs even when the native feature is temporarily disabled. Test funds remain in DemoBalance/NativeDemo tables and cannot back real orders or withdrawals.

Do not remove the allowlist entry to temporarily pause testing: turn off private trading while retaining the ID so the real Futures fence stays closed. Revoking/deleting a test identity is a separate operational action after reviewing its open native positions. Invalid configuration grants no native access.

## First wallet read
GET is read-only. Before initialization, the Wallet projects existing DemoBalance rows through the same collateral, account and wallet-row functions with zero amount transferred into the still-absent trading ledger. It returns initialized=false. It does not create a deposit, credit, native account, position or revision. After initialization, use the standard native Wallet response. A concurrent initialization is re-read to avoid combining pre-debit holdings with post-credit settle cash.

The existing Futures activation control calls the existing idempotent initialize endpoint after the account accepts the model. USDT moves from DemoBalance to the native ledger exactly once. Other assets stay collateral. No SQL repair script or impersonated user session is introduced.

## Verification
The focused CI suite must check allowlist parsing, owner policy preservation, blocked/revoked users, current session ownership, native-only route access, USER admin refusal, own-account scoping, pre-init wallet totals and repeated initialize without a second debit. Existing native authorization/isolation/browser workflows remain in force.

No CSS, Wallet design, fees, PnL or trading-engine math is changed. No production balances, user roles, sessions or Render environment were changed by implementation. Production login and trading on the approved secondary account still require release/activation and an actual user verification.
