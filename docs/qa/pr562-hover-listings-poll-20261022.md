# PR #562 — `spot.1440.data.window`: the listings poll inside the hover window

Base: main `9dd84308f00c19f44f52f5d5ee5aa75a8687b438`. Failing head: `d1569d0258a1636797fe4266dcc9dbe8cc31f424`.

## What failed

`Chart workspace regression / browser`, 221 PASS / 1 FAIL. The one failure is
`spot.1440.data.window`: one `GET /api/v1/market/listings` during the 20 pointer
moves + 400 ms hover window.

| Run | Head | Request time after page load |
| --- | --- | --- |
| 39627524430, job 119316576720 (PR #568) | `2facb47b` | 15303.9 ms |
| 39722062575 attempt 1, job 119637557623 (PR #562) | `d1569d02` | 15328.7 ms |
| 39722062575 attempt 2, job 119641123387 (PR #562) | `d1569d02` | 15343.2 ms |

PR #568 does not touch listings; it failed the same way on the same check.

## Where the request comes from

`managedListingStore` (`frontend/src/lib/testMarketStore.ts`) polls the catalogue
with a self-rescheduling one-shot timer: `schedule()` arms
`setTimeout(refresh, cadence − (now − fetchedAt))`. The QA fixture's AITH row has
`version: 7`, so the cadence is 15 000 ms. The page fetches at about 0.2 s and
again 15 s after that response, at about 15.3 s.

The hover isolation helper (`scripts/qa-hover-interval-isolation.cjs`, from the
PR #501 work, see `pr501-hover-request-cause-20261017.md`) holds only callbacks of
**intervals** armed before the window. A one-shot timer armed before the window
was not covered, so the store's scheduled poll counted as hover work whenever the
window spanned the 15 s mark.

The browser does not go idle here (`BROWSER_IDLE_MS` is 5 minutes), so pointer
input does not trigger the poll through `voltex:browser-activity`.

## Not caused by PR #562

PR #562 does not change `testMarketStore.ts`, `TradePage.tsx`, `browserActivity.ts`,
`scripts/qa-chart-workspace.cjs` or its fixture. Its `testMarkets.ts` change is
presentation only (a paused countdown) plus parsing the `countdown` field; it does
not touch the store's cadence.

Local runs, production bundles of both commits, the unchanged QA script with fetch
timestamps added (`--only timeframes,types,compare,data`, 1440):

| Bundle | Poll at | Hover began | Result |
| --- | --- | --- | --- |
| PR #562 `d1569d02` | 15298.6 ms | 15332.7 ms | PASS, 34 ms after the poll |
| main `9dd84308` | 15294.8 ms | 15608.1 ms | PASS, 313 ms after the poll |

Both start the hover within a few hundred milliseconds of the poll; on CI the
window covered it.

Forced overlap: the hover starts 250 ms before the poll is due (`--only data`):

| Bundle | Helper | Result |
| --- | --- | --- |
| PR #562 | main's | FAIL, poll at 15335.4 ms inside 14981.2–15724.4 ms |
| main | main's | FAIL, poll at 15299.9 ms inside 14987.7–15744.2 ms |
| PR #562 | this fix | PASS, timer held (due 15290.9 ms), poll ran at 15707.2 ms after the window |
| main | this fix | PASS, timer held (due 15303.4 ms), poll ran at 15750.4 ms after the window |

## Fix and retained requirement

Only the harness changes; no product code, fixture or limit. A one-shot timer armed
**before** the window is held like an interval tick and resumed once in `end()`,
which runs from `finally`. It is reported in `periodic.deferred` with
`kind: 'timeout'`. A cleared held timer is never resurrected.

The assertion is unchanged: **zero** HTTP requests, **zero** fetch attempts and no
new intervals during the hover. Timeouts, animation frames, microtasks and intervals
created during the hover still run inside the window and are still caught.

The product is not changed to pause the listings poll on hover: a hover must not
stop real data refreshes. The fixture keeps the versioned AITH row: the 15 s
lease-driven cadence is the behaviour under test.

`chartHoverIsolation.test.ts` gains four checks (11 in total):
- a pre-armed one-shot poll is held, resumed once, and its chain re-arms;
- a timeout armed during the hover still fires inside the window, even at the poll URL;
- a cleared held timer is not resurrected;
- `finally` resumes a held timer after a failed interaction.

With main's helper the first and third fail.
