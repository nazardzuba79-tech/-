# Spot idle browser CI repair

## Exact failing source and job

- Published PR #345 head: `b343c355`; local equivalent: `e92951c794d1a05faa1576723170d8284521cbd8`.
- Equivalent tree: `89edcb0caa4bebef2790bb7524f3532a4c767ff5`.
- Failing workflow: [Spot idle reads and session payload, run 36604258045](https://github.com/nazardzuba79-tech/-/actions/runs/36604258045).
- Failed browser job: `109529122125`. Builds, the deterministic idle/auth suite, and existing JWT/admin/Spot regressions passed before that step.

The original harness was reproduced locally with the exact source. A diagnostic observation before its unchanged cancel click found `phase: validating`, Open tab unselected, and History selected. The click was consumed by the wake guard, so the subsequently requested cancel button remained hidden. The harness also supplied obsolete public market payloads and returned HTTP 503 for the current NRX/managed public catalogues. A caught-exception trace confirmed `market_http_503` followed by `Resume read failed`.

## Narrow repair

Only `scripts/qa-spot-idle-reads.cjs` changes. Book rows, candle pair/interval identity, public snapshot metadata, rankings and asset-icon payloads now match the current consumers. Exact public catalogue paths on `market.voltextech.net` are fulfilled inside the test; no external request is sent.

The harness waits for the actual authoritative wake barrier to finish before its next deliberate interaction. It now also asserts exactly one session validation on return and no additional validation from duplicate visibility events. All previous cadence, hidden-read, account refresh, cancellation, unexpected-write and browser-error assertions remain active. No application source, authorization, financial endpoint or workflow gate changes.

## Verification

- Fresh frontend TypeScript/Vite and backend TypeScript builds passed on the equivalent source.
- Original browser harness: failed at the same cancel-button step as CI; `before.json` contains its additional observational phase snapshot.
- Corrected production-bundle browser harness: passed at 1440 and 390 pixels; see `after.json`.
- Each width: zero open-order/history/chart-trigger reads during 12.5 seconds hidden; one immediate account-reader refresh and one session check on return; duplicate visibility events trigger no extra refresh; one explicit fixture cancellation succeeds; zero other writes and zero page errors.
- `node --test scripts/test-idle-read-budget.cjs`: 14 passed, zero failed/skipped/todo; see `idle-budget.log`.
- Script syntax and `git diff --check` passed.

Browser runtime: Node 24.19.0 and the locally available Chromium 153 executable through the existing disposable Playwright adapter; explicit `en-US` browser locale. All account responses and the cancellation use isolated fixtures. Remote logs were read only; this lane did not push, rerun CI, merge, deploy or access a production account/database. Final exact remote CI remains the root release gate.
