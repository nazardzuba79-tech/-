# ECLAVO November 6 / +7148% — executed local QA

**These are synthetic loopback-only runs, not production screenshots or proof of a production Draft update.**

- Chromium 156.0.8078.47 / Playwright 1.62.1, actual built frontend, real admin router, real market Worker in workerd/SQLite. Two disposable stores, synthetic sessions, no database or financial writes.
- Browser: **27/27 PASS**, 28 original PNG captures. Eight selected captures are stored here as WebP; source and converted SHA256 values are in `screenshots-map.json`. Full check names and state are in `report.json`.
- Existing Draft: one ordinary CAS PUT, same ID, new revision, seed/profile/wick metadata unchanged, second run sends no write, QVTR snapshot unchanged; saved values read after browser reload at1440/390.
- Canonical actual last price: **1.01472**, nontradable, at252h (`2026-11-17T01:00:00Z`). First24h remains0.1092. 1m/5m/1h, deep falls, continuity, wicks and cap tested.
- Backend build PASS; frontend TypeScript + Vite production build PASS (QA bundle points at loopback, never deploy this artifact).
- Initial targeted Jest:27/27 PASS (scenario controls, QVTR, ECLV at that point). Final ECLV/TYVN/countdown:25/25 PASS, including final-cap restriction and the pre-change88-hour tick fingerprint. Frontend movement:30/30 PASS. CLI CAS guards:8/8 PASS. Worker unit test runner PASS.
- The first local browser run had one QA snapshot-comparison failure. Its exact message is preserved in `initial-failures.json`; fixed by comparing identical full-row projections, then rerun. No assertions about target price or financial isolation were removed.
- Initial config-only endpoint=cap failed the existing3% validator. Narrow, separately reviewed terminal-DEEP_RECOVERY support resolves it; all previously valid paths keep their fingerprint.

## Production status

Not executed. The connected-browser tool repeatedly returns `Browser access requires the originating browser context` despite the owner having an open admin tab. No production Draft ID/revision/state is inferred. No ECLV merge/deploy/publication/timer is authorized or performed here. QVTR PR624 was separately approved and merged as `b2387f96813bee46a37729d5ef0c55523535a1ce`; its production Draft/publication/timer remain unverified.

See [the controlled update/rollback procedure](../../ECLV_LISTING_20261103.md). Exact-head GitHub CI results are recorded on the review PR after execution.
