# CFD baseline closure — 2026-10-03

Agent: ChatGPT. Owner requested finishing the CFD checks and a separate Spot/admin audit prompt.

## Integration

This follow-up preserves the entire current main tree `f56ca46962a466cb41a6bb1b43507dd475cfffc8`, including #397 Futures proportions and #398 isolated admin scenario laboratory. It overlays only the three reviewed files from PR #393 head `d6aa9c41563e877f447997a622adb593e2913ca8` and this record. The PR branch is updated without force, with both prior head and current main as parents.

## Reviewed behavior

- `CfdMarketDataService` keeps display availability, execution approval and quote freshness separate. A retained stale display price is not a usable execution quote: `getFreshQuote` still validates and refuses it.
- Missing quotes are `unavailable`, with independently unverified entitlement and blocked execution where applicable.
- A reference request spends only the remaining configured symbol budget. Concurrent execution requests coalesce.
- The ticker endpoint does not expose bid/ask fields; the route test follows its existing schema.
- Two suites (`CfdQuoteSafety` and `CfdQuoteRoutes`) are included in the CFD workflow. Their quote-age, entitlement, decimal-precision and no-financial-write assertions remain intact.

No runtime service, API, provider choice, pricing, balance, order, database, secret, infrastructure or published-listing change is included. No `.skip`, forced pass or baseline-failure waiver is added.

## Verification status

The follow-up requires fresh exact-head CI before merge: CFD regression and browser checks, backend/collector/frontend builds and other triggered checks. Results at commit creation are pending, not asserted as passed; final run IDs and outcome belong in the PR discussion.

Local full tests were not run: this container cannot resolve github.com for a checkout. Root AGENTS.md was read. The connector returned empty content for the requested AI_HANDOFF.md range, so that large shared file was not overwritten; this is the scoped handoff.

The separate Spot/admin work has not been applied by this PR. Published NRX/VTA histories and their four assigned profiles remain unchanged; the ten-scenario laboratory remains private and isolated.
