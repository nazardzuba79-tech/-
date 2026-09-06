# Ksenia isolated review implementation

Base: `9f248d178fed08342e115488a417d1630c45c362` (`claude/review-ready`).
Feature: `codex/copytrading-ksenia-real-profile`. Staging only; no real execution.

## Identity and isolation

Owner-confirmed stable external identity ends `5245fd`. No email lookup, import
of customer records, or production connection is used. `CopyStrategyOwner`
stores public strategy name and an optional local User FK plus canonical external
owner ID. The read-only resolver selects only User.avatarUrl and KYC status by
that stable ID in the *same environment*. It returns six allowlisted fields,
never internal IDs/email/roles/balances/security or KYC documents. Profile media
is validated against the existing raster data-URL storage format, versioned by
content hash, refreshed on window focus/every 60s, and never written by this task.
Production activation later requires applying the migration and configuring the
strategy ownership rows. Nazar's owner must be bound to his actual User ID, not
the viewer. The existing featured-photo endpoint remains backwards compatible.

Production profile avatar confirmed; staging mirror uses fallback because raw
production avatar media was intentionally not copied. Ksenia: K, no Verified
(owner-confirmed NOT_STARTED). Nazar: existing N fallback; no photo invented.
Neither owner is included in the fictional avatar-art mapping.

Dedicated `src/review/server.ts` imports no financial/account/auth services and
refuses any DB except the authorized Render internal host and voltex_review_db.
It runs migrations only after that guard, persists a separate CopyReviewScenario,
accepts only allowlisted GET/HEAD requests, and never creates a User or real
financial entry. No financial jobs, production credentials or queues are used.
The frontend proxies only identities/Ksenia GETs to the fixed review origin;
all previous account/write restrictions remain. The LOCAL QA fallback is explicit
and refused on Render. Nazar's runtime calendar route is unchanged.

## Baseline reconciliation — 2026-09-06 UTC

Inception 2025-08-06, 13 calendar months / 396 elapsed days; 372 active sessions.

| Metric | Canonical value |
|---|---:|
| 7D ROI | 62% |
| 30D ROI | 117% |
| 90D ROI | 467.9999998661382% |
| ALL ROI | 1756.0000000669306% |
| Master net PnL | 3,159,321.7816 USDT |
| Total / winning / losing / breakeven trades | 446 / 397 / 47 / 2 |
| Resolved-outcome Win Rate | 397/444 × 100 = 89.4144144144% → 89.4% |
| Additive performance-index Max Drawdown | 8.099999976527371% → 8.10% |
| Profit Factor | 23.491505772956558 |
| Sharpe / Sortino | 25.50752125945619 / 145.08675665970284 |
| Annualized volatility (365-day convention) | 63.45325902637514% |
| Average net trade | 7,083.681124663677 USDT |
| Average holding | 684.3452914798206 minutes |
| Minimum / maximum daily return | −3.4120875556% / +14.2863057222% |
| Active followers / committed AUM | 48 / 5,400,000 USDT |
| HWM fee | 10% |
| Trailing 365D fee earnings | **1,275,547.0000 USDT** |
| ALL fee earnings | 1,280,964.8601 USDT |
| ALL gross / net follower PnL | 12,809,648.1000 / 11,528,683.2399 USDT |

ROI sums cash-flow-adjusted daily PnL/capital-at-risk, never geometric
reinvestment. Private operating target is 180,000; account drawdown may reduce
capital at risk; weekly surplus is withdrawn. Deposits never repair return
budgets. All amounts use 4-decimal fixed-point reconciliation; period error below
0.000001 percentage points reflects priced execution precision, not display
normalization. Risk is the approved additive index, not a bank/account drawdown.
Large monetary display rounds only the presentation. High ratios are uncapped
properties of an explicitly synthetic scenario, not verified investment results.

Four nested interval budgets are solved before priced executions. Day weights
and weekly regimes vary deterministically. Outcomes include mixed sessions and
zero-net trades whose price movement covers actual simulated costs. Each net
trade reconstructs from entry/exit, quantity, both fee legs and funding; margin
and sequential execution slots are checked. No final-day balancing execution.

Each six-member cohort contributes 675,000, independently totaling 5.4M.
48 irregular join dates and variable allocations include two pre-policy small
allocations. A common pre-execution utilization input `.230262537333357`, times
cohort factors .85–1, was solved by monotone bisection of the actual HWM ledger
at baseline. This defines roughly 19.57–23.03% allocated-capital exposure from
each join date. No fee event/PnL is overwritten to meet the target. The resulting
365D sum independently matches exactly at four decimals. ALL differs by the
older 5,417.8601 in fee events. Daily fees apply only to new cumulative copied
profit above prior HWM, not losses or recovery below the old peak. AUM excludes
copied gains/fees. Future state persists the same cohort input and does not refit.

## Preservation and validation

Nazar financial JSON SHA-256 before/after:

- Sep 5: `5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2`
- Sep 6: `2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2`

Approved yellow renderer, histogram, statistics, trade table, homepage/market
hero, existing CSS and secondary financial/visual catalogue are fingerprinted.
Ksenia is additive and naturally second at baseline; future sorting uses actual
data. Existing Nazar positioning remains unchanged. No main/production changes.

Local backend/frontend TypeScript and production/review builds pass (existing
large-chunk advisory). Independent priced/capital/HWM tests, baseline anchors,
Nazar hashes, identity/privacy/DB guard, and +1/+7/+30/+90/+365 serialized
append-only tests pass. Actual built-preview browser passed 1920/1440/1366/1280/
1024/768/430/390/375: search, favorites, profile, period bars 7/30/90/396, latest20
trades, disabled funding-gated Copy, no horizontal overflow or page errors.

The pre-existing Following implementation is localStorage-based, not server-side
copy execution; this task preserves it and does not claim otherwise. No staging
balance/eligibility bypass is introduced to simulate an executable Copy button.
The deployed environment remains explicitly synthetic and disables account actions.

## Isolated staging delivery — 2026-09-06

Frontend `https://voltex-review.onrender.com/copy-trading` and dedicated backend
`https://exchange-api-review.onrender.com` deployed review commit `afe627a3fb1ea93a41b7234cb470eefebf9a0334`.
Backend service `srv-daeiv4f40ujc73fe6dn0`, Node22/free/Oregon, starts only
`node dist/review/server.js`, health check `/health`. Existing frontend service
`srv-dadf50id0e5s73dplnpg` forwards only allowlisted GETs using its review-only
backend origin. Neither production service was modified.

Authorized private DB: `voltex-review-db`, ID `dpg-daei409t0dsc73aat5jg-a`;
credentials omitted. All25 migrations applied successfully in this initially
empty isolated database. Health checks execute SELECT1 and confirm isolated-review.
Free database expires **2026-10-06**; no billing upgrade was made. Initial backend
startup correctly refused missing DATABASE_URL; after its private Dashboard setup,
deployment succeeded. No production database read or copied customer account/media.

Live nine-width browser QA passed all requested widths, four period bar counts,
latest20, search/Favorites/profile, no horizontal overflow/page errors; All Traders,
sorting and empty Following were additionally checked in the owner browser.
Ksenia has no Verified badge. Six-field public identity has no email/owner UUID/
private metadata. Backend and frontend-proxied payloads match exactly. All12,043
numeric response fields match local canonical math within floating transport tails
(largest difference7.28e-12); monetary values match at canonical four-decimal precision.
Live365D earnings are exactly1,275,547. Current live Nazar hash matches the original
September6 hash above; existing profile graph and avatars remain unchanged.

Live QA identified Prisma JSONB transport rounding sub-machine tail digits in
nested numbers. The follow-up stores the state as an encoded JSON string within
the existing JSONB column, preserving exact JS numeric tokens across DB restarts.
Existing published object state is migrated losslessly from its stored representation,
never regenerated/refitted. No financial target changed. A restart/append test covers
this encoding. Public Ksenia response hash before this storage-only follow-up:
`ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4`.
Verify it again after the follow-up reaches live. Final relevant suite run before
that fix:35/35; affected suites after fix:12/12, including new persistence test.
Existing dependency audit reports8 vulnerabilities (4moderate/3high/1critical);
not introduced by this feature, and no blanket breaking dependency upgrade applied.
