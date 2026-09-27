# Browser idle sleep — release evidence

Base: `14120a82119a56b1604634cd17029ec17cd8aedb` (fresh-fetched main, 2026-09-27).

## Scope and hosting boundary

The browser stops automatic display work after 300,000 ms without trusted input, or immediately when hidden. This is a per-tab lifecycle, not a backend power-management feature. No hosting configuration, keep-alive, cron, database schema, server execution loop, or financial calculation changes. Always-on Render can serve new users and continue server-side work regardless of sleeping browser tabs. These changes do not make Render Free always-on; hosting availability remains a separate decision.

Returning validates the session once, resumes mounted consumers, and waits for their tracked reads. Duplicate in-flight reads share transport with independent cancellation. The first waking action is consumed. Already-submitted mutations finish and are not replayed. Failed refreshes retain previous data and require deliberate retry. F5 remains available. Login changes remount account-bound UI and discard old-session responses.

Owner-selected chart behavior: remove the external TradingView iframe while asleep and recreate it on wake. Its internal drawings/settings are not promised to survive. The owned VOLTEX chart and order draft stay mounted. Browser sleep does not change TP/SL execution; an unavailable backend cannot be promised to execute stops, and no missed price path is fabricated on return.

## Measured browser request budget

Actual baseline/candidate production bundles, Microsoft Edge headless, isolated loopback fixtures, controlled elapsed clock. These are same-origin HTTP request counts, not measured production SQL or a real 30-minute wall-clock load test. Provider WebSockets are fixture transports: their closure/reconnection is tested without a live external feed. No production accounts or trades used.

| Mounted route / state | Baseline: 30 min visible idle | Candidate: 30 min sleeping |
| --- | ---: | ---: |
| Admin Users | 0 | 0 |
| Admin Deposits | 30 | 0 |
| Wallet | 0 | 0 |
| Futures empty | 786 | 0 |
| Futures position | 966 | 0 |
| Futures orders | 1056 | 0 |
| Spot | 1800 | 0 |
| CFD | 90 | 0 |
| Markets | 99 | 0 |

`request-budget.json` includes initial, first five minutes, sleep, wake and hidden-tab intervals. All 13 candidate scenarios passed (nine desktop scenarios plus Futures at 320/360/390/430 px); nine baseline scenarios provide comparison. Desktop width: 1440 px. Candidate hidden intervals also had zero HTTP requests; streams were closed, no financial command was submitted on wake, session validation occurred once, and no browser errors or horizontal viewport overflow were observed.

`native-restart.json` records nine browser checks at 1440/390 px against the compiled native engine and its local persisted review repository: positions/orders/balance/draft survive backend restart; a waking Buy click submits nothing; failed validation retains state without retry storms; explicit retry recovers; external close is not resurrected; reload retains the resting order; TradingView ownership detaches/remounts correctly. The separate disposable PostgreSQL regression checks persisted native authority after a new client/repository/service instance (47 tests across four suites). No retrospective TP/SL fill is invented.

## Validation / release gate

- Lifecycle, session-body ownership and existing visible-read invariants: **34 passed**.
- Critical Futures/native/authorization/chart regression: **1805 passed, zero failed** (90 passed suites). This run had 41 database-gated skips; the separate PostgreSQL run below covers native persistence/security. CI's full integration job supplies its own database for the broader database gates.
- Disposable PostgreSQL native persistence/security suites: **47 passed**.
- Browser matrix: **22 scenarios** (13 candidate, nine baseline), passed.
- Native restart / error / iframe browser checks: **nine passed**.
- Backend/frontend TypeScript and production bundle builds passed locally. Existing Vite chunk-size warning remains.
- Broad frontend sweep: 2470 passed / 103 failed, 131 passed / 21 failed suites. A final focused rerun fixed the remaining changed inactivity assertion: 23 passed / two unchanged failures in that suite, reducing the combined outstanding count to 102. All 21 remaining failed suites and all 102 remaining failed cases reproduce on the pristine main export with identical local dependencies. `frontend-failure-comparison.json` records the discrimination results, including stale loader/source/hash assertions. These red results are not release sign-off; keep the PR unmerged until the release gate is resolved.
- Cold-open/cache/deployment recovery harness exited successfully, including fresh desktop/mobile Futures, Spot and Wallet routes. This uses local builds and a simulated hosting cache contract, not production navigation.

Local full logs and screenshots are under `output/browser-sleep*` (ignored). The new CI job uploads these artifacts. Physical phone hardware, production SQL savings, third-party TradingView internals and real Render cold-start latency were not measured. Keep those limits separate from the controlled browser results.

Rollback: revert this PR's frontend lifecycle/integration changes; no migration or data rollback is needed. A normal deployment/reload restores prior polling behavior. Do not manually deploy over an automatic deployment.
