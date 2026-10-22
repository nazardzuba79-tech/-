# Quiet browser pause — owner follow-up, 2026-09-30

Agent: ChatGPT. Source: released main `26c67e762a29ab03fc527d5ba18fbc4e0258a0e9` (PR #354).

## Requested behavior

The owner asked to remove the additional «Продолжить» control and keep the values already received on screen; normal page reload should fetch current data.

## Narrow implementation

- `BrowserSleepNotice.tsx` renders no visible UI in active and ordinary sleeping phases. Sleep retains its existing `data-browser-phase` diagnostic marker on an empty hidden span, with no text, status announcement, controls or focus target.
- No Continue/retry button is rendered in any phase.
- Existing validation/synchronization and genuine failure text remain passive statuses. A real failure is not relabelled as a healthy connection.
- No account store, trading component, timer, request cadence, session boundary or financial command handler is changed. Existing known snapshots remain in memory while sleeping. No data is invented for a request that has never succeeded.
- The existing safe automatic resume behavior and native browser reload path remain available; this change does NOT freeze a live trading page forever or allow orders against an unvalidated session. It introduces no new polling, keepalive, storage or database call.

## Regression coverage added

Mounted React/JSDOM tests load the real notice component, real browser lifecycle and real Futures account store with fixture API replies. They cover silent sleep, exact retained figures/timestamps, zero reads during an hour of simulated sleep, passive validation/sync, visible failure without controls, cold-lifecycle fresh reads and logout isolation. Cold-lifecycle reset is a fixture equivalent of new page memory, not a claim of a live browser reload.

## Validation and release boundary

Local clone/dependency installation is unavailable because this runtime cannot resolve GitHub/registry hosts. No local Jest/build or authenticated production walkthrough is claimed. Final-head existing GitHub CI is required; test results will be recorded on the PR after they finish. No test is skipped or weakened by this patch.

The first head `a8af2037` passed Full frontend regression but the existing real-browser idle job expected the `data-browser-phase` marker to remain queryable during sleep. The empty hidden marker preserves that diagnostic contract rather than deleting or relaxing the sleep, zero-request, stream-cleanup, wake-safety and financial invariants. The marker follows the actual lifecycle phase; it does not independently simulate a successful state. A new final-head run is required.

The shared historical `docs/AI_HANDOFF.md`, latest Codex request-cancellation fixes and Claude's separate positions-panel PR #353 are preserved. This scoped handoff avoids replacing the large shared log. No merge, production deployment or infrastructure change is part of this review branch.
