# Release integration — 2026-10-01

The owner requested review and publication of the latest Claude and Codex work.

## Pinned sources

- Initial stable base: `355ce91f978426f1e1fb139bc87f1d3ca9f41693` (Trading Tools and the 500 USD deposit minimum).
- Claude #365: `03ac7a710e85902e750e6ba39ef4c9415039c8bb`, including its explicit catalogue-QA copy-event fixture fix. Includes the copy journal, additive migration, bounded best-effort client outbox, server-only background-work exemption, and manual-credit drawer outcome/identity fixes. No server financial-credit logic changed.
- Codex #366: `ca2e6c6ffb59f54b08352e64bc2d68cc68c5b835`. Scoped TradingTools.css and two presentation headings: warm ivory static grid, white cards and gold accents. Math, transport, defaults, navigation and deposit policy are unchanged.
- During review #366 was independently merged to main as `74d2df1591b6bc70556d7cc442266998a9019907`. This release now incorporates that main, preserving its exact light-design files and canonical handoff instead of replacing already-published work.

Claude's original handoff and detailed local validation remain available in #365 at the pinned source commit; Codex's original review and validation are in #366 and current docs/AI_HANDOFF.md. They are not represented as local measurements by this integration.

## Review follow-up

Review found that clipboard copying resolves asynchronously but the copy logger selects the current session when called. A copy pressed under one session could therefore be reported under a different session after an account switch.

DepositCatalogueDialog now captures the session token before awaiting clipboard completion, and reports only while the same token is still current. Tokens remain local and are never added to the event body or outbox. Storage/logging failure cannot interfere with successful copying. Closing or navigating away from the dialog in the same session still permits delivery.

Added rendered regression cases for same-session completion, account switch, sign-out, replacement session, guest-to-member sign-in, modal unmount, token storage failure, clipboard rejection and logging failure. Exact-head CI is required; no local test execution is claimed by this note.

## Boundaries

A copy event is not proof of payment. There is no automatic matching, attribution or credit. Minimum remains 500 USD/equivalent. Existing watcher cadence, trading guards and financial ledger logic are preserved. No production accounts, payments or balances are used as test fixtures.

The new journal has no polling. Existing admin queue/shell requests are separate and are not described as zero traffic. Events are best effort and may be missing after browser termination or prolonged unavailability.

Publication is allowed only after candidate CI passes and source/main refs are rechecked. Use existing automatic Cloudflare/Render deployment, not an additional manual deploy. Retain the additive journal table on code rollback; do not drop production data.
