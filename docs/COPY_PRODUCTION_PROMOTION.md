# Copy Trading selective production promotion — 2026-09-06

## Scope and provenance

- Owner-authorized **pre-launch** production promotion, not public investment-performance verification.
- Base main: `ced48a598c64269880ed00fca712ce1c148298de`.
- Reviewed source: `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86` (`claude/review-ready`).
- Candidate branch: `codex/copytrading-unified-production`; retains the already-tested nginx fix from `d7563ae1e56edfe9bb4dcef88281e836b9766baf` and handoff `6e5641ecac8a508997f61ba08f5694c463ede764`.
- No whole-review merge. Existing main Home, Trading, Crypto Card, Wallet, Futures, Analytics, Arbitrage, auth, matching, market architecture, package locks and Render/Docker configuration are preserved. Main has no separate new reviewed Home Copy section to promote.

## Exact saved Ksenia state

The owner-authorized read-only export captured only the isolated review scenario, not customer/account data. TLS certificate verification and a repeatable-read **READ ONLY** transaction were used; it ended with ROLLBACK. The temporary single-IP `/32` rule was removed immediately afterward. The review database again has an empty external allowlist; a new external connection was denied.

- Source: `CopyReviewScenario` / `ksenia-review-v1`, updated `2026-09-06T06:28:37.452Z`.
- Simulation date: `2026-09-06T23:59:59.999Z`.
- Exact JSON: 7,635,435 bytes; SHA256 `b6d8ba649be521b9a4c3cab725a42b48c80b07988344c7ae19dc4e78436c0380`.
- Public response SHA256: `ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4`.
- Gzip/base64 packaging is lossless, integrity-checked before use, and included by the existing TypeScript/Docker build. No database credentials or real profile pictures are packaged.
- Production persists the exact numeric JSON tokens in a new TEXT column. Only a missing new scenario is bootstrapped; existing state is never regenerated/refitted.

### Historical storage compatibility exception

Review JSONB transport had changed the last binary digits of historical copied quantities. Strict replay rejected these saved records even though every monetary field and fee event reconciled exactly. The canonical follower ledger therefore has one two-line compatibility hook (import and predicate); all replay formulas remain unchanged.

The adapter permits **only** an exact serialized record from the integrity-checked approved Ksenia export, and **only** a quantity difference bounded by `8 * Number.EPSILON * max(abs(old), abs(replayed))`. There is no absolute unit floor. All money, prices, dates, IDs and other fields remain strictly equal. It returns the existing record without changing any value. Modified records, new/future records, fee events and Nazar records do not receive this exception. The persistence adapter also retains historical AUM objects after exact value/key checks, preserving their serialized key order without changing the canonical projection.

## Production isolation and identity

The sole new migration, `20260906190000_copy_performance_promotion`, creates `CopyStrategyOwner` and `CopyPerformanceScenario`. It inserts two strategy bindings by stable existing User IDs; it does not create or update Users, balances, deposits, withdrawals, orders, trades, wallets or security data. Missing owners remain null.

The normal authenticated backend serves `/api/v1/copy-trading/nazar` and `/ksenia`; no review URL, server or database is used. Revision-based compare-and-swap and per-strategy request deduplication preserve append-only history across requests/processes/restarts. Clock rollback cannot truncate the ledger. Existing legacy admin simulation and real execution services are unchanged.

Public identity responses have exactly six fields: `traderId`, `displayName`, `avatarUrl`, `avatarVersion`, `verified`, `premium`. The resolver selects only the bound User's avatar and KYC status. No email lookup or private account fields are returned. Ksenia is premium but NOT verified; her existing User has NOT_STARTED KYC. Normal profile avatar updates are re-read without a deployment.

The existing eligibility source is retained; the threshold is finite deposit/portfolio value >= 20,000 USD only, with no admin bypass or added KYC requirement. Existing local Following behavior remains local; this task does not implement real copy execution.

## Production database preflight

Read-only Neon audit observed **11 User records**, **2 safely identifiable test-pattern accounts** with registration audit entries, and **1 ADMIN**. The owner attests the remaining accounts are internal; database evidence alone does not independently establish that classification. No private emails, credentials or account media are included in this report.

Both bound owners already have avatars. Nazar's KYC is APPROVED; Ksenia's is NOT_STARTED. All 23 migrations from base main were finished without rollback before promotion. Only the new isolated Copy migration is pending.

## Financial contracts

- Nazar Sep6 public response SHA256: `2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2`.
- Nazar Sep5 baseline remains 471 trades / 434 wins / 34 losses / 3 breakevens, 92.7% resolved win rate, approximately 5.79% drawdown, ALL PnL 4,711,027 USDT. Sep6 deterministic append has 472 / 435 / 34 / 3 and 92.8% displayed win rate.
- Ksenia Sep6 remains 446 / 397 / 47 / 2, 89.4% displayed win rate, 8.10% drawdown, 7D/30D/90D/ALL ROI 62/117/468/1756%, master PnL 3,159,321.7816 USDT.
- Ksenia trailing-365D fee exactly 1,275,547.0000 USDT; ALL fees 1,280,964.8601; 48 followers; AUM 5,400,000 USDT. HWM and follower accounting are unchanged.
- The existing cash-flow-adjusted methodology is preserved; this promotion does not relabel it as geometric/GIPS TWR.
- Yellow chart, true daily-return percentage bars, all periods, latest 20 trades, money formatting, secondary catalogue and approved avatars are preserved.

## Disclosure

One clear, non-dismissible application-wide DEMO / PRE-LAUNCH notice is localized in all seven supported languages. It explains internal testing and modeled, unverified strategy histories. Repetitive product-level paragraphs are suppressed only under the provider that always renders this notice; outside it they remain fail-safe. Neutral product information is retained.

## Validation / deployment record

- Backend full regression: **81 suites / 816 tests PASS**. The subsequently tightened serialized-AUM retention and tamper assertions also passed their complete affected persistence suite (7 tests) and targeted integrity/isolation checks. No assertions were removed or weakened. A missing local bcrypt native binary from `npm ci --ignore-scripts` was resolved using the existing locked package's official prebuilt; no dependency or lock changes.
- Frontend: **9 suites / 71 tests PASS**. Backend/frontend TypeScript, Prisma validate and production builds PASS. Existing frontend large-chunk warning remains; no Docker runtime was locally available, so actual container build verification is the existing Render deployment.
- Exact Ksenia bootstrap integrity, raw/public fingerprints, 365D fee, copy/fee/capital/trade/daily/equity/AUM prefix preservation, +1/+7/+30/+90/+365 split/reload progression, CAS races, invalid-history refusal, identity/privacy and auth tests PASS.
- Real nginx regression reproduces old 403 and proves corrected SPA GET/HEAD/navigation/refresh, true WebP/hashed static assets and cache behavior. Baseline/fixed evidence is retained outside Git in QA outputs.
- Normal production-candidate frontend through real nginx and the actual compiled Copy router/service/requireAuth passed browser checks at **1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375**. The local database/session/account adapter is isolated QA only; canonical financial payloads are not mocked. Both profile period sets/latest20, search/Favorites, actual daily percentage tooltips, owner avatar refresh, no Ksenia verification, deposit boundaries/admin-zero, notice/header positioning, F5 and zero page/console/overflow errors passed.

Production verification is recorded separately in the owner completion report. A local test or successful build is not evidence of a live production deployment. Both existing production auto-deploys must be LIVE on the final main SHA before live browser verification. No duplicate manual deploy or service/configuration change is required.
