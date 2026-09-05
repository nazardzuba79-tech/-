# Copy Trading history / footer review — 2026-09-05

Implementation: `a12d0ec3d6cbe0f4d7cbf30cc2dcae9e7b8a56df`.
Started from current review `775541770d8c2f5880f0248b085607080f834d05`.
Delivery target: https://voltex-review.onrender.com/copy-trading.

## Observed cause, not an assumed database deployment

The inspected live review service is frontend-only, on `claude/review-ready`.
Its `review-synthetic.json` is built from the engine, not loaded from Prisma.
Before correction, the profile actually contained 380 daily results and 381
equity points. A nine-pixel-per-day SVG strip exposed only part of ALL on desktop.
The v4 bootstrap forced +841% in the final 90 days alongside +3727% ALL, putting
91.77% of lifetime dollar PnL into those 90 days and making earlier bars tiny.

The backend does have the reported stale-state path: default id `nazara-v1`,
load existing JSON, initialize only when missing/reset. An actual 93-day database
row was **not** observed in review because that service has no backend/database.

## Correction and migration boundary

- Semantically reused the earlier uncommitted additive-history idea, without
  copying the dirty worktree or its proposed +4711% ROI. Both existing dirty
  worktrees and the locally-only 50-page catalogue/Nav changes were preserved.
- v6 generates one full lifetime additive budget with seeded irregular regimes,
  variable daily amplitudes and small losses spaced 5–17 days apart. No repeated
  sine wave, window-specific target or last-day residual deposit. Equity is
  projected through the synthetic trade ledger; UI does not redistribute PnL.
- Retained canonical `targetRoiAll = 37.27` (+3727%) and the owner's previously
  approved 4,711,027 USDT lifetime PnL. Scenario opening capital is derived as
  PnL / 37.27, rounded to 0.0001 USDT. All published ratios derive from equity.
- Review's explicit version is `nazara-review-v6`; build metadata exposes it.
  The approved bootstrap date is pinned to 2026-09-05 (inception 2025-08-21).
  Later builds append elapsed days instead of sliding inception/resetting ALL.
  Existing no-store headers remain; rebuilding replaces the old review sample.
- `PrismaSyntheticStateStore(prisma, { scope: 'review' })` optionally selects
  the new namespace for a controlled backend review. No fallback, deletion or
  overwrite of the legacy row. Default API callers still use `nazara-v1`.
  This path is unit-tested, **not applied to a live database**. The deployed
  review remains a build-time sample, not a continuously running backend.

## Verified baseline ledger (UTC, ending 2026-09-05)

| Item | Result |
| --- | ---: |
| Inception / trading days | 2025-08-21 / 380 |
| Opening / final equity | 126,402.6563 / 4,837,429.6563 USDT |
| ALL PnL / ROI | 4,711,027 USDT / +3727.000% |
| 7D / 30D / 90D ROI | +2.048% / +8.551% / +26.664% |
| Trades / wins / losses | 3,250 / 3,159 / 91 |
| Win rate / Profit Factor | 97.2% / 4.6 |
| Largest day | 25,804.3505 USDT, 2026-01-14 |
| Largest day / ALL PnL | 0.547744% |
| Final seven days / ALL PnL | 2.060909% |
| Four quarter contributions | 25.7583% / 24.2590% / 27.3968% / 22.5859% |
| Losing days | 31, including 7 in the latest 90 |

Trade net PnL and daily realized PnL both sum to exactly 47,110,270,000 units
of 0.0001 USDT, equal to the equity delta. Tests assert this per day, per window
and after advancement. ALL includes every trade/day/equity point; 7/30/90 are
cutoff slices. Follower PnL, cohorts and AUM remain derived by existing logic.

## Presentation / validation

- Full period fits desktop Daily PnL panel by x spacing only. All daily bars,
  original signs/amounts and linear zero-based y scale remain. Narrow mobile
  charts have an internal horizontal scroll; the page itself does not overflow.
- Performance All-Time ROI and ROI · ALL both display +3727.0%.
- Footer retains the real existing Logo. Profile-only light token inheritance
  restores the full dark wordmark and planet, including its background cut.
  Removed SocialRow/X/Telegram/GitHub completely. Five legal links, warning and
  copyright remain. Added profile gutters and space above fixed mobile tabs.
  Logo artwork, top Nav and other page themes are unchanged.
- Backend TypeScript passed; frontend TypeScript passed. 11 relevant suites /
  67 tests passed. Final footer rerun: 4/4. Production Vite build passed (5636
  modules); isolated review build passed (5598). Existing >500kB chunk advisory.
- Actual browser checks at 1920,1440,1366,1024,768,430,390,375: all have 380 bars,
  same ALL KPI values, dark footer mark, five links and no social container.
  Document client/scroll widths match: 1910,1430,1356,1014,758,420,380,365.
  Visually inspected curve/Daily PnL/Performance/footer, period switching,
  ROI/PnL mode and trade history. No new runtime errors. Two older React Router
  v7 warnings belong to the separate port4180 Card fixture, not this page.
- Protected-source diff against starting review is empty for Nav, Logo,
  CopyTradingPage, API routes, Prisma schema, Render configuration and Card.
  No real ledger/account/DB operation. No main merge/push or production deploy.
  Confirm live Render SHA and browser after pushing; local QA alone is not
  evidence that the review deployment has completed.
