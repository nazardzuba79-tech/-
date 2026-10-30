# Issue558 — native browser QA only

Application: `5ed0d70b9efd1b2922d9e234fd2546be1468fbfb`.
CTO order: https://github.com/nazardzuba79-tech/-/issues/558#issuecomment-6313386964

## Actual result: BLOCKED / browser NOT_RUN

Node22.23.3 launched the existing candidate's `local-access-qa.mjs` as a child of
the same process that calls Playwright. The loopback readiness probe passed.
Server exited cleanly with code0 after the browser launch attempt failed.
This removes the previous separate-tool localhost ambiguity for the server probe;
it does NOT prove browser connectivity, because no browser started.

No Chromium executable is installed. The runtime Playwright1.62.1 installer
failed with an invalid/truncated ZIP. A second attempt using the repository's
existing Playwright1.56.1 version also failed: official CDN downloads returned
invalid ZIPs, and the alternate Microsoft download returned HTTP503 with
`upstream connect error or disconnect/reset before headers`.
The actual native launch then failed with missing `chromium_headless_shell-1194`.
Initial logs, result JSON and server stdout/stderr are preserved in `evidence/`.
No additional installer attempts or browser retries are scheduled.

| Requested browser behavior | Actual status |
|---|---|
| Normal login and Stocks navigation | NOT_RUN |
| Native saved-data candle chart | NOT_RUN |
| Viewer BUY/SELL Market/Limit click and Enter | NOT_RUN |
| Two fixture traders reaching existing dispatch | NOT_RUN |
| Logout/revocation closes protected access | NOT_RUN |
| Desktop/mobile screenshots | NOT_CREATED — no browser process |

The prior58 tests are historical PASS only and were not repeated. No PG, Prisma,
Docker, load test or general CI was run. Application/financial source is unchanged.

## Prepared browser runner (not browser-validated)

`run.cjs` uses the existing synthetic-only harness and exact captured Binance
candles. It checks normal UI login, guest API401, viewer market-only projection,
foreign account selector denial, forged order denial, native chart pixels/OHLCV,
click/native Enter and preserved drafts for all BUY/SELL × Market/Limit cases,
1440×900 and390×844, logout and revocation. It records screenshots if Chromium runs.
Each of two fixture traders must reach `submitObserved`; the existing authority
stub intentionally returns503, with no persistence. This verifies UI-to-dispatch
wiring, NOT a new successful financial execution claim. The previous PG/TLS
execution evidence is not rerun or replaced. No real account or secret is used.

Syntax validation is separate from actual browser execution. The runner contains
additional evidence metadata compared with the recorded local launch attempt;
these metadata-only additions have not caused a second browser attempt.

## One inactive Ubuntu24.04 fallback

`browser-qa.yml.template` is outside `.github/workflows`; it cannot run here.
One standard Ubuntu24.04 job, Node22.23.3, Playwright1.56.1, no services or Docker.
It runs only on an explicit `owner-approved-stocks-browser-qa` label applied by
the repository owner to the same-repository branch
`review/stocks-native-browser-qa-20261021`. No push/synchronize/dispatch trigger.
Exact PR-head SHA is checked out and verified; application drift from5ed is rejected.
Credentials are not persisted; permissions are contents-read only. No production
secrets, private backup, environments, deployment or registry publishing steps.
Dependencies install without lifecycle scripts; Vite bundles the browser artifact
only. There is one browser attempt and a15-minute job bound, with failure artifacts.
The frontend CSP and browser routing block external application requests. The
server uses only saved provider fixtures and in-memory synthetic sessions/stubs.

**Not published, not triggered, not approved.** Before publication: obtain separate
owner permission and freshly verify provider deployment triggers for this exact
branch. Then publish the QA-only commit and copy the reviewed template to
`.github/workflows/stocks-native-browser-qa.yml` in a separate reviewed control
commit, open a Draft PR, verify the exact head, and apply the opt-in label once.
Do not use workflow_dispatch from an unregistered branch or merge to register it.
Public GitHub standard Linux runner/free allowance must be confirmed; stop if
billing would be required. No paid runner is authorized.

Risk: publication may trigger existing repository/provider automation; this is
why the fresh trigger check and owner approval remain prerequisites. The proposed
job itself has no production mutation path. On failure, cancel the isolated job;
no production rollback is necessary. Never rerun automatically.
