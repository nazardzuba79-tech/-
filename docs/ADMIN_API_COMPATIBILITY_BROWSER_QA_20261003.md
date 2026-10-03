# Admin API compatibility browser evidence

Review-only verification of the actual Vite production build, served with synthetic localhost fixtures. No production authentication, database, infrastructure or financial execution was used.

## Matrix and result

Both backend contracts were exercised: the current paginated API and a legacy API returning 404 for the new page/profile/history/work-summary endpoints. The same routes were checked at 1920×1080, 1440×900, 1366×768, 430×932, 390×844 and 360×800.

Routes: Users, user profile, deposits, withdrawals, KYC, OTC, deposit addresses, audit log and listings.

| Evidence | Frozen before (`d9b52648`) | Candidate after |
| --- | ---: | ---: |
| Screenshots | 108 | 108 |
| Browser scenarios completed | 108 baseline captures | 121 regression scenarios |
| Legacy Users rows rendered per page | 0 | 20 |
| Legacy Users blocking messages | Summary unavailable; record not found | None |
| Uncaught browser errors | 0 | 0 |
| Unexpected console errors | 0 | 0 |
| External network requests | 0 | 0 |
| Financial mutation requests | 0 | 0 |
| Horizontal overflow | 0 captures | 0 captures |

The baseline is an observation, not a claim that its broken legacy behavior passed regression tests. All 121 candidate scenarios passed.

## Interaction coverage

Each backend mode was tested at all six widths:

- Fixture balances, KYC and account state are visible; a missing password remains a dash.
- Search and active/blocked filters, page two, account navigation and Back preserve the exact query/filter/page URL.
- Opening a profile does not fetch history; the legacy aggregate profile endpoint is first called only after opening a balances/history tab.
- History requests are limited to the selected tab. Unsupported legacy Futures/CFD histories display an explicit availability message.
- Delete Cancel and Escape send no mutation requests.
- All sidebar destinations open, mobile navigation closes and no destination overflows horizontally.
- A deliberate modern Users 500 does not trigger legacy fallback; the error remains explicit and manual Retry recovers.

## Boundaries and expected diagnostics

Legacy capability detection produced 126 expected 404 responses in the candidate run. These are recorded individually; they are not uncaught application errors. The 500 scenario is deliberately injected and separately checked. A response-level guard fails on every other HTTP status of 400 or greater, including unexpected legacy-route or asset errors; console filtering cannot hide these responses.

The fixture server returns `ran:false, skipped:NOT_DUE` for the existing deposit watcher entry request. It recorded 12 such POST requests before and 24 after (the candidate also traverses the sidebar). These are not counted as financial writes; the report retains every request. No real watcher or transfer ran.

Google Fonts stylesheet imports are blocked by the fixture CSP before any external request. Their known CSP diagnostics are recorded separately (324 before, 363 after); no other console errors are ignored. Both screenshot sets therefore use the same local fallback-font conditions.

Before/after builds use the same effective catalogue-disabled flags. The initially supplied `VITE_DEPOSIT_CATALOGUE_ENABLED` and `VITE_DEPOSIT_COPY_RESOLUTION_ENABLED` names are not the application's catalogue enable flag. The enabled-catalogue CI suite uses the real `VITE_MANUAL_DEPOSIT_CATALOGUE=true` flag separately; these comparison screenshots do not claim to exercise that mode.

A separate candidate build with the exact CI flags (`VITE_API_URL=/api/v1`, `VITE_MANUAL_DEPOSIT_CATALOGUE=true`, `VITE_DEPOSIT_CATALOGUE_URL=http://127.0.0.1:4402/api/v1/deposit-catalogue`) also passed all three suites: 32 existing responsive captures, 18 workflow interaction checks, and 121 compatibility scenarios with 108 additional captures. The interaction suite includes a deliberate synthetic balance mutation to verify lost-response recovery; it executes only against the fixture server and is separate from the zero-financial-write read/cancel matrix.

The Windows sandbox could not launch Playwright's full `chromium` channel (`spawn UNKNOWN`). The compatibility runner used the working bundled Chromium headless shell; the existing 32-capture and 18-interaction suites used installed Edge. CI retains its Linux Chromium configuration. No application change or weakened assertion was used to resolve the local browser-launch limitation.

## Reproduction and artifacts

The new runner is `scripts/qa-admin-api-compatibility.cjs`, invoked by `scripts/qa-admin-practicality.cjs` with `QA_COMPATIBILITY=1`. Set `QA_FRONTEND_DIST` to the built candidate, `QA_VARIANT=after`, and `QA_OUT` to an evidence directory. The existing admin-practicality workflow runs it with the enabled-catalogue build as an additional gate.

Local artifacts are under `output/admin-api-compatibility/`:

- `before-dist/` and `after-dist/`: frozen actual builds.
- `before/compatibility-results.json` and `after/compatibility-results.json`: layouts, scenarios, expected errors, all fixture requests and write guards.
- `before/*.png` and `after/*.png`: matching screenshots for all 108 cases.
- `before-build.log`, `after-build.log`, `before-browser.log`, `after-browser.log`.
- `enabled-dist/`, `enabled-screens/`, `enabled-interactions/`, `enabled-compatibility/` and their corresponding logs: separate CI-flag verification.

The fixture preview exposes `/__qa/admin-api-comparison` for matching before/after selections by backend mode, route and width. The files remain local and are not a production preview.
