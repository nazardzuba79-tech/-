# Release integration — 2026-10-01

The owner requested review and publication of the latest Claude and Codex work.

## Pinned sources

- Stable base: `355ce91f978426f1e1fb139bc87f1d3ca9f41693` (Trading Tools and the 500 USD deposit minimum).
- Claude #365: `03ac7a710e85902e750e6ba39ef4c9415039c8bb`, including the explicit catalogue-QA copy-event fixture fix. Includes the copy journal, additive migration, bounded best-effort client outbox, server-only background-work exemption, and manual-credit drawer outcome/identity fixes. No server financial-credit logic changed.
- Codex #366: `ca2e6c6ffb59f54b08352e64bc2d68cc68c5b835`. Only its scoped TradingTools.css and two presentation headings are applied. The light design uses a warm ivory static grid, white cards and gold accents. Math, transport, defaults, navigation and deposit policy are unchanged. Codex's original review and local-only validation are recorded in #366; they are not represented as measurements by this integration.

The Claude handoff in docs/AI_HANDOFF.md is preserved rather than overwritten with a competing source snapshot. This integration record additionally preserves the Codex light-design scope and the review follow-up.

## Integration follow-up

Review found that the clipboard resolves asynchronously but the copy logger selects the current session when called. A copy pressed under one session could therefore be reported under a different session after an account switch.

DepositCatalogueDialog now captures the session token before awaiting clipboard completion, and reports only while the same token is still current. Tokens remain local and are never added to the event body or outbox. Storage/logging failure cannot interfere with successful copying. Closing or navigating away from the dialog in the same session still permits delivery.

Added rendered regression cases for same-session completion, account switch, sign-out, replacement session, guest-to-member sign-in, modal unmount, token storage failure, clipboard rejection and logging failure. Exact-head CI is required; no local test execution is claimed by this note.

## Boundaries

A copy event is not proof of payment. There is no automatic matching, attribution or credit. Minimum remains 500 USD/equivalent. Existing watcher cadence, trading guards and financial ledger logic are preserved. No production accounts, payments or balances are used as test fixtures.

The new journal has no polling. Existing admin queue/shell requests are separate and are not described as zero traffic. Events are best effort and may be missing after browser termination or prolonged unavailability.

Publication is allowed only after the combined candidate passes CI and current source heads are rechecked. Use existing automatic Cloudflare/Render deployment, not an additional manual deploy. Retain the additive journal table on code rollback; do not drop production data.
