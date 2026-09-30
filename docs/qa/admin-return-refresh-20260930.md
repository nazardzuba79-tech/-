# Admin tab-return refresh regression

Base: `14252d2b` (current main fetched 2026-09-30). The historical shared integration ref no longer exists on the remote.

## Cause

The five-minute browser sleep integration emits `voltex:browser-activity` on return from a hidden tab. `createVisibleRead` unconditionally marked every reader dirty on that event. Consequently, Admin's one-hour activity/alert read budget was bypassed on every tab return. There is no second-based Admin users poll. The screenshot's notice is `BrowserSleepNotice` during session validation/synchronization.

## Fix

Make forced wake refresh an opt-out scheduler policy. Only Admin user activity and alert summaries opt out; they reuse a successful, unexpired result. Initial reads, expired reads, explicit mutation invalidation and retries after failure still fetch. A failed refresh invalidates freshness without erasing the consumer's last-good data. Trading readers retain the default forced wake refresh. Session validation, the wake barrier, gesture protection, sleep timers, authentication and financial behavior are unchanged.

The notice can still appear briefly for session validation. This patch does not hide a pending read or pretend validation completed. Production latency was not measured; no authenticated production tab was available.

## Verification

- Before fix: regression failed with `fresh admin data was forced to reload on return`, actual 2 reads versus expected 1.
- Lifecycle/read-budget tests: 46 PASS, including default trading wake, three fresh returns, mutation invalidation, expired data, failed refresh recovery and revoked sessions.
- Admin interactions, activity and Render bandwidth suites: 41 PASS in 3 suites.
- Frontend TypeScript and production build PASS; existing Vite large-chunk warning only.
- Real production bundle against synthetic local API: 26/26 browser checks PASS at 390x844 and 1440x900.
- Three fresh tab returns at each width: 3 session checks; 0 users reads, 0 activity reads, 0 alerts reads; wake notice clears. Hourly active polling and stale wake still work. Hung/failed reads and auth refusal regression PASS.
- Raw browser report/screenshots: local `output/admin-refresh-20260930/` (synthetic accounts only).
- No production reads of customer records, data writes, merge or deployment performed for this fix.
