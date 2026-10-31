# ECLAVO November 6 / +7148% — executed local QA

> **2026-10-31 superseding production receipt:** ECLAVO is already published (active version 1, draft revision 4) with the November 6 / 1.01472 configuration. Do not run the private-Draft importer or the old 89c3 rollout/rollback procedure. Historical observations below are dated evidence, not current instructions. See [current production reconciliation](../../release/ECLAVO_659_RECONCILIATION.md).


**These are synthetic loopback-only runs, not production screenshots or proof of a production Draft update.**

- Chromium 156.0.8078.47 / Playwright 1.62.1, actual built frontend, real admin router, real market Worker in workerd/SQLite. Two disposable stores, synthetic sessions, no database or financial writes.
- Browser: **27/27 PASS**, 28 original PNG captures. Eight selected captures are stored here as WebP; source and converted SHA256 values are in `screenshots-map.json`. Full check names and state are in `report.json`.
- Existing Draft: one ordinary CAS PUT, same ID, new revision, seed/profile/wick metadata unchanged, second run sends no write, QVTR snapshot unchanged; saved values read after browser reload at1440/390.
- Canonical actual last price: **1.01472**, nontradable, at252h (`2026-11-17T01:00:00Z`). First24h remains0.1092. 1m/5m/1h, deep falls, continuity, wicks and cap tested.
- Backend build PASS; frontend TypeScript + Vite production build PASS (QA bundle points at loopback, never deploy this artifact).
- Initial targeted Jest:27/27 PASS (scenario controls, QVTR, ECLV at that point). Final ECLV/TYVN/countdown:25/25 PASS, including final-cap restriction and the pre-change88-hour tick fingerprint. Frontend movement:30/30 PASS. CLI CAS guards:9/9 PASS. Worker unit test runner PASS.
- The first local browser run had one QA snapshot-comparison failure. Its exact message is preserved in `initial-failures.json`; fixed by comparing identical full-row projections, then rerun. No assertions about target price or financial isolation were removed.
- Initial config-only endpoint=cap failed the existing3% validator. Narrow, separately reviewed terminal-DEEP_RECOVERY support resolves it; all previously valid paths keep their fingerprint.

## Historical production status — superseded 2026-10-31

Actual cloud-browser ADMIN access is restored. The SAME existing ECLV private Draft was moved date-only toNovember6,revision3; reload and actual first24h Preview PASS. Cap0.518/finalRecovery0.435 remain pending the approved runtime upgrade. Seed/logo/other fields preserved; **no ECLV publication or timer**. Its approved production PNG is now preserved in the candidate, replacing the historical repository SVG. Exact PNG hash is locked by tests.

QVTR was absent; one authorized private Draft was created in production,revision1. Fields and logo match after reload, first24h Preview0.1092, full300h/301candle Preview0.818. It was subsequently published as version1 and its native timer started once under explicit owner permission. Actual main-domain Spot search, Markets card/navigation, approved logo, date, initial price and decreasing countdown after reload PASS. See production-countdown.jpg and updated production proof in the QVTR evidence directory. Actual screenshots are under `docs/qa/listing-qvtr/`; `production-preflight.json` records read-only evidence without user identifiers or credentials.

Production API is89c3ac003b44a6a0e7630d2ecbe5d7164e85b683, older than main/History20. An isolated two-file backport is prepared and locally built/tested on that exact base; see `production-api-source-compat.json`. Do not deploy whole main. A separate Node22 CI job compiles/tests the exact production source plus the patch.

Cloudflare Google sign-in returned `Unable to sign in`; no retry loop or configuration change. Current Pages SHA and immutable Worker version are still unverified. PR627 has frontend-release priority through its agreed operator. Owner has now authorized necessary narrow task actions. No ECLV merge, API/Worker/frontend deploy, publication or timer has been performed. See [controlled update and rollback](../../ECLV_LISTING_20261103.md).

All16 workflows on1f423a28 passed; follow-up exact-head results are recorded on PR628 when complete. Screenshots from the new local run use the actual approved production PNG; local publication/timer remains isolated test activity.

Operator coordination supplied12:50UTC: canonical frontend source `a7593324be9118cfda91ee8fc6bad0b6ff3acba9`, deployment `9dbc9e80` from23October; auto-deployOFF/previewsnone. This is explicitly attributed coordination evidence, not a Cloudflare observation from this cloud session. Main advanced to`e27117a61d191cbc03456abaf5e88fa38bdf5d62` after627; review branch reconciles that main while preserving Referral and scenario changes. PR627 retains the first frontend operator slot. No History20 archive rights or financial gates may be activated.

The77adbb34 exact-head run had15/16 successful workflows. Native attempt1 timed out after browser install consumed12m09s; one retry completed but exposed a QA expectation bug during the still-forming funding minute (4settlements vs5expected). The unchanged production replay intentionally waits for the completed boundary candle. A new real-engine regression reproduces both incorrect expectations RED and passes after correcting ONLY the QA helper to wait60seconds; it also verifies original-quantity liability survives a close during that minute. No financial implementation, funding rates or balances changed. New exact-head CI is required for this QA correction.

Hetzner read-only access is restored. Current immutable image and retained rollback tag, full existing Compose overlays and runtime-bootstrap mounts are recorded in production-preflight.json. No image/container/config change performed. Cloudflare current Worker identity still needs authorized operator access. Preserve627frontend priority and all History20 source/runtime changes during later composition.
