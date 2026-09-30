# Admin brief tab-return verification

Base: `23fc145b` (current main, fetched September 30, 2026).

## Reproduction and cause

PR #346 stopped redundant hourly Admin data reads but still invoked the global
session-validation and synchronization barrier after every hidden tab return.
That barrier displayed "Обновляем данные…" and blocked input even during a brief
tab switch. A regression test with an unavailable validation endpoint failed
before this correction because validation was invoked unnecessarily.

## Correction

An already active Admin route can resume directly after a brief visibility pause
before its original five-minute inactivity deadline. Hidden transports still stop.
The shortcut requires the same route and session and no outstanding session reads.
Initial access, long/idle returns, account or route changes, pending reads, failed
wakes and in-flight validation retain the full recovery path. Non-Admin routes do
not opt in. Server authorization, trading, accounting and UI styles are unchanged.

## Executed validation

- Lifecycle and idle read-budget Node suites: 53/53 PASS.
- Focused Admin interaction, activity and bandwidth Jest suites: 41/41 PASS.
- Frontend TypeScript and Vite production build: PASS; existing chunk-size warning.
- Synthetic browser Admin QA: 26/26 PASS at 390px and 1440px.
- Three brief returns at each width: zero additional `/me`, users, activity or
  alerts requests, no lifecycle notice and usable search input. Validation endpoint
  deliberately hangs if called, proving this is not a hidden loading indicator.
- Initial 401/403, network/503/malformed/timeouts, retry, hourly stale data, full idle
  wake, session revocation and customer-session rejection remain covered and pass.

Reproduce with `node --test scripts/test-browser-activity.cjs scripts/test-idle-read-budget.cjs`
and `node scripts/qa-admin-gate.cjs` using the local Playwright/Chromium environment.
Browser fixtures contain no production account data and perform no production writes.
Local screenshots: `output/admin-brief-return-20260930` (untracked QA artifacts).

Full recovery after the actual five-minute inactivity boundary still displays its
normal validation/synchronization status. Deployment verification is recorded in
the release response after CI, merge and the production Pages revision are verified.
