# Trading bots presentation and shared header

The seven bots are a presentation catalogue, not an execution service. Monthly
figures are explicitly labelled **Модельная доходность** on cards and inside
the detail dialog. The repeated notices below the chart and footer are omitted. No balance,
deposit, order, scheduler, database or backend implementation was changed.

## Behaviour

- Russian catalogue, seven strategies, minimum budgets from $2,500 to $25,000.
- Deterministic synthetic monthly ROI within 120–217%; weekly seed changes at
  Monday 00:00 UTC. Reloading within a week preserves values; an already-open
  page updates at the boundary and also refreshes after focus/visibility changes.
- Drawdowns and seven-day returns are computed from the same model curve.
- Filter, sorting, local favourites, accessible native dialog and budget validation.
- The detail action shows only the selected plan and budget. It does not claim
  a bot was launched. No funds are deducted, and no balance error is fabricated.
- Shared solid graphite header, preserved logo/actions/authentication. Bots have
  a top-level tab next to Futures, plus mobile and homepage navigation entries.
- Shared navigation and homepage use the compact menu below 1440 px. Laptop
  link spacing leaves all product entries readable without clipping.

## Validation

- TypeScript and Vite production build: PASS.
- Bot model, order-panel/navigation and full visual-polish suites: 179 tests PASS.
- Production-bundle browser harness: 181 assertions PASS in Microsoft Edge.
- Exact pair-persistence/header CI harness: PASS at 1440/390; the existing
  known chart teardown warning remains classified by that unchanged harness.
- Latest-main CFD cache-busting regression: 31 tests PASS after sync with #263.
- Catalogue widths: 320, 390, 1024, 1440, 1920 px.
- Futures, Spot, CFD, Markets and signed-out homepage headers: 390, 1024, 1440, 1920 px.
- No page overflow, overlapping header clusters, bot-page uncaught errors or
  non-read API requests. Auth redirect preserved; keyboard menu, dialog Escape
  and focus restoration checked. Open-page weekly rollover checked with a clock.
- Browser checks use loopback and mocked read-only endpoints, not production.

Run with `QA_PLAYWRIGHT_MODULE` pointing to Playwright and optionally
`QA_BROWSER_CHANNEL=msedge`: `node scripts/qa-trading-bots.cjs`.

## Existing failing guard

`sharedHeaderStylesheetOwnership.test.ts` retains four failing assertions.
All four were reproduced on a clean export of main
`a5279a512a1208032a38b29bc0cc537f83f97145`, before this change. Main's subsequent
PR #262 modifies CFD transport and leaves these header styles/tests unchanged.

1. Reset inventory expects older CSS files and forward-slash paths.
2. Windows backslashes prevent excluding eager index.css, incorrectly reporting
   its .page-mesh rule as a lazy-route reset.
3. The same path issue plus existing Archive/FuturesMobile/VoltexTerminalSystem
   header declarations violate the older lazy-style inventory.
4. The path issue attributes the eager stylesheet's burger rules to a lazy sheet.

The guard was not weakened or updated to hide these failures. A separate cleanup
should normalize paths and reconcile stylesheet ownership with the current
approved terminals. This report does not claim a green full Jest suite.
