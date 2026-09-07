# AI Handoff Log

## 2026-09-06 — Codex global prelaunch banner removal / contextual Copy notice

- Owner authorized production deployment after accepting removal of the global banner with one concise explanation retained only beside modeled Copy Trading results. Branch `codex/contextual-copy-notice` starts from freshly fetched main `9cf83c51fde6498c0d4e4d416508f1807c1eb6b0`; this commit carries the complete isolated change.
- Removed exactly the App `PrelaunchApplication` import/wrapper and deleted unused `PrelaunchNotice.tsx` / `prelaunchNotice.css`, including global sticky positioning offsets. Added one seven-language, normal-flow `CopyTradingNoticeScope` only in Copy Trading. `ReviewDisclosure` suppresses duplicate paragraphs within that scope, preserves neutral information and retains standalone fail-open behavior. There is no replacement global warning or dismiss/persistence logic.
- Preserved all routes/auth helpers, legal pages, general risk copy, trade/card/other products, backend/schema, dependencies, configuration and financial histories/calculations. Copy cards, charts, Nazar/Ksenia outputs and existing component/style/data files are byte-unchanged. Preservation tests retain their original hashes with exact wrapper-line normalization only.
- Validation before promotion: frontend TypeScript and production build PASS; frontend Jest **28 suites / 422 tests PASS**; independent final diff review and `git diff --check` PASS. Vite initially hit sandbox `spawn EPERM`; the authorized retry completed successfully with only the existing large-chunk warning. Built assets: `index-DxG4iJJQ.js`, `index-CCqgdQ25.css`.
- Deployment authorization is main fast-forward/push and existing production auto-deploy only; no Render configuration changes. At commit time deployment and live route verification remain pending, and must be checked against this exact SHA before reporting DONE. Preserve the unrelated untracked local `outputs/` artifacts.

## 2026-09-06 — Codex — independent nginx SPA refresh fix; promotion not performed

- Fetched all remote branch refs before work. Actual main: `ced48a598c64269880ed00fca712ce1c148298de`; review: `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86`. Created isolated worktree/branch `codex/copytrading-unified-production` from current main, not review. Read current handoff, KSENIA_REVIEW and NAZAR_PROFILE_CORRECTION on review.
- The requested production promotion also required removing all disclosures identifying invented profiles/synthetic investment results. That part was declined; no Copy Trading productionization, identity binding, migrations, production traffic, main push or deployment was performed. A transparent synthetic/demo presentation or verified real performance data is needed before continuing that promotion.
- Implemented only the independent nginx bug fix in `d7563ae1e56edfe9bb4dcef88281e836b9766baf`: `frontend/nginx.conf` now uses `try_files $uri /index.html;`, so a physical avatar directory cannot win over the SPA route. Existing static-file handling and cache headers are unchanged. Added `scripts/qa-nginx-spa.cjs`.
- Real HTTP regression on official portable Windows nginx1.30.4 PASS: baseline reproduces403 for `/copy-trading`, trailing slash and query; candidate serves exact index content with200. Tested `/`, `/copy-trading`, `/copy-trading/`, query/nested profile route, `/trade`, `/futures`, `/markets`, `/wallet`, `/card`, repeated GET and applicable HEAD. Real repository WebP avatar returned byte-for-byte unchanged with correct MIME; Vite-style JS/CSS fixture bytes and immutable cache preserved; missing hashed asset404, asset directory403/no listing. nginx configuration syntax PASS; script syntax and git diff checks PASS; independent review found no blockers.
- Limits: this is an actual nginx routing test with minimal HTML/JS/CSS fixtures, not a frontend build or React browser test and not the production Alpine container. No production hard-refresh/deployment success is claimed. Evidence is ignored `node_modules/.cache/nginx-qa/http-TNvJ4b/result.json`; portable binary and temporary files are not committed. Only loopback test processes were started and stopped.
- Preserved all main application/backend/schema/financial files, existing Claude/Codex work, review infrastructure and all other worktrees. New Spot terminal, 24H/7D backend additions, Crypto Card, Wallet, Analytics and unrelated review features were not imported. This feature currently contains only the nginx fix, its regression script and this handoff; it is NOT a unified Copy Trading production candidate.

This log is the shared communication channel between Claude Code and Codex for VOLTEX.

## 2026-09-03 — Integration baseline
- Agent: ChatGPT coordination pass
- Commit: `c9d0a9a90b6cc0b693556872a482fa60102f6573`
- Task: merge the previously diverged Claude and Codex histories into one shared baseline.
- Base histories combined: Claude tip `e5b956751d7c7084fddf818549119ad9417d7dbc` + Codex tip `172011c9307edf7909bbc13400f804d56750194b`.
- Copy Trading: Codex versions were selected for `syntheticCopyTrading.ts`, `CopyTradingPage.tsx`, `copy-trading-bolt/components.tsx`, `CopyTradingBolt.css`, plus `SyntheticProfilePeriods.test.ts`, preserving the latest Codex marketplace/profile work.
- Trade overlap: Claude's newer versions were retained for the overlapping Trade files instead of blindly replacing them with the older Codex branch state, preserving order-book grouping/spread, market sorting, drawing-tool improvements and later terminal functionality.
- Important unresolved item: Codex commit `172011c...` contains approved Spot Trade visual-reference changes. Those visual deltas remain in Git ancestry but must be reconciled deliberately on top of Claude's newer Trade functionality against the approved ZIP. Do not restore the old Codex Trade files wholesale.
- Homepage: Claude's latest homepage remains the current implementation; known visual-reference deltas should be corrected on the shared branch against the approved homepage ZIP.
- Next step: all new Claude/Codex work must start from `integration/claude-codex` and append a handoff entry here after completion.

## 2026-09-03 — Spot Trade correction integration
- Agent: Codex
- Source commit: `6f2e2bc518773e0cdca55aa947c31b840cf70762` from `codex-test`.
- Integration code commit: `6213ac4`.
- Task: semantically port the approved Spot Trade visual/reference corrections onto the latest shared integration baseline without merging or cherry-picking the older branch wholesale.
- Files integrated: `OpenOrdersPanel.tsx`, `OrderBookPanel.tsx`, `OrderForm.tsx`, `PairListSidebar.tsx`, `i18n.tsx`, `TradePage.tsx`, and `TradeTerminal.css`.
- Ported behavior: Markets title/collapse/resize geometry, slash-enabled pair search, Favorites, data-backed USDT/USD/USDC/EUR filters, real sort controls, Order Book grouping/collapse/spread styling, clickable price rows, Open Orders count and empty state, compact order-family tabs, and the supported OCO tab.
- Claude functionality deliberately preserved: live WebSocket/REST market flow, memoized/throttled order-book aggregation, calculated spread, stable market sorting, current icon/data handling, pair deep links, chart and drawing tools, real order submission and validation, authentication/permissions, and all unrelated Homepage, Copy Trading, Futures, and Analytics work. `pairList.ts` was intentionally not replaced because the integration implementation already contained the newer real sorting behavior.
- Validation: frontend TypeScript passed; 5 relevant suites / 44 tests passed; browser QA passed at 1920, 1440, 1280, and 1024 px with no page-level horizontal overflow or runtime errors. Search, quote filters, sorting, Favorites, market and order-book collapse, grouping, real spread, price selection, Buy/Sell, Limit/Market/Stop/Take Profit/OCO, chart, and drawing tools were exercised successfully.
- Build note: the official Vite build reached and passed TypeScript, then the sandbox denied Vite's esbuild child-process spawn with `EPERM`. A production-mode native esbuild bundle of the same frontend sources completed successfully; this is an execution-environment limitation, not an application compile failure.
- WebSocket status: the Kraken market WebSocket was available during QA; live prices updated and no reconnect banner was present. No connectivity warning was hidden or mocked.
- Unresolved: no known Spot Trade code regression. The Vite child-process `EPERM` remains specific to the restricted QA environment.

## 2026-09-03 — Homepage Hero Crypto Card correction
- Agent: Codex
- Commit: `f6cb76edf36a0339ea8dfa83ba7b78bcb2089595`
- Task: remove the physical Crypto Card and its Hero-only presentation wrappers from the Homepage Hero while retaining the approved terminal-and-phone composition.
- Files materially changed: `HomeHero.tsx`, `HomeCryptoCard.tsx`, `HomeCardSection.tsx`, and `HomeMarkets.tsx`. The latter three contain documentation-only cleanup reflecting that the Hero no longer owns an animated card.
- Preserved: `/cards/voltex-card-dark.png` unchanged; both dedicated Homepage Crypto Card presentations; shared real market-feed hook; routing, responsive behavior, navigation, authentication/permissions, scroll reveals, reduced-motion handling, and all non-Homepage product areas.
- Validation: frontend TypeScript passed; 3 relevant market-feed suites / 41 tests passed; browser QA passed at 1920, 1440, 1366, 1280, 1024, 768, and 390 px with no page-level horizontal overflow or runtime errors. Hero card count was zero at every width; both dedicated card images remained present and loaded successfully after lazy-scroll. Hero CTA targets, mobile menu, scroll reveals, and reduced-motion CSS coverage were verified.
- Build note: the official Vite build was blocked by the known restricted-environment `spawn EPERM` while loading `vite.config.ts`; a production-mode native esbuild bundle completed successfully, and the QA CSS was processed with the installed Tailwind CLI.
- Unresolved: no additional clear Homepage reference regression found in this scoped audit. `main`, Render, and production were not touched.

## 2026-09-03 — Registration + real email verification
- Agent: Claude
- Registration source commit: `1c3e1ab56ed2f5f25ef9bbe80419834bab9bfbe3` (on the now-stale `integration/homepage-plus-codex-test`). Ported **semantically** onto this branch, not merged: the six `pages/register/*` files were taken verbatim, and the seven shared-file edits (route, i18n keys, AuthPage register tab, Settings `?tab=`, HomeHeader CTA, `home.css` reset, Tailwind tokens) were re-applied by hand onto the current versions. The stale branch was never merged and nothing on it was force-pushed.
- Task: land the approved `/register` screen and replace "register issues a session immediately" with a real six-digit email verification step.

### What changed in auth
- **Before:** `POST /auth/register` created the user and returned a JWT — the account was live at once, and nothing proved the address existed.
- **After:** `POST /auth/register` creates the user with `emailVerifiedAt = null`, issues a challenge, emails the code, and returns `{verificationRequired, challengeId, maskedEmail, expiresInSeconds, resendAvailableInSeconds, emailDelivered}`. **No token.**
- `POST /auth/verify-email` `{challengeId, code}` — validates server-side and, only on success, marks `emailVerifiedAt` and issues a token through the existing `createSession` + `issueToken` path. No second auth mechanism.
- `POST /auth/resend-verification` `{challengeId}` — invalidates the old code, issues and sends a new one. Keyed by challenge id, never by email, so it cannot be used to probe which addresses are registered.
- `POST /auth/login` — a correct password on an unverified account returns **403** `EMAIL_VERIFICATION_REQUIRED` with a freshly-issued challenge (no session). The frontend forwards that into the verification step. Verified users, including every pre-existing account, log in exactly as before. The check sits ahead of the 2FA branch.

### Database / migration
- Migration `20260903170000_add_email_verification`.
- `User.emailVerifiedAt DateTime?`, added NULL then **backfilled to each row's own `createdAt`**, so no established account is retroactively locked out. Only rows created after the migration start as NULL. Verified on the local database: 164/164 existing users came out verified.
- New `EmailVerificationChallenge` — `codeHash`, `expiresAt`, `attempts`, `consumedAt`, `lastSentAt`, `userId` with `ON DELETE CASCADE`.

### OTP policy
Six digits from `crypto.randomInt` (uniform, no modulo bias) · 10-minute expiry · single use (`consumedAt`) · max 5 attempts per challenge · 60-second resend cooldown · issuing a new code deletes the previous challenge, so an old code dies the moment a new one is sent. **The code is never stored:** the database holds `HMAC-SHA256(code, EMAIL_VERIFICATION_SECRET)`. A plain digest of six digits is brute-forceable offline from a dump; the keyed digest is not, and the key never enters the database. The code never appears in an API response, an audit-log entry, or any log line. Comparison is `timingSafeEqual`.
- Route limiters (express-rate-limit, as elsewhere in this repo): register 20/hour, verify-email 20/15min, resend 10/hour, all per IP, on top of the per-challenge attempt counter and cooldown.
- Audit events reuse the existing `AuditLog`: `USER_REGISTERED`, `EMAIL_VERIFICATION_SENT`, `EMAIL_VERIFIED`, `EMAIL_VERIFICATION_ATTEMPT_LIMIT`.

### Mail
`VerificationEmailService` reuses the same nodemailer SMTP configuration as the support and KYC mailers (`SMTP_HOST/PORT/SECURE/USER/PASS`). Unlike those, it **reports failure**: `send` returns false, registration answers `emailDelivered:false`, and the UI says the code could not be sent rather than showing a code screen for mail that never left. A transport can be injected, which is how the tests run without a relay.

### Password rule
Frontend and backend now enforce **identically**: 10+ characters and at least one uppercase letter. The backend previously required 10 with no uppercase rule while the approved hint said "8+". The backend was **not** weakened; the UI hint states the real threshold. No digit/special-character/lowercase requirement was added. Existing test fixtures using lowercase passwords were updated to match the stated policy.

### Files materially changed
- Backend: `src/services/EmailVerificationService.ts` (new), `src/services/VerificationEmailService.ts` (new), `src/api/routes/auth.ts`, `prisma/schema.prisma`, `prisma/migrations/20260903170000_add_email_verification/`, `.env.example`.
- Frontend: `pages/register/{RegisterPage,RegisterVisual,RegisterPanel,Field,PasswordField,OtpInput}.tsx` + `register.css`, `lib/api.ts`, `lib/i18n.tsx`, `App.tsx`, `pages/AuthPage.tsx`, `pages/SettingsPage.tsx`, `pages/home/HomeHeader.tsx`, `pages/home/home.css`, `tailwind.config.js`.
- Tests: `src/services/__tests__/EmailVerificationService.test.ts` (new), `src/api/routes/__tests__/emailVerification.test.ts` (new), `src/api/routes/__tests__/auth.test.ts` and `account.test.ts` (fixtures updated to the real password rule and to the migration's backfilled state).

### Preserved from Codex
Fast-forwarded onto `9f9116c` before pushing. The Spot Trade correction (`6213ac4`) and the Homepage Hero card removal (`f6cb76e`) are untouched — no file in either overlaps this work, and `HomeCryptoCard`'s props are unchanged, so `RegisterVisual`'s use of it still matches. Trade, Futures, Copy Trading, Analytics, Wallet and the Homepage were not modified beyond the two lines noted above (`HomeHeader` CTA target and the `home.css` reset).

### Also fixed here
`home.css`'s scoped reset was rewritten with `:where()`. Written plainly, `.vx-home button` scores 0,1,1 and beats a Tailwind utility's 0,1,0, which was silently swallowing the active market tab's own `bg-white/[0.08]`. The registration reset carries the same guard, plus `border: 0 solid` rather than `border: 0` — Tailwind's `border` utility sets only a width and takes its style from preflight, which is off in this project.

### Validation actually run
- `prisma validate` passed; `prisma migrate deploy` applied cleanly against the local database; backfill verified by query.
- Backend TypeScript, frontend TypeScript, and the frontend production Vite build all passed on this branch (no `EPERM` encountered in this session's environment).
- Backend suite: **62 suites / 609 tests passed**, including 18 new service tests and 27 new endpoint tests.
- Browser QA against the running app with a **real SMTP session** (a local sink on :2525 that speaks RFC 5321, so nodemailer genuinely connected, sent, and got a 250 — the code was read out of the delivered message, not out of the API): registration → code screen with no token stored → wrong code shows "Осталось попыток: 4" and still no token → the real code returns 200 and stores the token → "Аккаунт создан". Paste of six digits works; typing digit by digit works; the resend countdown ticks down from the server's own value. Login with an unverified account returned 403 and landed on the verification step with the code already re-sent.
- Responsive at 1440/1366/1280/1024/768/390/375: no horizontal page scroll, all six cells in view at every width (41px at 375px), zero console/page errors.
- Lint: **not run — this repository has no lint script or ESLint config** in either package.

### Requires real-provider verification
Delivery was proven over SMTP against a local sink, not against the production relay. Before enabling this in production, set `EMAIL_VERIFICATION_SECRET` and confirm one real send through the configured provider (deliverability, From: address, spam placement). Nothing about delivery is mocked in application code — with no `SMTP_HOST` set the app reports `emailDelivered:false` rather than pretending.

### Unresolved / next
- ~~`EMAIL_VERIFICATION_SECRET` currently falls back to `JWT_SECRET` so an existing deployment does not fail to boot.~~ **Superseded by the security-hardening entry below — the fallback has been removed and the variable is now mandatory.** Rotating it invalidates outstanding codes (they expire in 10 minutes anyway).
- Old unverified accounts accumulate rows; a periodic cleanup of expired, unconsumed challenges would be reasonable but is not implemented.
- `main`, Render configuration, production secrets, DNS and production deployment were not touched.

## 2026-09-03 — EMAIL_VERIFICATION_SECRET is mandatory and independent of JWT_SECRET
- Agent: Claude
- Branch: `integration/claude-codex` only. `main` untouched, no merge, no force-push.

### The change
`EmailVerificationService` used to key its HMAC with
`process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET`. That fallback is
**gone**. The two keys protect different things: a leaked session-signing key lets an
attacker mint sessions; a leaked verification key lets them derive a valid six-digit
code for any pending registration. Sharing one value means either leak costs you both,
and the verification key can never be rotated without invalidating every live session.

New module `src/config/emailVerificationSecret.ts` is the single source of the rule:

- **Required.** `requireEmailVerificationSecret(env)` throws when the variable is
  absent, empty, or whitespace.
- **No fallback.** A set `JWT_SECRET` no longer satisfies email verification.
- **No reuse.** Setting the two variables to the same value is also rejected, so the
  fallback cannot be reintroduced by configuration.
- **No hardcoded default, never generated at runtime.** A per-boot key would silently
  invalidate every outstanding code on restart and differ between instances.
- **Never echoed.** Neither error message contains the secret value — only the variable
  name — so a startup failure can be pasted into an issue safely.

`assertEmailVerificationSecretConfigured()` is called in `src/index.ts` as the first
statement after the import block, so a misconfigured deployment dies at boot rather
than accepting registrations it can never verify. The service reads the secret lazily
(per call) so importing the module in a test does not require the variable; the
process-wide requirement is enforced by that startup gate.

### Test bootstrap
`jest.setup.ts` (new, wired via `setupFiles` in `jest.config.js`) sets a deterministic
test-only `EMAIL_VERIFICATION_SECRET`, deliberately different from the test
`JWT_SECRET` because the gate rejects equality. **Production validation was not
relaxed to make tests pass** — the tests supply the variable the same way a real
deployment must.

### Tests added
`src/config/__tests__/emailVerificationSecret.test.ts` — returns the configured secret;
throws when absent; empty/whitespace treated as missing; **does not fall back to
JWT_SECRET**; rejects the two being equal; accepts a dedicated secret with no
`JWT_SECRET` present; never puts the value in the error message; no hardcoded default;
stable across calls rather than generated. Plus a real-process test that spawns
`src/index.ts` with `JWT_SECRET` set and `EMAIL_VERIFICATION_SECRET` unset (and dotenv
pointed at a non-existent file) and asserts a non-zero exit, the message naming the
variable, and that it never printed `Exchange API listening`.
`src/services/__tests__/EmailVerificationService.test.ts` gained three cases: refuses to
hash with only `JWT_SECRET` set; the digest is unrelated to a `JWT_SECRET`-keyed HMAC;
the full issue → verify flow still works with a dedicated secret.

### Validation run
`prisma validate` OK · backend `tsc --noEmit` OK · **backend suite 63 suites / 624 tests
passed** (was 62/609) · frontend `tsc --noEmit` OK · frontend production Vite build OK ·
`grep -rn EMAIL_VERIFICATION_SECRET frontend/src` → no matches (never reaches the client
bundle).

### `.env.example`
Documents the variable, why it must be separate, and how to generate one
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). The line
stays **commented out with a placeholder** — no real value is committed.

### DEPLOYMENT PREREQUISITE
`EMAIL_VERIFICATION_SECRET` is now **mandatory**. The backend will **fail to start**
without it. Before this branch is ever promoted or deployed, the production environment
must be given a dedicated, randomly generated `EMAIL_VERIFICATION_SECRET` that is
**not** the value of `JWT_SECRET`. Setting it was intentionally left to the operator —
this session set no production environment variables and touched no Render
configuration, DNS, or deployment.

## 2026-09-03 — Markets page refinement against the Bolt.new Markets reference archive
- Agent: Claude
- Branch: `integration/claude-codex` only. `main`, Render, and production untouched.

### Reference used
The user's attached archive (`projectboltsb1uhsf3eve.zip`) contained a header-variant
showcase under `src/header/` plus a separate, self-contained `src/App.tsx`/`src/index.css`
that IS the Markets implementation the task described — market rows, marketCap, sectors,
Favorites, Spot/Perpetual/Futures/Options tabs, sparklines, sort/pagination. That App.tsx
was the visual/interaction reference; `src/header/*` was unrelated to this task and left
alone.

### Starting point
The current `/markets` page (`frontend/src/pages/markets-bolt/{components.tsx,markets.ts,
MarketsBolt.css}`) is already a prior, thorough port of the same reference family onto real
data — it was not rebuilt. This task compared the two carefully and applied only the
genuine, real-data-backed gaps found; it did not touch unrelated pages.

### Corrections applied
1. **Market Cap column was missing from the main table despite real data already existing
   for it.** `markets.ts`'s sort function already had a working `case 'marketCap'` branch
   reading `rankByBase.get(base).marketCap` (real CoinGecko data), and the sort `<select>`
   already offered "Капитализация ↓/↑" — but there was no visible column, so the sort had
   nothing to look at. Added a `Кап-ция` column (with its own sort-button header, matching
   the pattern already used for Price/Change/Volume) between Volume and Chart, using
   `formatCompactUsd(ranking.marketCap)` with an honest `—` when a pair's base isn't in the
   ranked set. Also added to the mobile card's detail line. Table column widths, the
   colSpan on the loading/empty states, and the `td:nth-child` chart-centering rule were
   recomputed for the new 9-column layout; the ≤1050px responsive tier now also hides this
   column (alongside High/Low, which it already hid).
2. **Market Data card hierarchy didn't match the reference.** The reference's card leads
   with Total Market Cap (+ its own 24h % change) as the one large headline figure, with
   Volume/BTC Dominance/ETH Dominance as a supporting 3-cell grid below. The port had it
   backwards (Volume as headline, Market Cap buried as a small secondary cell). Swapped:
   `totalMarketCapUsd` + real `marketCapChangePercent24h` are now the headline
   (`.metric-primary`, new CSS block); the grid below is Volume/BTC Dom/ETH Dom
   (`.metric-grid`, now `repeat(3, 1fr)` instead of a 2×2 of 4 cells). All four figures are
   the same real `globalMarket` fields as before — nothing new was fetched or invented.
   **Deliberately NOT reproduced:** the reference draws a sparkline under this headline
   from a hand-written literal array (`[40, 38, 42, 35, 39, 44, ...]`) with no real backing
   data anywhere in this app. That figure is fabricated in the reference and stays omitted
   here, consistent with this app's own honest-unavailable-state pattern.
3. **Highlight columns (Active Movers / Top Losers / Popular) showed 3 rows; the reference
   shows 4.** Bumped `topMovers/topLosers/mostPopular(kindTickers, 3)` → `4`. Pure
   content-density change against the same real ticker data already being read.

### Explicitly NOT changed (verified already correct / already deliberate)
- Quote filter chips are derived live from `deriveQuoteList(tickers)`, not the reference's
  fixed list (which includes `USDE`, a quote this exchange doesn't support) — unchanged.
- "New Listings" sector stays dropped — no real listing-date field exists; restoring the
  reference's badge-based flag would be fabricated data. Unchanged.
- The Fear & Greed gauge keeps its proper SVG arc (`GaugeArc`) rather than the reference's
  CSS border-rotation trick, which renders as a broken ring once a card this size — an
  earlier, deliberate improvement over the archive family. Unchanged.
- The Filters/reset button, the Пара column's real alpha-sort, and the market-pulse strip
  (breadth over this exchange's own listed pairs) are working real functionality the
  reference either doesn't have or renders as a dead decorative button — kept, not stripped
  for pixel parity.

### Files changed
`frontend/src/pages/markets-bolt/components.tsx`, `frontend/src/pages/markets-bolt/MarketsBolt.css`.
No other file touched — Registration/Auth/EMAIL_VERIFICATION_SECRET/Prisma auth schema/
login, and Homepage/Trade/Futures/Copy Trading/Wallet/Analytics/Admin, are all untouched.

### Validation actually run
- Frontend `tsc --noEmit`: passed, no errors.
- Frontend production build (`npm run build`): passed (`✓ built in 6.28s`).
- No frontend test runner exists in this repo (no `test` script, no jest/vitest config, no
  `*.test.*` files) — none were skipped, there were none to run.
- Browser QA (Playwright/Chromium) against the running app, authenticated with a real
  throwaway account (registered → real six-digit OTP read from the local SMTP QA sink →
  verified → real session token), at 1920/1440/1366/1280/1024/768/390/375: horizontal page
  overflow was 0px at every width; no console/page runtime errors (only blocked external
  font/CDN fetches from the sandbox's network policy, not application errors). Verified
  interactively: sorting by the new Market Cap column, toggling a favorite and filtering by
  the Favorites tab (narrowed correctly to the starred pair), and searching ("ETH" narrowed
  to exactly the ETH pairs). Screenshots confirm the new column, the restructured Market
  Data card, and the 4-row highlight columns all render correctly at desktop and mobile
  widths with no clipping or overlap.
- `/trade?pair=ETH/USDT` regression check: opened correctly, pair rendered, no runtime
  errors. Trade page was not modified.
- In this sandbox, CoinGecko/global-market/Fear&Greed are network-blocked, so those cards
  correctly show `—`/"Нет данных"/"Загрузка данных..." rather than fabricated numbers —
  this is the existing honest-fallback behavior, confirmed still intact under the new
  Market Cap column and restructured card.

### Unresolved / next
None identified within Markets. Production must still receive `EMAIL_VERIFICATION_SECRET`
before this integration branch is ever promoted or deployed (unchanged from the prior
entry — not touched by this task).

## 2026-09-03 — Futures page audit and refinement (no reference archive)
- Agent: Claude
- Branch: `integration/claude-codex` only. `main`, Render, and production untouched.

### Scope and approach
No visual reference was attached for this task — the current repository and the
approved Trade terminal design system were the source of truth. Audited
FuturesPage/FuturesTickerBar/FuturesPairList/FuturesOrderForm/FuturesPositionsPanel/
FuturesTransferModal/FuturesAccountSummary, the shared OrderBookPanel/PriceChart, and
the backend futures stack (`src/api/routes/futures.ts`, `FuturesMarketRegistry`,
`FuturesPositionService`, `marginMath.ts`, `MarkPriceService`, `FundingRateService`,
`LiquidationEngine`, `futuresConfig.ts`) before changing anything. Confirmed the
backend is real and thorough — dynamic volume-ranked market universe with in-flight
symbol protection, real mark/index price, real funding derived from a real interval
boundary, real self-reported open interest, real per-tier liquidation math for both
ISOLATED and CROSS identical between backend and the frontend's live preview
(`lib/futuresMath.ts` byte-matches `src/futures/marginMath.ts`'s sign conventions) —
and left all of it untouched. This was a frontend-only refinement: five genuine,
verifiable parity/correctness gaps found by direct comparison against Spot Trade's
own already-working equivalents, not a rebuild.

### Fixes applied
1. **Real Favorites in FuturesPairList** (`FuturesPairList.tsx`) — the star column
   existed as an inert, aria-hidden empty spacer; Spot Trade and Markets both already
   have a real, working Favorites feature on the same shared store
   (`lib/pairList.ts`'s `loadFavorites`/`saveFavorites`, keyed by pair string — a pair
   starred on Futures now shows starred on Spot/Markets too, not three independent
   lists). Wired the exact same star icon + `stopPropagation` toggle Spot uses, plus
   an "Избранное" filter tab reusing the shared `.pairs-tabs`/`.pairs-tab` CSS, with
   the existing `.empty-state` / `trade.nothingFound` message when a filter matches
   nothing — no new CSS or i18n keys invented, both already existed for exactly this.
2. **Ticker-bar → pair-list search focus wiring** — `FuturesTickerBar` already
   accepted an optional `onSelectSymbol` prop (clicking the pair name/▼) but
   `FuturesPage` never passed one, so it did nothing. Spot's `TickerBar` wires this to
   focus its pair list's search input; gave `FuturesPairList` the same
   `forwardRef`/`useImperativeHandle` `focusSearch()` handle `PairListSidebar` already
   exposes, and wired it identically.
3. **Real open-position count badge on the Positions tab** — Spot's Open Orders tab
   shows a live count via `OpenOrdersPanel`'s `onCount` callback; Futures' Positions
   tab had no equivalent. Added the same `onCount?: (n: number) => void` prop to
   `FuturesPositionsPanel`, reporting `positions.length` from the same
   `getFuturesPositions()` call already driving the table, and rendered it with the
   same shared `.badge` CSS class Spot's tab already uses — pixel-identical to Spot's
   own badge (confirmed by a side-by-side screenshot; a slightly enlarged, dropped-
   baseline glyph is a pre-existing sandbox font-fallback characteristic of the shared
   CSS, present identically on Spot's real badge, not something this change caused).
4. **Stale "Available margin" figure in the order form** — `FuturesOrderForm`'s own
   available-margin read only re-fetched on `[quoteAsset, side]`, so completing a
   transfer in `FuturesTransferModal` (or a fill locking margin) left this figure
   stale until the trader happened to flip Long/Short — while `FuturesAccountSummary`,
   sitting directly below it on the same panel, already self-corrected within 5s via
   its own poll. Gave the order form's balance read the identical 5s poll so both
   figures on one panel never disagree.
5. **Wired the dormant new-account leverage cap** — `FuturesPositionService.ts`
   (backend, unchanged) genuinely rejects `leverage > newAccountMaxLeverage` for
   accounts younger than `newAccountPeriodDays`, `/futures/config` already exposed
   both numbers, and `futures.newAccountLimitNotice` already existed translated in
   all 7 languages — but nothing client-side read any of it, so the slider (and its
   2/5/10/20/50x presets) let a new account drag past the real cap and only find out
   from a rejected order. `FuturesOrderForm` now reads `api.getMe().createdAt`
   (already used the same way elsewhere in the app), computes the effective max
   leverage, passes it as the slider's real `max` (which also correctly filters which
   presets render), clamps down if the account turns out to be new after the slider
   already had a value, and shows the existing notice text when the cap is active.
   Verified end-to-end in the browser: on a freshly-registered QA account, the 20x/50x
   presets correctly did not render, the slider's own scale topped out at 10x, and the
   "Новым аккаунтам доступно плечо не выше 10x первые 30 дней" notice appeared.
6. **Documented, not changed**: added a short comment at the `<PriceChart>` mount in
   `FuturesPage.tsx` stating plainly that this exchange has no dedicated perpetual
   OHLC feed — the candles are the same live Kraken-mirrored spot/reference price
   history Trade shows for the pair, never presented as futures-specific trade
   prints, while mark price/funding/liquidation all read the real futures index/mark
   service. This was already true and already correct; it just wasn't written down
   anywhere in this file the way the order book's identical honesty caveat already
   was, two paragraphs above it.

### Explicitly verified already correct / already deliberate (no action)
- Market universe: `FuturesMarketRegistry` derives listed contracts from live 24h
  volume with a real floor, never delists a symbol carrying an open position or
  resting order, and never shrinks the list on a failed refresh — confirmed no
  permanent BTC/ETH/SOL-only hardcoding (they're prioritized at the top, not
  exclusive) and no independent frontend copy of the universe.
- Order types: backend only ever accepted `LIMIT`/`MARKET` (`z.enum` in
  `futures.ts`) — the form correctly never offered stop/trigger types.
- Margin mode: ISOLATED and CROSS are both genuinely implemented with different
  liquidation math in `FuturesPositionService`/`marginMath.ts` (CROSS backstops with
  free futures-wallet balance) — not a decorative toggle.
- Close position: real `reduceOnly` MARKET order through the same order-placement
  path, no separate "force close" code. No partial-close control exists on either
  side, so none was invented on the frontend.
- Liquidation price: genuinely computed and stored by the backend at fill time
  (`FuturesPositionService.computeLiqPrice`); the frontend's pre-submit preview uses
  the byte-identical formula and is clearly informational only.
- Order book: `OrderBookPanel` is purely presentational (props in, no subscription of
  its own); `FuturesPage` owns a single `krakenSocket.subscribeBook` per symbol with
  correct cleanup on symbol change/unmount and a REST-polling fallback if no WS data
  arrives within 4s — no duplicate subscriptions, verified by reading the effect.
- Top ticker strip: static (no marquee), fed by real symbols/tickers, trimmed to
  width, and each entry selects that Futures contract in place — unchanged, already
  correct from an earlier session.

### Deliberately NOT invented
No fake Open Interest, funding, mark/index price, liquidation volume, or long/short
ratio — all real sources already existed and were used as-is. No stop/trigger order
types added (backend doesn't support them). No partial-close control added (backend
doesn't support it). No second "quote filter" tab row added to FuturesPairList since
this exchange's futures symbols are effectively single-quote (USDT).

### Files changed
`frontend/src/pages/FuturesPage.tsx`, `frontend/src/components/FuturesPairList.tsx`,
`frontend/src/components/FuturesOrderForm.tsx`,
`frontend/src/components/FuturesPositionsPanel.tsx`. No backend file touched — the
financial engine (position service, margin math, liquidation engine, funding,
mark/index price, market registry) was audited and left exactly as-is.

### Validation actually run
- Backend `tsc --noEmit`: passed, no errors. `prisma validate`: schema valid.
- Frontend `tsc --noEmit`: passed, no errors.
- Frontend production build (`npm run build`): passed (`✓ built in 6.09s`).
- Backend tests: full suite **63 suites / 624 tests passed**, unchanged from before
  this task (no backend code was modified, so no new backend tests were needed or
  added) — includes all futures-specific suites (`FuturesPositionService`,
  `FuturesMarketRegistry`, `marginMath`, `MarkPriceService`, `FundingRateService`,
  `LiquidationEngine`) run explicitly and confirmed green on their own first.
- No frontend test runner exists in this repo (no `test` script, no jest/vitest
  config, no `*.test.*` files) — none were skipped; correctness of the frontend
  changes was instead verified by live browser interaction against the real backend
  (see below).
- Browser QA (Playwright/Chromium), authenticated with a real account (registered →
  real OTP read from the local SMTP QA sink → verified → real session), at
  1920/1440/1366/1280/1024/768/390/375: horizontal page overflow was 0px and 0
  runtime `pageerror`s at every width. Interactively verified: pair switching via the
  pair list (BTC→ETH), starring a pair without changing the active contract
  (`stopPropagation` confirmed working), the Favorites tab correctly narrowing to
  exactly the starred pair and restoring on toggle-off, clicking the ticker-bar pair
  name correctly focusing the pair-list search input, Long/Short/Limit/Market/Cross
  toggles, the 20x/50x leverage presets correctly absent (and the notice text shown)
  for this new QA account while 2x/5x/10x remained selectable, and submitting a real
  order against zero futures margin correctly returning a real, visible "Insufficient
  USDT margin balance" rejection with no fake success state. `/trade?pair=BTC/USDT`
  and `/markets` both still load correctly with 0 runtime errors (regression check;
  neither was modified).
- The `ConnectionBanner`'s "WebSocket lost, reconnecting…" message appears throughout
  this sandbox's QA screenshots because `ws.kraken.com` is blocked by the sandbox's
  outbound network policy — this is the banner correctly doing its job (a real,
  honestly-surfaced disconnect), not an application defect; the REST fallback this
  page already has for exactly this case kept the order book and tickers populated
  throughout.

### Known limitations
- The QA account used had no futures margin funded (a fresh registration in this
  sandbox), so a real filled order/open position could not be exercised end-to-end;
  the honest-rejection path (zero margin → real 400 → visible error, no fake success)
  was verified instead, and the position-service fill/PnL/liquidation math itself was
  verified by direct code reading against its own passing test suite rather than a
  live fill.
- Mark/index price and the reference candle chart both ultimately trace back to the
  same Kraken-mirrored ticker feed in this environment (see item 6 above) — this is
  an existing, now-documented characteristic of the exchange's current data sources,
  not something introduced or changed by this task.

## 2026-09-03 — Market data layer hardening + Analytics data foundation
- Agent: Claude
- Branch: `integration/claude-codex` only. `main`, Render and production untouched.
- Full architecture write-up: **`docs/MARKET_DATA_ARCHITECTURE.md`** (new).

### What this was
Not a rewrite. Three shared primitives were introduced and the existing provider
services were moved onto them, keeping every public API contract and every page's
behaviour identical. Providers are unchanged: Kraken (REST + browser WS), CoinGecko,
alternative.me. **No new provider was added** — no gap was found that the current
sources plus this exchange's own book couldn't cover, and adding one would mean new
budget, secrets and failure modes for data nobody is asking for yet.

### New shared infrastructure
- **`src/services/marketData/ProviderCache.ts`** — the one caching primitive: TTL,
  in-flight deduplication, stale-last-good with a bounded staleness budget, and an
  LRU ceiling. Previously each service hand-rolled `{data, expiresAt}` with different
  behaviour: only Kraken's ticker walk deduplicated, only CoinGecko/Fear & Greed
  served stale, and none of the per-symbol maps had any bound.
- **`src/services/marketData/ProviderHealth.ts`** — `ProviderHealth`
  (CLOSED/OPEN/HALF_OPEN circuit, consecutive failures, last success/failure, 429
  counter), `parseRetryAfter`, `backoffWithJitter`, and `HttpProviderClient` (the
  shared outbound GET: bounded retries, full-jitter backoff, Retry-After respect,
  health recording, hard stop while open). Plus a process-wide
  `providerHealthRegistry`.

### Services moved onto it (behaviour preserved)
- `KrakenMarketDataService` — all five caches (symbols, tickers, order book, candles,
  trades) now deduplicate and are bounded; every outbound call goes through the
  retry/backoff/circuit policy.
- `CoinGeckoService`, `FearGreedService` — same, keeping their existing
  serve-stale-on-failure promise (now bounded rather than unlimited).
- Each service takes an optional `ProviderRequestPolicy` last argument so tests can
  disable retries; production defaults are unchanged.

### Candle caching (the BTC to ETH to SOL to BTC problem)
Cached as one series per `pair:interval` instead of per `pair:interval:limit`. A
refresh past the 5s TTL asks Kraken for `since=<last closed candle>` — one or two
candles — and merges, replacing the previously-open bucket with its final closed
form. `limit` is a slice of the shared series, so a 300-candle and a 720-candle
consumer share one fetch. Returning to a pair reuses its history instead of
re-downloading ~720 candles.

### Analytics data foundation (no UI built)
- **`src/services/AnalyticsDataService.ts`** + **`src/api/routes/analytics.ts`**
  (`GET /api/v1/analytics/overview`), gated by `requireAuth` + `requireAdmin` — the
  server-side half of the same admin gate `/analytics` already uses via
  `useAdminGate`. The permission model itself is unchanged, and `AnalyticsPage.tsx`
  was **not** touched: no cards, no dashboard, no UI.
- Real sections: market overview (CoinGecko `/global` — cap, volume, BTC and ETH
  dominance, 24h change), sentiment (alternative.me), funding (this venue's own
  settled `FundingRateRecord` + real interval boundary), open interest (this venue's
  own positions, explicitly `scope: 'venue'`), mark and index prices, and provider
  health.
- Deliberately unsupported, each returned as `available: false` with a reason **and
  no value-carrying fields at all**: liquidations, long/short ratio, cross-venue open
  interest, ETF flows, exchange flows, whale activity. A test asserts those sections
  carry only `available`/`reason`/`detail`, so nothing can be plotted as a zero.

### Frontend
- Direct provider dependencies inventoried: the **only** one is `krakenSocket.ts` to
  `wss://ws.kraken.com/v2` for the live book/tape. Classified **B — temporarily
  acceptable**: moving it behind VOLTEX needs a production WS proxy (fan-out,
  backpressure, connection limits), explicitly out of scope here; it carries no
  secret and degrades honestly through `ConnectionBanner`. Everything else already
  goes frontend to `lib/api.ts` to VOLTEX to provider. Nothing needed removing.
- WS audit found the shared-connection, reference-counted subscription model already
  correct (BTC to ETH to SOL to BTC leaks nothing). Two hardening fixes: reconnect
  backoff now uses full jitter, and cached book state is cleared on disconnect so a
  book can never be rendered from pre-disconnect deltas.

### Files added
`src/services/marketData/ProviderCache.ts`, `src/services/marketData/ProviderHealth.ts`,
`src/services/AnalyticsDataService.ts`, `src/api/routes/analytics.ts`,
`src/services/marketData/__tests__/{ProviderCache,ProviderHealth}.test.ts`,
`src/services/__tests__/AnalyticsDataService.test.ts`,
`src/api/routes/__tests__/analytics.test.ts`, `docs/MARKET_DATA_ARCHITECTURE.md`.

### Files changed
`src/services/{KrakenMarketDataService,CoinGeckoService,FearGreedService}.ts`,
`src/index.ts` (analytics wiring),
`src/services/__tests__/{KrakenMarketDataService,CoinGeckoService}.test.ts`,
`frontend/src/lib/krakenSocket.ts`.

### Not touched
Matching engine, order execution, wallet balances, futures margin/liquidation
engines, copy trading. No visual redesign anywhere; `AnalyticsPage.tsx`, Markets,
Trade, Futures and the Homepage are visually unchanged. The Futures fixes from the
preceding task are intact.

### Validation actually run
- Backend `tsc --noEmit`, frontend `tsc --noEmit`, `prisma validate`: all clean.
- Backend suite: **67 suites / 666 tests passed** (was 63/624 — 42 new tests: 9 cache,
  18 health/circuit/Retry-After, 3 candle caching, 8 analytics service, 4 analytics
  route). All deterministic, injected clocks and sleeps, no test touches a real
  provider.
- Frontend production build: passed (`built in 6.04s`).
- Live API check against the running backend: ticker/candle response shapes
  unchanged; `/analytics/overview` returns 401 unauthenticated and 403 for a
  non-admin account.
- Browser regression (Playwright) at 1440 and 390: Homepage (anonymous), Markets,
  Trade and Futures all render live numbers with 0 horizontal overflow and 0 runtime
  errors.

### Known limitations
- Freshness metadata is tracked and logged internally but not yet surfaced in HTTP
  responses — adding it would change contracts this task was told to preserve. Noted
  in the architecture doc as the natural next step.
- Provider health/cache are per-process, correct for one Render instance.
- This sandbox blocks Kraken/CoinGecko/alternative.me, so provider behaviour remains
  covered by deterministic mocked tests only.

## 2026-09-04 — Full product functional audit + homepage repair
- Agent: Claude
- Branch: `integration/claude-codex` only. `main`, Render and production untouched.
- Full route-by-route matrix and interaction inventory: **`docs/FUNCTIONAL_AUDIT.md`** (new).

### What this was
An end-to-end functional audit of every user-facing route, following each
control from UI → handler → API → backend service → response → visible result,
plus fixes for the defects that pass turned up. Not a redesign: the only
visual changes are the explicitly requested removal of the homepage's
secondary Crypto Card panel, the table expansion that follows it, and one 7px
mobile overflow fix.

### The biggest defect found and fixed
`RequireAuth` in `frontend/src/App.tsx` redirected signed-out visitors to
`"/"` — which for them *is* the homepage. Every product link on the public
homepage therefore did nothing: all seven header nav links, both hero CTAs,
the ticker symbols, every market row's Торговать, and every footer product
link put the visitor straight back where they started, with no sign-in prompt.
Verified by clicking all seven header links (each landed on `/`).

Fixed with `frontend/src/lib/returnTo.ts`: the guard sends them to
`/login?next=<path>`, and the login form, the 2FA step and the registration
success screen all return them there. Only same-origin paths are accepted, so
the parameter is not an open redirect. `App.tsx` also grew `RedirectIfAuthed`
so `/login` and `/register` honour `next` for an already-signed-in visitor,
and the login↔register cross-links carry it through.

### Homepage Markets block (the defects the owner had already found)
- **CFD tab** returned a hardcoded `[]` while `useHomeMarket` was already
  fetching `/cfd/tickers` and discarding it. It now renders the real
  instruments when a provider is configured, and says the provider is not
  configured when the backend answers `configured:false` — a configuration
  state, not "coming soon", and never a fabricated quote. Rows deep-link to
  `/trade?market=cfd&symbol=…`; `TradePage` now honours `?symbol=`, validated
  against the instruments the backend lists.
- **"Все активы" and "Спот" were identical** (both hit the same `default:`).
  "Спот" is spot markets; "Все активы" is the union of every listed product,
  each asset once, tagged with what it actually trades on.
- **"Фьючерсы" filtered spot tickers against a hardcoded BTC/ETH/SOL list.**
  It now reads `GET /futures/config` (`FuturesMarketRegistry`) — the same
  source the futures terminal and Markets use; 40 contracts here.
- **Futures rows linked to `/trade?pair=`.** Now `/futures?pair=`. Spot rows
  keep `/trade?pair=`.
- **Favourites were a mount-time snapshot.** `lib/pairList` now notifies on
  write and on another tab's `storage` event; `lib/useFavorites` is the shared
  hook, and `PairListSidebar`, `FuturesPairList`, `markets-bolt` and the
  homepage table all read one live set. No reload needed anywhere.
- **Secondary Crypto Card panel removed** (small card, Apple Pay, NFC,
  Получить карту). The main Crypto Card section and its approved artwork are
  untouched. The Markets table now spans the section — 1392px at a 1440px
  viewport, was ~1040px.
- **Footer**: Центр помощи and Связаться с нами both pointed at `/settings`.
  Help centre → `/legal/support`; Contact opens the globally mounted support
  chat (a button — there is no page to link to); О нас → `/legal/about` added.

### Other fixes
- Wallet's portfolio-distribution card (`flexShrink: 0`, intrinsic 366px)
  pushed the page 7px past a 375px viewport once the header row wrapped.
  Capped with `maxWidth: '100%'`; desktop layout unchanged.

### Verified working, not changed
Markets (search, filters, favourites, sort, pagination, sparklines, correct
Spot/Futures routing), Trade (deep links, invalid-pair fallback, order book →
form, all five order families placing and cancelling real orders, honest
errors), Futures (real universe, mark/index/funding/next-funding/open
interest, new-account leverage cap, isolated/cross, transfer, positions),
Wallet (deposit/transfer/withdraw modals, hide balance, hide zero, search,
sort, history), Copy Trading (tabs, profiles, periods, $20,000 gate),
Arbitrage, Card, OTC, Analytics permissions (401/403/200), and all seven Admin
pages behind the role gate.

### Deliberately left unavailable
OTC (no desk behind it), Analytics UI sections (data foundation only),
long/short ratio and liquidation volume on Futures. `/legal/support` copy is
stale — it claims there is no live support channel while the chat widget runs
on every page; flagged in the audit doc, not rewritten (seven languages).

### Checks actually run
Backend suite **69 suites / 680 tests pass** (was 67/666; +2 suites, +14
tests covering `returnTo` and the favourites store). Backend `tsc --noEmit`
clean, frontend `tsc --noEmit` clean, `prisma validate` clean, frontend
production build `✓ built in 6.15s`. Browser QA at 1920/1440/1366/1280/1024/
768/390/375 on Homepage, Markets, Trade, Futures and Wallet: no page-level
horizontal overflow, no uncaught page errors on any route. Sandbox-blocked
upstreams (CoinGecko, alternative.me, ws.kraken.com, TradingView, jsDelivr
icons, Google Fonts) are recorded as environment, not application, defects.

### Not done here
Wallet redesign, Analytics redesign, any merge to `main`, any Render or
production change. `EMAIL_VERIFICATION_SECRET` remains a production deployment
prerequisite and was not configured.

## 2026-09-04 — Homepage hero copy rewrite + Crypto Card removed from the hero
- Agent: Claude
- Branch: `integration/claude-codex` only. `main`, Render and production untouched.
- Files: `frontend/src/pages/home/HomeHero.tsx`, `frontend/src/lib/i18n.tsx`.

### Where the physical card in the hero actually came from
Nowhere in the hero, as of the previous commit. Verified rather than assumed:
`HomeHero`, `TerminalPreview` and `PhonePreview` contain no card component,
no card artwork and no card background; `home.css` has no `url()` or
card-bearing pseudo-element; and a live DOM scan of the rendered homepage
found the hero section (top 58 → 599) holding **zero images**, with the only
`/cards/voltex-card-dark.png` on the page at y=980 — inside `HomeCardSection`,
the dedicated Crypto Card section.

The physical card the owner saw was the **secondary Crypto Card panel beside
the Markets table** (small card + Apple Pay + NFC + Получить карту), which the
preceding functional audit removed in `eaedfac`. Re-checked here: no card
markup, no Apple Pay/NFC text and no `HomeCryptoCard`/`CreditCardIcon` import
remain in `HomeMarkets.tsx`, and the table already spans the full section.
Nothing further to remove.

What *was* still advertising the card in the hero was its secondary CTA,
**Получить карту** with a `CreditCardIcon`. That is now gone.

### Hero changes
- Secondary CTA replaced: `Получить карту` → `/card` becomes
  **Смотреть рынки** → `/markets`; the `CreditCardIcon` import is dropped.
- Primary CTA text is now **Открыть терминал** (still `/trade`), on a new key
  `home.cta.openTerminal` — `home.cta.startTrading` is left untouched because
  the header's registration CTA still uses it.
- New key `home.cta.viewMarkets`. `home.cta.getCard` is **kept**: the
  dedicated Crypto Card section still renders it.
- Copy rewritten (RU is the source; the other six are transcreated, not
  word-for-word, to hold the same short premium line):
  badge `Торговая инфраструктура VOLTEX`, headline `Рынок сложный.` /
  `Интерфейс — нет.` (gold second line), subtitle `Спот, фьючерсы,
  копитрейдинг и арбитраж — в одной системе с реальными рыночными данными и
  единым кошельком.`
- The badge keeps its long/short responsive split; `badgeShort` is now
  `Инфраструктура VOLTEX` and equivalents.

Nothing else in the hero changed: the atmospheric background, the terminal
preview and the phone preview are exactly as approved, and no decorative
object replaced the CTA.

### Untouched
`HomeCardSection`, `HomeCryptoCard`, `CardFace`, `CardPage` and the card
artwork itself — not recoloured, cropped, filtered or redesigned. `git diff`
covers two files only.

### Checks actually run
Frontend `tsc --noEmit` clean; production build `✓ built in 7.87s`. Browser QA
of the hero at 1920/1440/1366/1280/1024/768/390/375: zero card elements in the
hero at every width, exactly one card image on the page (the dedicated
section), no horizontal page overflow, headline 2 lines (3 at 1024), CTAs
never wider than the viewport, no uncaught page errors. All seven languages
checked at 1440 and 375: 2–3 headline lines, no overflow, no hero card. Backend
suite not re-run — no backend file changed.

---

## 2026-09-04 — Claude (Opus 5) — Wallet V3, portfolio performance, admin portfolio profile

**Task.** Replace the Wallet visual design with the approved V3 design while
keeping every real function connected; add real portfolio performance (PnL)
tracking for all users; add a private display-only portfolio profile for one
operator account.

**Commit.** See the commit that carries this entry on
`integration/claude-codex`.

### What was added

**`src/services/PortfolioPerformanceEngine.ts`** — the return mathematics,
deliberately isolated so there is exactly one of it.
`buildAdjustedSeries(days)` turns raw daily equity plus that day's external
cash flow into a time-weighted index: `r(t) = (value(t) − flow(t)) / value(t−1)
− 1`, chained, then rescaled so the last point equals the account's real
present value. That is what makes a deposit raise the balance without
registering as profit and a withdrawal not register as a loss.
`computeAllPeriods(series, now)` measures 7D/30D/90D/1Y/all-time off that one
series. Periods compound; they are never summed, never independently stored,
and never derived from each other. A window whose start predates the series
returns `{ available: false }` rather than borrowing a shorter window.

**`src/services/AdminPortfolioProfile.ts`** — the display-only profile.
`hasAdminPortfolioProfile(user)` requires **both** `role === 'ADMIN'` **and**
the normalised email match; `User.role` / `requireAdmin` remain the
authorisation source of truth and email alone grants nothing. Holdings are
quantities only — no prices, no USD totals — so valuation must come from live
market data. The performance curve is generated by log-space interpolation
between fixed anchors with a seeded, `sin(πu)`-tapered fluctuation, so the
anchors are hit exactly, the path contains losing days as well as winning
ones, it extends as the calendar advances, and it is identical on every
request (no randomness, no stored state, no scheduler).

**`src/services/WalletPortfolioService.ts`** — `overview()` and
`performance()`. Crypto is priced from the exchange's own Kraken-mirrored
ticker feed, stables are pegged, EUR reuses the existing CFD provider's
`EURUSD`. No new market-data provider was added.

**`GET /wallet/overview`, `GET /wallet/performance`** (in
`src/api/routes/portfolio.ts`) — both `requireAuth`, both re-reading
`{ id, role, email }` from the database rather than trusting the token.

**`frontend/src/pages/wallet-v3/`** + a rewritten
`frontend/src/pages/WalletPage.tsx` — the V3 light financial workspace under
the app's existing dark global header: portfolio strip, asset ledger,
allocation, transaction history, and the deposit/withdraw/transfer modals, all
on the same backends the previous Wallet used.

### Isolation (the important part)

The profile's holdings are attached to the Wallet overview response and to
nothing else. They are never written to `Balance` or `FuturesBalance`, are not
spendable, and do not reach order placement, available trading balance, the
matching engine, margin, futures risk, liquidation, withdrawal eligibility,
deposit accounting, treasury accounting, proof of reserves or liabilities.
Verified live against three account types: a normal user and a second ADMIN
both get `presentation: null`; the profile account's Withdraw modal reports no
withdrawable funds and its Transfer modal reports 0 available, because both
read the real ledger, which is empty. Ten named tests cover this in
`src/services/__tests__/AdminPortfolioProfile.test.ts` and
`WalletPortfolioService.test.ts`.

### Preserved from Codex / earlier work

Nothing in Trade, Futures, Markets, Copy Trading, Arbitrage, Crypto Card, OTC,
Analytics, Admin or Auth was touched. The Tailwind theme kept its existing
`ink`/`gold` dark-surface ramps; the Wallet's light tokens were added
alongside under distinct key shapes, and new radii use distinct names (`w`,
`wsm`, `wlg`) so the shared scale is unchanged. `preflight` stays off and the
Wallet's reset is `:where()`-scoped to `.vx-wallet` / `.vx-wallet-modal-root`.

### Defects found and fixed while integrating

- The Wallet's real asset rows were priced from the CoinGecko rankings feed
  while the portfolio total was priced from the Kraken feed, so a row could
  read `—` while the header above it read `$25,000`. `/wallet/overview` now
  returns `priceUsd`/`valueUsd` per real balance and the rows use it.
- `tailwind.config.js` scanned `src/pages/wallet-v3/**` but not
  `src/pages/WalletPage.tsx`, so the page's own responsive grid classes were
  never generated and Portfolio Allocation stacked full-width instead of
  sitting right of the ledger. The entry file is now listed.
- The PnL period labels (7Д/30Д/90Д/1Г) were hardcoded Russian in all seven
  languages; they are now keys (`wallet.period7d` … `wallet.period1y`).
- `formatPercent` used `toFixed(2)`, printing `+28.00%` beside a
  comma-decimal `$67 640 337,00`; it is locale-aware now, as is the deposit
  minimum.
- The modal close button carried the modal title as its `aria-label`.

### Known limitations

- A real account's history is valued at *current* prices for flow assets:
  this deployment stores no historical price series, so a non-stablecoin
  deposit's USD value is approximated. Exact for the stablecoins most
  deposits arrive in.
- A real account's series needs at least two daily `PortfolioSnapshot` rows;
  until then every period honestly reports "not enough history" rather than a
  number.
- EUR has no price unless the CFD provider is configured
  (`TWELVE_DATA_API_KEY`); the row and its value show `—` rather than a guess.
- `EMAIL_VERIFICATION_SECRET` remains a production deployment prerequisite and
  was deliberately not configured here; it was supplied inline for local QA
  only and appears in no repository file.

### Checks actually run

Backend `tsc --noEmit` clean; frontend `tsc --noEmit` clean; `prisma validate`
clean; frontend production build `✓ built in 4.19s`. Full backend suite: 72
suites, 733 tests, all passing (up from 69/680 — 3 new suites, 53 new tests).
Browser QA of the Wallet at 1920/1440/1366/1280/1024/768/390/375 for both a
normal account and the profile account: no page-level horizontal overflow, no
clipped text, no scientific notation, large quantities (32 726 245 USDT,
1 200 000 XRP, ~$67.6M total, +2 115,00%) all render in full. All seven
languages checked at 1440 and 390. Deposit, Withdraw and Transfer modals
opened, read real chains/addresses/balances, and closed on Escape; hide/show
balance, search, hide-zero, three sort columns and all five PnL periods
exercised by click. Route regression sweep over 13 routes: all render, no
error boundaries, no new console errors. No production trade, transfer or
withdrawal was placed.

## 2026-09-06 — Codex selective Copy Trading promotion (IN PROGRESS)

- Owner clarified pre-launch/demo use and authorized one global localized notice. Continuing `codex/copytrading-unified-production` at `6e5641ecac8a508997f61ba08f5694c463ede764`; main remains `ced48a598c64269880ed00fca712ce1c148298de`, review source remains `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86`. New work is intentionally uncommitted and NOT deployable yet. Existing nginx fix retained.
- Selectively integrated canonical Copy UI/engine dependencies, normal authenticated Nazar/Ksenia read API, six-field same-environment identity resolver, additive CopyStrategyOwner/CopyPerformanceScenario migration, explicit deposit-only eligibility, global notice in seven languages, and unchanged approved secondary avatar assets. Home/Trade/Card/Auth/Wallet/Futures/Analytics/Arbitrage source and package locks remain at main; no whole-review merge.
- Production Neon audit used TLS-verified PostgreSQL `BEGIN READ ONLY` and `ROLLBACK`: 11 User records; 2 have test-name/domain patterns and USER_REGISTERED audit entries; 1 ADMIN. Other accounts cannot independently be classified as internal from this evidence alone. Private emails/credentials/media were not exported. Confirmed existing stable owner bindings: Nazar has avatar and APPROVED; Ksenia has avatar and NOT_STARTED. All 23 existing main migrations finished without rollback. No production records/configuration changed.
- Frontend TypeScript/build PASS; 9 suites/71 tests PASS. Backend TypeScript/build/Prisma validation PASS; 107 distinct canonical/auth/privacy/isolation/legacy checks passed across targeted runs. Nazar exact Sep5/Sep6 fingerprints match. One required Ksenia exact published SHA remains unresolved: generator and stored review response differ only in 1,106 floating-point tails (maximum 7.28e-12), not canonical four-decimal money. Tests were not relaxed.
- Exact Ksenia persisted CopyReviewScenario seed must be exported before promotion; do not regenerate or silently substitute constructor output. Render SQL connector failed TLS; review database explicitly blocks external inbound connections, and its free backend offers no Shell/SSH. No networking/security setting was changed. Owner direction is needed for a narrowly scoped authorized read-only export path.
- `scripts/qa-copy-production.cjs` is ready: normal production build through real nginx, actual router/service/auth with isolated in-memory QA persistence and nine viewport widths. Full browser run deliberately awaits exact Ksenia state. No new commit/push/main/deploy has occurred during this continuation.

## 2026-09-06 — Codex selective Copy Trading production candidate READY

- Continued the same candidate from `6e5641ecac8a508997f61ba08f5694c463ede764`; owner explicitly reauthorized full production promotion after the completed Ksenia export. Base main `ced48a598c64269880ed00fca712ce1c148298de` and reviewed source `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86` remain the recorded inputs. This entry belongs to the selective candidate commit; its exact SHA and both production deploy results are reported after promotion, not inferred from local tests.
- Resolved the earlier blocker using the exact read-only saved Ksenia export (raw SHA `b6d8ba649be521b9a4c3cab725a42b48c80b07988344c7ae19dc4e78436c0380`). The owner-approved temporary single-IP review DB rule was immediately removed and external access verified blocked again. No database record was changed during export; no review service/configuration is changed by this candidate.
- Production service bootstraps only missing new namespaces from approved histories, then stores numeric JSON tokens losslessly with revision CAS. Existing reviewed copied quantities require a narrowly allowlisted IEEE-754 tail compatibility check: only exact approved historical records, quantity-only <= 8 relative machine epsilons; every monetary field remains strictly exact and old objects are returned untouched. Equal AUM objects retain their historical serialized order. No engine refit, balance or account mutation.
- Material files: normal Copy performance router/service, canonical modules plus approved seed/integrity adapter, same-environment six-field owner identity resolver, additive Copy tables/migration, Copy page/components/adapters and four unchanged reviewed avatar assets, application-level seven-language notice, relevant tests and local QA harness. Full audit: `docs/COPY_PRODUCTION_PROMOTION.md`. Existing main Home/Trade/Card/Wallet/Futures/Analytics/Arbitrage/Auth/Nav sources, market/matching behavior, package locks and Render/Docker settings preserved.
- Backend full regression **81 suites/816 tests PASS**; latest additional persistence/tamper checks PASS. Frontend **9 suites/71 tests PASS**. Backend/frontend TypeScript, Prisma validate and production builds PASS. Exact public Nazar SHA `2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2` and Ksenia SHA `ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4` PASS, Ksenia 365D fee exactly 1,275,547.0000. +1/+7/+30/+90/+365 saved-history progression and immutable prefixes PASS.
- Real nginx baseline403/fixed200 route/refresh/HEAD/static/cache regression PASS. Actual normal candidate frontend/router/service/auth QA passed at 1920/1440/1366/1280/1024/768/430/390/375: both profiles/all periods/latest20, search/Favorites, eligibility boundaries/admin-zero, avatar refresh, Ksenia no Verified, sticky global notice, no horizontal overflow or application/console errors. Local QA uses isolated account/session/DB adapters; live production verification remains mandatory after both existing auto-deploys reach LIVE on the promoted SHA. No production order/deposit/withdrawal/copy execution is part of QA.

## 2026-09-06 — Codex selective Crypto Card production candidate READY

- Explicit owner-authorized selective promotion, branch `codex/crypto-card-production`, production base `cb29b7f1afce7fb17cf68462573949166933640e`, reviewed source `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86`. This handoff is part of the candidate commit; its SHA and actual deploy results are reported after promotion, not inferred from tests.
- Material scope: exact reviewed CardPage and 30 page-local modules, 15 intact approved assets, dedicated scoped Tailwind, three pinned frontend dependencies, Card-only API/i18n hunks; exact reviewed application service/router, one injection hunk, additive Card schema/migration; Card tests, local QA harness and provenance documents. Full audit: `docs/CRYPTO_CARD_PRODUCTION_PROMOTION.md`.
- Preserved current main Copy/Nazar/Ksenia histories, APIs, identity, eligibility and global notice; Home, Trade, Futures, Wallet, Analytics, Arbitrage, Auth, Nav/Footer, pricing/matching, Docker/nginx/Render and all review services remain unchanged. No whole-review merge or old CardFace/waitlist restoration.
- Backend/frontend TypeScript, backend/frontend production builds and Prisma validation PASS. Full configured Jest 99 suites/996 tests; Card backend 2/47; frontend 17/136 (Card subset 4/41). Actual isolated PostgreSQL/Prisma persistence 15 checks PASS, including unique/FK constraints, reconnect persistence and SQL-triggered audit failure rollback. Production financial records were not used as test fixtures.
- Actual built Card nginx/browser QA all nine requested widths, all seven languages at desktop/mobile, both products, all sections, asset bytes/MIMEs, eligibility A–I, idempotence/double-click, 409 conflict and F5 PASS; no overflow/broken images/browser errors. Unchanged Copy candidate QA all nine widths and exact Nazar/Ksenia response hashes PASS.
- Production Neon read-only preflight: 11 Users, 0 Trades, 24 finished migrations, no Card object collisions; financial/Copy fingerprints recorded with verified TLS and ROLLBACK. Next mandatory gate: push only this candidate to main, await both existing production auto-deploys LIVE at the same SHA, compare migration/schema/data read-only and verify authenticated live /card/direct-load/F5/mobile. No manufactured production eligibility or review backend/DB shortcut.

## 2026-09-06 — Codex security remediation Phase 1 (owner-review branch only)

- Implementation commit: `79cd9ca5d83ac4296d40cda31e51280dcf1ad1b3`, branch `codex/security-remediation-phase1`, isolated from verified main `e8bf772bd493bfe490bf2c2d131c09180b856d08` as explicitly requested. Audit source `origin/codex/security-dependency-audit` remains `180989402bdf7f559a6228b1cefb182db8de0937`. This follow-up only records the implementation SHA; no main merge or deployment.
- Material files: `frontend/src/lib/returnTo.ts` same-origin URL-parsing/encoding guard; root package/lock for exact Nodemailer 9.0.1; frontend package/lock for exact React Router DOM/Router 7.18.3; focused returnTo/support/mail tests and local attachment fixture; isolated `scripts/qa-security-phase1.cjs`; detailed `docs/SECURITY_REMEDIATION_PHASE1.md`.
- Preserved all other agents' main product work, BrowserRouter/declarative routes, auth callers, Support/KYC service source and SMTP behavior, every unrelated dependency node, Crypto Card, Copy/Nazar/Ksenia histories, Trade/matching, Wallet/money, Futures, Analytics, Arbitrage, schema/migrations and Docker/nginx/Render settings. No production credentials, login, email, database or financial writes used.
- Backend/frontend clean npm ci, TypeScript and production builds PASS. Full configured Jest **100 suites / 1,089 tests PASS** (backend 83/881; frontend 17/208). Return guard 82 tests, support/KYC/mail 4/47; actual in-memory Nodemailer MIME composition tested without SMTP. Additional adversarial review 78,141 inputs / 95,850 same-origin assertions PASS.
- Isolated actual built-app nginx/browser QA at 1440/390: 14 route/direct-load/F5 checks, 14 normal login/registration/2FA/admin flows, 80 malicious-next cases PASS; no external redirect attempts, SecurityErrors, unexpected runtime/console errors or horizontal overflow. External fonts/icons/market WebSockets deliberately blocked; no invented live quotes or execution claim. All QA processes stopped.
- Fresh npm audit counts moderate/high/critical: backend full and prod **4/3/1 -> 4/2/1**; frontend full **6/1/0 -> 4/1/0**; frontend prod **2/0/0 -> 0/0/0**. Router/Nodemailer findings removed; excluded bcrypt/tar, qs/uuid and Vite/Capacitor chains intentionally remain. Next: owner review, then separately scoped bcrypt 6.0.0 chain removal followed by qs/uuid remediation. This phase must not auto-promote to main or Render.

## 2026-09-06 — Codex security remediation Phase 2A (owner-review branch only)

- Implementation commit: `849afee5272109054b2a29c0f32c0724b33840c8`, branch `codex/security-remediation-phase2a-bcrypt`, isolated from fetched and independently verified main `27d531b0140471654adf3f18203b06de73ed5598` as explicitly requested. This documentation-only follow-up records completed validation; no main merge, Render change or deployment.
- Material files: root package/lock pin bcrypt **5.1.1 -> exact 6.0.0**; new `BcryptCompatibility.test.ts`, actual bcrypt5.1.1 fixture JSON and `bcryptAuthRegression.test.ts`; native-only `scripts/qa-bcrypt-native.cjs`; exact-feature-branch-only `.github/workflows/security-phase2a-bcrypt.yml`; detailed `docs/SECURITY_REMEDIATION_PHASE2A_BCRYPT.md`. The owner explicitly authorized the CI workflow/test push after local Docker/WSL availability blocked mandatory Alpine proof.
- Lock audit: node-addon-api 5.1.0 -> 8.9.2, node-gyp-build 4.8.4 introduced; 36 obsolete bcrypt-closure nodes pruned, including @mapbox/node-pre-gyp 1.0.11 and tar 6.2.1. Twelve shared nodes become dev-only without version/integrity changes. All unrelated dependencies and both frontend manifests/locks are unchanged.
- Windows clean npm ci, backend TypeScript/build and full configured Jest **102 suites / 1,120 tests PASS** (backend 85/912; frontend 17/208). Fresh backend full/prod audits **4 moderate / 2 high / 1 critical -> 4 / 0 / 0**. Remaining qs/body-parser/Express/uuid moderate findings are documented and deliberately not modified.
- Actual [Node20 Alpine CI](https://github.com/nazardzuba79-tech/-/actions/runs/34046665754) PASS at the implementation SHA: unchanged Dockerfile, clean runtime `npm ci --omit=dev`, Node20.20.2/Alpine3.23.4/Linux x64, loaded bcrypt.musl.node, **90 native checks PASS**, eight genuine old hashes compatible, 175 installed app nodes with no node-pre-gyp/tar. Actual isolated registration/login/password-change/session/blocking/TOTP/backup tests **3 suites / 40 cases PASS**. No production hashes, database access, emails or image CMD/migrations used. Verified artifact 9993326110 retained locally; full proof is in the report.
- Preserved every existing application/auth caller, password rules and costs (12 passwords/10 backup codes), session/JWT/2FA behavior, Phase 1 Router 7.18.3/Nodemailer 9.0.1/returnTo security, all Claude/Codex product work, finances, Copy/Nazar/Ksenia histories, schema/migrations and Docker/Render settings. No application runtime source or UI changed. Next: owner review, then separately authorized qs 6.16.0 + backend uuid 11.1.1 remediation; do not auto-promote or deploy this branch.

## 2026-09-06 — Codex blue Copy Trading verified badge (owner-review branch only)

- Implementation commit: `99491963abed03859ad4ab4ba18ab174d04c7877`, branch `codex/copy-verified-badge`, isolated from fetched and verified owner-specified main `34f08b1703888f98ef6cb8b4e3b8b78177fc377a`. This documentation-only follow-up records validation. No main merge or deployment is authorized.
- Application files: `frontend/src/pages/copy-trading-bolt/VerifiedBadge.tsx`, `components.tsx`, `traders.ts`, `CopyTradingBolt.css`, `CopyTradingRefinement.css`, `frontend/src/pages/CopyTradingPage.tsx`, `frontend/src/lib/kseniaCopyTrading.ts`. Reusable 15px solid-blue scalloped inline SVG/white check beside card/profile names replaces old gray badge/avatar overlay; separate gold VIP is unchanged.
- Source of truth: `CopyStrategyOwner.ownerUserId` -> bound `User.kycStatus === 'APPROVED'` -> `/api/v1/copy-trading/identities` / `PublicStrategyIdentity.verified` -> `withStrategyIdentityVerification` -> `Trader.identityVerified` -> `VerifiedBadge`. The adapter requires matching traderId and boolean true; no name/VIP/avatar/static catalogue flag grants verification. No backend KYC change. Generic owner adapter supports future identities without name hardcodes.
- Frontend TypeScript and production build PASS (existing large-chunk warning only); frontend Jest **18 suites / 235 tests PASS**, relevant Copy backend Jest **15 suites / 119 tests PASS**, backend TypeScript/build PASS. Additional direct final badge/card/profile SSR rerun **3 suites / 45 tests PASS**. Tests execute the actual shared SVG and cover true/false/missing/mismatched identities, renamed/future owners, static flags, placement, no avatar overlay and financial immutability. Historical whole-file fingerprints updated only for the six approved badge-wiring/style/type changes; unrelated products and canonical renderer/history fingerprints remain exact.
- Actual local built-app Codex browser QA at **1440/1024/768/390/375** PASS: Leaderboard, All, Favorites, Following, Nazar profile and Ksenia profile. Nazar badge visible, Ksenia/static catalogue hidden; 15x15px, 7px card/6px profile gaps; no overlaps, horizontal page overflow or console errors. Additional same-name/VIP backend-false case removes the badge, restoring true restores it. Viewport override reset and local profile retained for owner review.
- QA uses only a loopback server with actual compiled Copy router/service/auth and in-memory database/session/owner fixtures (Nazar APPROVED, Ksenia NOT_STARTED; fictional local avatar; Following/Favorites local list fixtures, not real copying). No production account/DB/API or financial writes. Exact Sep6 canonical response hashes remain Nazar `2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2`, Ksenia `ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4`; stored state bytes also unchanged.
- Preserved all Claude/Codex financial ledgers, yellow graphs, metrics, avatars, eligibility, copy logic, deterministic history, catalogue flags, backend/auth/schema, security dependencies, other products/navigation and Render configuration. No unresolved mismatch; next step is owner review of this pushed feature branch only. Main and production remain untouched by this task.

## 2026-09-06 — Codex final Spot Trading (owner-review branch only)

- Implementation commit: `24989985fdcd1a065eda9e55c7845801849d1be2`, branch `codex/final-trading-production`, created from freshly fetched production/main `c398efa1d4d8f6b348e9ae1fc87dd72a06ebc337` as explicitly requested. Historical correction `6f2e2bc518773e0cdca55aa947c31b840cf70762` and review `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86` were references only; neither branch was merged/cherry-picked wholesale. This documentation-only follow-up records final validation.
- Material scope: Spot TradePage/panel CSS; opt-in PriceChart drawing rail/math/dialogs/price-axis precision and MACD warm-up; PairList/OrderBook/Ticker controls and live-data provenance; OrderForm input/response handling; compact OpenOrders/History/Assets presentation; focused helpers/tests, seven-language order messages and isolated local QA script. Full provenance, preservation boundaries and browser evidence: `docs/FINAL_SPOT_TRADING_RECONCILIATION.md`.
- Preserved newer Blue Verified Badge, Crypto Card, Copy/Nazar/Ksenia ledgers/outputs, Homepage, Wallet, Futures, Analytics, Arbitrage, auth/navigation/security, backend order/matching/balance logic, all dependencies/locks, schema/migrations and Render/Docker configuration. Shared Futures behavior remains default; Spot explicitly opts into its changes. No main or production changes; only this owner-review feature branch may be pushed.
- Full pre-follow-up regression **111 suites/1315 tests PASS** (backend **85/912** unchanged). Final frontend after all fixes **28 suites/422 tests PASS**; relevant backend order/auth/matching/PriceWatcher rerun **6 suites/52 tests PASS**. Frontend/backend TypeScript and production builds PASS; existing Vite large-chunk warning only. Final tested frontend assets: `index-DlXfUWv1.js`, `index-DZyZPoHa.css`. Card/Copy preservation assertions remain exact; no test assertion was weakened to conceal a product regression.
- Actual built-app browser QA **1920/1440/1280/1024/768/390/375 PASS**: no page overflow, panel/control overlap or runtime console errors. Markets search/Slash/filters/sorting/Favorites/resize/collapse, live grouping/spread/price selection, candle timeframes/pairs/volume/MA200/Bollinger/RSI/MACD/pan/zoom and all drawing tools verified. Dense empty/populated/history/Assets panels and order-entry validation tested. Found and fixed OCO double-cancellation, pair-transition grouping and tiny-token display issues before acceptance; MOG and BTC were both rechecked in the final build.
- Local QA uses actual compiled auth/router/OrderService/MatchingEngine with isolated in-memory account persistence and test balances, and real public Kraken/CoinGecko market data. Actual Limit/Stop/Take Profit/OCO requests, cancellation/refund, conditional-line PATCH and correct no-liquidity/invalid/balance errors were exercised. Market SELL with no internal liquidity is explicitly cancelled with no fake success. Harness self-test **15 checks PASS**. No production credential/database/account or order writes, and no invented market feed/fills.
- Keep `http://127.0.0.1:4181/trade` open and the local QA server running for owner review. Local output/journal/test artifacts remain untracked and are not pushed. Next step is owner review; **do not merge main, deploy, change Render or create production test orders without a new explicit request**. No outstanding implementation/test/browser mismatch is known.

## 2026-09-07 — Codex Copy Trading eligibility UX and distributed synthetic sessions

- Owner explicitly authorized production/review deployment. Main base `f0466eaeff377aa4b10de42ed20fbc62db5b3799`, feature `codex/contextual-copy-notice`; paired review base `f2b8d7278759ace627b8c64e5739d7610a83cb4d`. This entry is included in the implementation commit; final SHA and live deployment verification are reported after push, not inferred here.
- Removed the permanent eligibility/deposit strip and profile minimum-deposit caption. Existing Copy buttons open the exact requested native deposit dialog below the unchanged threshold; eligible accounts retain their existing Following action. That existing action is client-side state, not newly implemented backend copy execution. No auth, KYC, wallet/deposit handling or real money behavior changed.
- Removed the remaining Copy notice scope/paragraph and ReviewDisclosure fallback. Previously approved tiny, localized source-aware labels sit only beside modeled figures; explicit real/live sources suppress them. No global replacement banner, modal warning, or new explanatory paragraph. App's previously removed global prelaunch wrapper stays removed.
- Canonical synthetic session generation genuinely caused five of seven 90D negative sessions to fall in one July week; dates and chart mapping were correct. Added an opt-in complete session replay with losses on June 16/29, July 8/24, August 4/20 and September 1. The unchanged execution/capital/follower engine emits the revised trades and every derived metric; no SVG/date shuffle, clipping or separate chart values.
- Preserved baseline 471 trades (434 wins, 34 losses, 3 breakevens), 7D/previous-7D/30D/90D/ALL ROI budgets 112/115/271/841/3727%, exact baseline ALL PnL 4,711,027 USDT and derived 5.79% ALL drawdown. Reordered sessions necessarily recalculate operating capital, period cash PnL and follower economics: September 7 master 90D PnL is 1,115,513.8223 and ALL PnL 4,748,052.5290. These recalculated amounts must not be described as unchanged.
- Persisted source state/default constructor/CAS append behavior, exact Ksenia state/response, real order/copy services, DB schema/data, security dependencies, approved charts and unrelated products remain unchanged. The new normal Nazar read response is a deterministic, explicitly modeled in-memory replay, with its own immutable future prefix and revision tag.
- Validation before promotion: full main Jest 116 suites / 1,387 tests PASS; frontend/backend TypeScript and production builds PASS; source preservation, math, priced-trade/account constraints, follower replay and +1/+7/+30/+90 append tests PASS. Built desktop 1440 and mobile 390 Copy dialog/Close/Escape/no-overflow checks PASS. Actual deployed route verification remains mandatory after both pushes and LIVE deployments.
- Pre-change public September 7 Nazar response SHA `d368d1b791d3a9c726a05d1a983787d714b202b0418e7360f355fe9f6b301cf4`; independently replayed response SHA `b25e334a069e411c1d707ba51e2bb920b8bf39337800a2171317181a96453267`. Review Ksenia proxy returned 503/timeouts before this deployment; report separately and verify after the existing review backend auto-deploy. No service configuration, credentials or database access was changed.

### Live verification and final modal-only requirement follow-up

- Main `2610e2a0e55a70dadc29a06d7ce6aaf1a2a0e38f` reached LIVE on both existing production services; review frontend `211f63fea76039bc8b49bc9cd19b66fc0af8c0b1` also reached LIVE. Actual authenticated production and isolated review browser checks at 1440/390 passed: no global banners or permanent eligibility containers, no top gap/page overflow/console errors, exact requested modal, Close/Escape/focus/scroll restoration, all 90 bars and seven correctly dated negative sessions, unchanged linear chart rendering. Production direct-load/F5 passed. Production Trade/Markets/Wallet/Card/Futures/Analytics/Arbitrage/Settings and review Trade/Markets/Wallet/Card/Copy/Home checked. No production financial/copy execution was performed.
- Final inspection found the old historical minimum-deposit footer below follower economics still mentioned the threshold. This small follow-up removes only that paragraph in both branches, retaining all policy/history values internally; the $20k requirement now appears solely in the Copy-click modal. Regression normalizations reverse exactly this one approved removal, not broader text or logic. The follow-up still requires its own normal auto-deploy and live verification.
- Review backend's pre-existing September 7 startup failure is independently reproduced from the exact previously published Ksenia export: historical copied-quantity IEEE-754 tails. Recovery is isolated to review using the already-approved main compatibility guard and exact old-record/AUM-prefix retention, with strict money values; production backend and database remain unchanged by that recovery.

## 2026-09-07 — Codex Wallet premium UX (owner review; NOT deployed)

- Implementation commit `2135803531c53fe7295d9feb2ae6a376546309ae`, isolated branch `codex/wallet-ux-refinement`, from explicitly fetched current production baseline `35f7daecfac3104a3bce4027a8af103dc3534801`. No main/review promotion, push, Render action or production deployment. The previously blocked review-backend worktree remains separate and unmodified.
- Material application files: WalletPage and wallet-v3 PortfolioStrip, AssetLedger, PortfolioAllocation, TransactionHistory, wallet.css only. Kept Inter; normal-case readable typography and larger total; six desktop columns (Asset/Balance/Available/24h/Value/Actions); asset units with symbols; positive locked amounts nested under Available; mobile quantity-first expandable rows with USD secondary; existing Trade/Transfer/Deposit/Withdraw routes/dialogs behind row actions. Allocation rail is 390px versus 312px at desktop (+25%), donut 184px versus 132px. No new translation or explanatory copy.
- Browser QA found and corrected two Wallet-only presentation issues: a narrow-screen total splitting its last cent (eye control moved beside the heading), and existing modal z60 underneath mobile navigation z90/support z998 (scoped modal z1100 and explicit light-workspace text/font). Supplied missing preflight border styles with zero-specificity selectors restricted to Wallet main/dialogs. Shared Nav, modal functional code, auth and unrelated products were not changed.
- Preserved existing real API values/valueUsd, balance/available/locked amounts, formatting precision, valuation, PnL periods/sparkline, backend/database/API/auth code, and all Claude/Codex Trade/Copy/Nazar/Ksenia/Card/Futures/Analytics/Arbitrage/security work. Dedicated tests retain baseline source fingerprints for financial/data/modal code and exercise actual JSX callbacks rather than manufactured successful transfers.
- Validation: frontend TypeScript PASS; full frontend **31 suites / 502 tests PASS**, including **35 Wallet regressions**; local harness **10 checks PASS**; production Vite build PASS (existing large-chunk advisory only), final assets `index-BK68njTP.js` / `index-Cv9RVrUQ.css`. Built-app browser checks at **1920/1440/1280/390/375** PASS: six columns, no page/financial-cell overflow, mobile USD, actual large/dust/zero/locked displays, search, sorting, hide-zero/masks, PnL period control, history filters/status/date readability, Trade navigation and existing action menus/dialogs. Mobile Cancel hit target and modal contrast verified; no runtime console errors. History intentionally scrolls inside its own mobile table.
- Screenshots shown to owner. QA uses loopback-only test account/balances/history, actual built frontend/auth guard, and read endpoints; all financial/API writes rejected, no production credentials or DB used. Keep `http://127.0.0.1:4184/wallet` and local `scripts/qa-wallet-ux.cjs` server available for owner review. Run metadata and random local bootstrap URL remain in untracked `outputs/wallet-ux-qa/`. No outstanding implementation/test/browser issue; **await owner review before any deployment**.
## 2026-09-07 — Codex Copy Trading card polish (owner review; NOT deployed)

- Implementation commit `8640969`, isolated branch `codex/copy-card-polish`, from freshly fetched production/main `9635e53132fc842c6ccb1c95866b483d3420fd7d`. No main/review promotion, Render action or production deployment. Await owner review.
- Application scope: `copy-trading-bolt/components.tsx` moves existing conditional Nazar VIP beside the name and existing blue verified badge; `CopyTradingRefinement.css` brightens the enabled Copy CTA, retains disabled/following states, adds visible keyboard focus, widens desktop catalogue cards/controls, and increases metric-label readability/spacing. Mobile breakpoints and dark VOLTEX presentation retained. No new user-facing text.
- Preserved all Claude/Codex trader data, identity/KYC flags, ROI/PnL, canonical ledger, chart renderer/style, profile CSS, eligibility/copy callbacks, backend/DB and other products. Regression tests reverse only the exact VIP markup move when checking the existing component fingerprint; profile CSS and canonical data/chart fingerprints remain unchanged. Existing local source labels were not removed or replaced.
- Final frontend TypeScript PASS; frontend Jest **31 suites / 504 tests PASS**; production Vite build PASS (existing large-chunk advisory only). Final built assets `index-BGFCaxMy.js` / `index-QD03Omre.css`. `git diff --check` PASS.
- Actual built-app Codex browser QA **1920/1440/1280/390/375**: no horizontal page overflow or clipped Copy buttons; 4/4/3/1/1 grid columns; desktop card widths 345/329/394px. Screenshots shown to owner. Nazar VIP/verification inline, readable gold CTA and actual 2px keyboard focus confirmed. Below-$20k click opens the unchanged exact deposit modal; Close works. No browser error logs. Eligible/following/disabled behavior covered by unchanged functional code and frontend tests; no real copy execution performed.
- Local preview `http://127.0.0.1:4185/copy-trading` uses actual built frontend and unchanged compiled canonical service with an in-memory local account/state. Public identity/ranking reads only; all API writes blocked, no production credentials/DB used. QA helpers/output remain untracked under `outputs/`; no dependency changes. Main and production untouched by this task.

## 2026-09-07 — Codex top navigation balance-control removal (owner review only)

- Implementation `877c9dd`, branch `codex/top-nav-cleanup`, based on freshly fetched main `1f9fcf4aba72690aaefebd4cfbbc216cddb499ed`. That previous Copy polish release was independently verified LIVE on both production Render services, including unchanged Nazar profile text/chart paths; this new navigation change is NOT deployed or pushed.
- Only application edit: remove WalletBalanceControl import/mount and its obsolete placement comment from `frontend/src/components/Nav.tsx`. No CSS, other navigation/More menus, Wallet component, balances, APIs, backend, auth or deposit behavior changed. Existing component retained unmodified. Test reverses exactly these removed bytes and preserves the original whole-Nav hash.
- Frontend TypeScript, 31 suites/504 tests, production build and diff check PASS. Built-app local screenshot shown; right actions are exactly Deposit / RU / Profile, no balance control/page overflow/console errors. Existing deposit dialog opens/closes; local read-only QA fixture does not supply deposit networks, so no financial flow was executed or claimed verified. Production remains untouched. Await owner approval before deployment.

## 2026-09-07 — Codex Futures terminal UI (owner review; no deployment)

- Implementation `9d844dad8fa3c595d27e30504067d2ba85b2c2ce`, branch `codex/futures-ui-polish`, from freshly fetched production/main `00c6dc3f0d595a0401eb3ab73e071841d73338e3`. No main/review merge or Render action. Await owner visual review before deployment.
- Material files: FuturesPage adds a scoped FuturesTerminal.css; FuturesOrderForm moves static inline styling into that stylesheet with larger inputs, Spot-like tabs/surfaces, selected-state accessibility and visible scrolling CTA. FuturesAccountSummary and MarginTypeToggle typography/radii refined; LeverageSlider adds only a CSS hook (CFD appearance unchanged). Futures-specific market/book text and column widths enlarged; chart toolbar scrolls locally at narrow desktop widths.
- Preserved all Claude/Codex Futures effects, order callbacks/payloads, Long/Short, Limit/Market, Isolated/Cross, leverage limits, Reduce Only, percentage sizing, margin/liquidation formulas, tiers, balances, transfers, pair data/search/favorites/sort, live book/aggregation and chart implementation. AST fingerprints compare all non-visual semantics against the baseline. No backend, API, DB, financial data, Spot, Wallet, Copy Trading, Card, auth or navigation changes.
- Final frontend TypeScript PASS; frontend Jest **32 suites / 514 tests PASS**, including 10 new Futures-only scope/preservation checks; Vite production build PASS (existing large-chunk advisory only). Assets `index-Cz66Y2I8.js` / `index-qc4fsSWT.css`; diff check PASS.
- Actual built app browser QA: **1920/1440/1280** screenshots shown to owner, no page overflow; market/chart/book/form widths approximately **288/1075/250/307**, **280/620/240/300**, **280/460/240/300** respectively. Additional 768/390 layout checks show no horizontal overflow. Form/account/tier scrolling and narrow-screen chart-toolbar access retained.
- Browser interactions verified Short/Market/Cross/20x/Reduce Only, book grouping, clicked book price restoring Limit, quantity/notional/margin/liquidation readouts, Transfer modal open/close, search, favorites, alphabetical sort, pair switching, timeframe/MACD toggling. No browser error logs. Real public Kraken/production market GETs used; live external book updates and candles observed. Private QA account has zero fixture balances, all writes denied; no real order submission or money transfer performed.
- Local owner preview `http://127.0.0.1:4186/futures`; isolated QA helper/output stays untracked in `outputs/`. Main and production untouched by this task.

## 2026-09-07 — Codex owner-authorized Futures release and concurrent-main build repair

- Approved Futures implementation promoted by fast-forward to main at 0e0a5191b56b67de07082e7f90f8b319c3657247, preserving newer owner commits. Concurrent owner deletions through d1237ac removed ModeledDataLabel/CSS/test helper but left active imports; Render frontend failed TS2307. Owner confirmed editing was finished.
- Repair removes only the dangling component import and three label mounts. Removed files remain removed. Updated obsolete label expectations, retaining exact existing financial/chart/source fingerprints and all eligibility/identity tests. No backend, DB, balances, calculations, chart styling, Card work or Render configuration changed.
- Frontend TypeScript and production build PASS; full frontend 32 suites / 507 tests PASS. Existing Vite chunk-size advisory only. Owner's newer main work intentionally preserved. This entry precedes the repair commit; deployed SHA/LIVE verification must be reported from Render, not inferred from passing tests.
- New Crypto Card visual work is isolated on codex/crypto-card-visual-consistency and explicitly excluded from this production release pending owner review.

## 2026-09-07 — Codex Crypto Card visual consistency

- Branch `codex/crypto-card-visual-consistency`, baseline `ded37e7ae4595569fa7210a5675df11e6acf8e20`; this entry accompanies the implementation commit. Owner reviewed screenshots and subsequently authorized deployment. The separate next request for two cards plus smartphone on Homepage is NOT part of this release.
- Homepage/auth share approved Black Signature through VoltexCard; five benefit icons refined including exact official Apple Pay artwork; Card hero uses generated blank unbranded smartwatch plus unchanged real master as separate layer; final CTA uses the same master; POS master mapping centralized, obsolete ATM floating overlay removed. Both final masters and all tier economics/application/backend/other products preserved.
- Frontend TypeScript/build PASS; 33 suites / 512 tests PASS; built-app Homepage/Card QA at 1920/1440/1280/1024/768/390/375 has no overflow or broken images. Desktop/mobile screenshots shown; auth and POS checked, no console errors observed. See `docs/CRYPTO_CARD_VISUAL_CONSISTENCY.md` for full asset provenance and generation prompt.
- Approved Futures and concurrent-main import repair already verified LIVE on frontend/backend at `ded37e7`, including actual production Futures browser checks. Card deployment still requires its own LIVE/browser verification after this commit is pushed; no DB/config/credential changes.

### Crypto Card release verified; next Homepage-only composition

- Owner-approved Card release `49a853f4eb454c74365344b56560ea375c89f049` fast-forward pushed to main after preserving newer internal-doc commit `2f7051e`. Render frontend `dep-daf8dpc9v7es73bpah90` and backend `dep-daf8dpc9v7es73bpahbg` both independently confirmed LIVE on this SHA. Actual authenticated `https://voltextech.net/card` shows the new smartwatch/unchanged Black Signature master; no overflow. Post-release Render error logs are empty. No Render/env/domain/DB changes.
- Subsequent owner request is isolated on `codex/home-card-two-cards-phone` from `49a853f`: only HomeCardSection's central visual mount changes; new HomeCardComposition renders Titanium + Black Signature and a deterministic SVG smartphone with a clean VOLTEX card-wallet screen and masked balance (not invented account data). Original PNG bytes retained; outline clips remove only empty studio backdrop outside each complete card perimeter. Uniform scale/rigid rotation, no skew, no card-on-card occlusion, no hands. Auth and `/card` still use the approved prior release.
- All Homepage text, feature icons/list, CTA routes and surrounding grid/background remain exact, asserted by a reverse-diff fingerprint test. No backend, financial values, business rules, other products or dependencies changed. No additional bitmap generation/download necessary for this code-native composition.
- TypeScript PASS; full frontend 33 suites / 514 tests PASS; production build PASS (existing large-chunk advisory only); assets `index-DVDwXTyh.js`, `index-LsLlmJQ4.css`. Browser preview at 1920/1440/1280/1024/768/390/375: exactly two card images and one phone, no horizontal overflow; desktop and mobile screenshots shown. Homepage preview remains open at `http://127.0.0.1:4186/?qa=two-cards-final#card`.
- This entry accompanies the Homepage implementation commit. The new Homepage composition is NOT promoted/deployed; owner requested preview after checks. Main remains the separately approved `49a853f` release. Local QA output stays untracked and excluded from Git.

## 2026-09-07 — Codex Homepage composition release with phone expenses

- Owner authorized deploying the reviewed two-card/phone composition `0750c76` and requested expenses on the phone, not only buttons. Re-fetched main remains `49a853f`; no newer application edits to reconcile.
- Only new application edit: HomeCardComposition replaces its lower card/action tiles with three illustrative expense rows (Shopping -$128.50, Netflix -$12.99, Transport -$24.00), dates and icons. This is static promotional artwork, with masked balance and no API/account binding. Actual balances/transactions, masters, page text/layout/CTAs, Card/Wallet/backend/other products are unchanged.
- Frontend TypeScript/build PASS; 33 suites / 514 tests PASS including new expense assertions and exact Homepage surrounding-layout preservation. Built preview displays both full cards, phone and all three rows; no horizontal overflow or console errors. Final assets `index-aRgkK0KE.js` and `index-LsLlmJQ4.css`.
- This entry accompanies the release commit. Push only these validated Homepage changes through the existing main auto-deploy, with no Render configuration change; actual LIVE and production Homepage verification required after push. Local outputs remain untracked.

## 2026-09-07 — Codex final wrist-reference Crypto Card hero (owner review only)

- Branch `codex/card-watch-reference-final`, from fetched current production `a61c73abf249a8b1e1f3698dbb73af3122a33101`; this entry accompanies the implementation commit. No main/review promotion, Render action or deployment. Await owner approval.
- Shared WatchCardVisual uses a built-in image_gen edit of the owner's exact feminine-wrist/orange-strap smartwatch reference. Removed baked-in external slogan/wordmark; neutral graphite CHF retains Swiss flag. Five fiat badges left and five full-color crypto badges right; no BNB/XRP. Preserved original watch, entire VOLTEX rainbow-ring card and composition. Versioned PNG and full prompt/provenance in `docs/CRYPTO_CARD_WATCH_VISUAL.md`.
- HomeCardSection and Card Hero now share this artwork and exact live heading `Трать крипту по всему миру`. Homepage center column uses proportional desktop widths to keep the image legible at 1024px. Retired unused two-card/phone module and obsolete mobile crop CSS; no card/badge clipping or stretching. Final CTA, auth artwork, physical masters, all other copy, benefits, eligibility/KYC/application/business code and unrelated Claude/Codex product work preserved.
- Frontend TypeScript PASS; full frontend 33 suites / 514 tests PASS; production Vite build PASS (existing large-chunk advisory only). Updated only visual assertions/fingerprints; financial/product-state preservation tests remain intact. Assets `index-BKLRsdep.js` / `index-DGycu1bW.css`; diff check PASS.
- Actual built-app browser QA of Homepage and `/card` at 1920/1440/1280/1024/768/390/375 PASS: exact slogan, correct asset, no horizontal overflow, full watch/card/ten badges, neutral CHF and proportionate scaling. Desktop/mobile screenshots of both shown inline to owner. No browser console errors. Existing isolated loopback QA only, no production account/API/DB writes. Local `/card` preview remains open; outputs excluded from Git.

### Owner-authorized wrist hero release — 2026-09-07 10:40 UTC

- Owner approved deployment. Fresh remote main was `a61c73abf249a8b1e1f3698dbb73af3122a33101`; fast-forward pushed only validated implementation `a97cb677f28a86d61ab9090abd6fef2aa17da6a7` to main and its feature branch. No additional application/test/dependency/configuration changes. Existing 33 suites / 514 tests, TypeScript, build and seven-width local QA remain applicable to that exact commit.
- Render independently confirmed LIVE on the same SHA: `voltex-exchange` deployment `dep-daf97s3bc2fs73cvtfm0` at 10:38:20 UTC; `exchange-api` deployment `dep-daf97s3bc2fs73cvtfog` at 10:38:19 UTC. Existing auto-deploy only; no manual duplicate trigger, service/env/domain/DB changes.
- Actual production Homepage `https://voltextech.net/#card` browser screenshot confirms new wrist/card/ten-badge visual, neutral CHF, exact slogan and no horizontal overflow/console errors. Frontend serves `index-C9Fv5PJq.js`. Homepage and `/card` SPA document return HTTP 200; image returns 200 and is byte-exact SHA256 `ac18b001ae9bb5f370efae95953c7d6deda508679882b4220b7b687e41b39013`. Post-release Render error logs empty.
- Owner completed login; authenticated production `https://voltextech.net/card` is now browser-verified, including reload. Screenshot confirms approved wrist/watch/card artwork and all ten badges; DOM confirms exact heading `Трать крипту по всему миру`, `voltex-watch-wrist-final.png` and production bundle `index-C9Fv5PJq.js`. No horizontal overflow or browser console errors; reload remains on `/card` without login redirect. Page left open for owner. No account creation, auth bypass, application submission or financial action. Final production visual QA complete; no further app changes or deployment.

## 2026-09-07 — Codex targeted payment-card / ruby CHF correction (owner preview)

- Branch `codex/card-payment-chf-correction`, based on freshly fetched main `bd41a81fb87adb9dec812c77d476e983e52e046b`; this entry accompanies the feature commit. Preserved newer owner cleanup and all Claude/Codex functionality; no main modification, push, Render action or deployment.
- `CardScene.tsx` restores the actual immutable Black Signature PNG in ATM and fixes POS aspect ratio/grip placement. Both scenes retain original photo/hand pixels with a controlled foreground-finger mask and uniform card scaling. `WatchCardVisual.tsx` selects a new sibling `voltex-watch-wrist-ruby.png`: deep ruby CHF/white Swiss cross, same overall watch concept, badge sets and exact slogan. No card-master, page CSS/copy, business/data/API/DB or unrelated product changes.
- TypeScript/build PASS (existing chunk-size advisory). Three Card suites PASS, including two new compositing regression cases. Full frontend: 31 suites / 512 tests PASS; 2 stale Copy chart fingerprint tests FAIL, already inherited from owner cleanup on bd41a81. Their tested source/tests/helper have zero diff against starting main. No unrelated Copy repair attempted. Card promotion baseline fingerprints updated to preserve the owner's already-committed copy changes.
- Built-app desktop 1440/mobile 390 screenshots of all three visuals shown inline; additional bounds QA at 1920/1280/375 PASS. Cards fully inside responsive frames, chip/branding preserved, ruby CHF legible, no horizontal overflow or browser console errors. Existing loopback preview left open; no production credentials/writes.
- Details, exact built-in imagegen prompt, source/output asset paths and QA limitations: `docs/CRYPTO_CARD_PAYMENT_CHF_CORRECTION.md`. Await owner approval before deployment. Local `outputs/` artifacts preserved and excluded.

### Owner follow-up: restore original watch photo and expose the complete ATM card

- Continues `codex/card-payment-chf-correction` after `04cc0fbc8ca0b1a86085502d55322a570e4ca271`. Owner rejected the edited photo and explicitly allowed restoring the supplied original. Active `voltex-watch-wrist-original.png` is byte-exact owner PNG (SHA256 `e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b`), with original red CHF. Viewport excludes old external lettering while retaining the entire watch and ten badges. No AI variant is active.
- ATM Black Signature shifted to meet the fingertip at its lower-right edge; no foreground mask on its face, so all edges/Mastercard are visible. Same immutable master/proportions; POS/photo backgrounds, all copy/CSS, product logic, backend and other data unchanged.
- TypeScript/build PASS; 3 targeted Card suites / 26 tests PASS. Desktop 1440/mobile 390 screenshots confirm original photo and complete ATM card, no overflow/console errors. Previous unrelated full-suite stale Copy fingerprint failures are not modified. Full details in `docs/CRYPTO_CARD_PAYMENT_CHF_CORRECTION.md`.
- Local preview only. No push, main/production change or Render action; await owner approval. Rejected generated art/local outputs remain untracked and excluded.

### Owner-approved Card correction deployed — 2026-09-07 11:37 UTC

- Codex fetched fresh main `bd41a81fb87adb9dec812c77d476e983e52e046b` and fast-forward pushed the two reviewed Card commits through `c45caf9176ca63af28d47afe362b5af711fa73c8` to main and `codex/card-payment-chf-correction`. No new application/test/dependency changes during deployment. Existing owner cleanup and all unrelated Claude/Codex behavior preserved. Previously validated TypeScript/build and 3 Card suites / 26 tests apply to this exact release; prior unrelated full-suite limitations remain documented above.
- Existing Render auto-deploy independently confirmed LIVE on this SHA: frontend `voltex-exchange`, `dep-dafa28u7bikc73e1bv6g`, 11:34:39 UTC; backend `exchange-api`, `dep-dafa28u7bikc73e1busg`, 11:34:38 UTC. No Render configuration, credentials, domains, DB or manual deployment trigger changed.
- Authenticated production `/card` reload and screenshots confirm exact original wrist/red CHF photo and full ATM card/Mastercard; POS scene also visually verified. Bundle `index-CzdUHScq.js`. No page overflow or browser console errors. Root and `/card` documents HTTP 200; API `/health` HTTP 200. Served original PNG HTTP 200 / 1,865,666 bytes / SHA256 `e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b`, identical to owner original. Post-LIVE error logs through 11:37 UTC empty.
- The existing authenticated session redirected the optional Homepage visit to `/futures`; no Homepage screenshot claimed for this deploy. Shared watch component and public asset are verified on `/card`. Production Card left open. No financial/account action performed. This post-release handoff is local documentation only, not a new production release.

## 2026-09-07 — Codex Homepage Card screenshot polish (owner preview only)

- Branch `codex/home-card-layout-polish`, from freshly fetched production `c45caf9176ca63af28d47afe362b5af711fa73c8` plus the local post-release handoff `fb3ec00`. This entry accompanies the implementation commit. No main/push/Render/deploy action.
- Owner's annotated screenshot: move left text outward, slightly enlarge right-hand type, replace primitive pictograms, round/blend photo edges. Only `HomeCardSection.tsx`, `CardBenefitIcon.tsx`, `home.css` change application code. Desktop left padding 36→12px; benefit headings 13→15px, descriptions 11.5→13px with clearer contrast; consistent 42px graphite/champagne icon frames with Lucide pictograms and unchanged official Apple Pay/OpenAI brand marks. Homepage-only 24–42px artwork rounding and restrained inset edge shading. No new visible words, routes/actions, data or business logic.
- Exact owner photo bytes, WatchCardVisual component, `/card`, payment/ATM scenes, both card masters, other Homepage text/CTAs/background animations, and all newer Claude/Codex product work preserved. Scoped CSS cannot affect other pages. Reverse-diff tests enforce unchanged remaining Homepage markup/CSS; source/image fingerprints protect the shared artwork.
- TypeScript PASS; production build PASS (`index-CvZGjSAn.js`, `index-DFE1hu2L.css`, existing chunk advisory). Three targeted Card/Homepage suites: 32/32 PASS. Previous unrelated full-suite stale Copy chart fingerprint failures remain unchanged; full suite not rerun for this scoped follow-up.
- Actual built app on existing read-only loopback preview: 1920/1440/1280/1024/768/390/375 widths inspected, no page horizontal overflow; 1920/1280/390 explicit heading bounds show no text clipping. Desktop1440 and mobile375 screenshots shown; no console errors. Existing `/__qa/public` setup used only to exit the local fixture session and view Homepage; no production auth/session changes. Main/production unchanged; await owner review before deploy. Untracked local outputs preserved.

## 2026-09-07 12:22 UTC — Codex final Card edge/CHF/localization/registration polish (owner preview)

- Implementation `e3dff5e7d999ec2cccb3eacde2367fe6ba52c26f`, continuing `codex/home-card-layout-polish` at `c73c9171b2075ae8aae024e59d9ba55770873312`. Freshly fetched main remains `c45caf9176ca63af28d47afe362b5af711fa73c8`. No push, main modification, Render action or deployment; await owner approval.
- `WatchCardVisual.tsx`: unchanged owner PNG, controlled 14–16% outer SVG opacity fade with full-opacity badge islands and unblurred central watch/card. Removed photo-tile rounding/inset frame from Homepage CSS. CHF-only overlay precisely replaces its original face with graphite, ruby/champagne rim, white CHF and red Swiss flag/white cross. No other badge or bitmap regeneration; all original files and physical masters byte-exact.
- `Hero.tsx` and `HomeCardSection.tsx` share existing `cardCopy.heroTitle`, now approved slogan in RU/EN/ZH/ES/HI/JA/KO. Removed only the duplicate six-asset row below Card CTAs. Prior three-column composition, benefit icons/type/padding and all other copy preserved.
- Registration opts into `RegistrationCardVisual.tsx` via AuthShell; recovered approved two-master/expense-phone SVG from `a61c73a`. Scoped compact sizing only. Default Login output, Login source, registration form/validation/routing, auth behavior, ATM/POS scenes, Card application/eligibility/economics, other Claude/Codex products/backend/DB unchanged. Reverse-diff and immutable-asset tests enforce these boundaries.
- TypeScript PASS; production Vite build PASS (`index-BdH-6wLd.js`, `index-DIK_bKNI.css`, existing large-chunk advisory). Full frontend: **31 suites / 526 tests PASS, 2 suites / 2 tests FAIL**. Only failures are inherited stale `ProfilePerformanceChart` fingerprints in `avatarIdentityPresentation` and `nazaraCardPresentation` (expected `68921d09…`, actual `db61fb5e…`). Their sources/tests/helper and Copy runtime have zero diff against fetched main; no unrelated repair attempted. All Card/registration checks pass, including seven-language rendered headings and Login preservation. Diff check PASS.
- Actual built-app QA: Homepage and Card at 1920/1440/1280/1024/768/390/375; registration 1440/390. All measured page widths have no horizontal overflow. Desktop/mobile screenshots shown for all three pages; also verified retained ATM/POS complete-card visuals, English Homepage switching and default Login single-card view. No console errors. Existing loopback-only QA session, no production credentials or writes. Public Homepage market-summary unavailability is an existing local read-feed limitation, unrelated to Card visuals. Local outputs remain untracked. Owner preview `http://127.0.0.1:4186/#card`.

## 2026-09-07 - Codex Homepage original-hand framing

- Continued existing `codex/home-card-layout-polish` from freshly fetched `73fa20f2312bca2c3b8bb888886cd99c4a764b22`. Right-hand fix `687c1a2d6d9899aa26de33e0931531b7e55f36be`; owner's additional left-wrist correction `b208d3bc1c9da4bf7772671e0dc41e493c3b19de`.
- Runtime changes only `WatchCardVisual.tsx` and the `HomeCardSection.tsx` opt-in. Homepage viewBox `516 80 928 925` -> `516 80 932 1006`, restoring 4 source pixels right and 81 below; watch scale -0.43%. Right-hand opacity ellipse (1450,720), radii (360,820), protects original fingers/nails. Additional left-wrist ellipse (610,750), radii (180,270), reveals existing sleeve/wrist via SVG overflow and mask x430/width1018 without moving the watch. Both use 88% solid cores/12% feathering; background blending retained. No image generation or PNG edits.
- PNG hash remains `e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b`. All ten badges, CHF, original female hand, watch/card, text, CTAs, column layout/CSS and all newer Claude/Codex functionality preserved. Default `/card` rendered SVG byte-exact. Only image height grows naturally (~50px at 1440).
- Updated `cryptoCardVisualConsistency.test.ts` and `cryptoCardProductionPromotion.test.ts`: immutable assets/default SVG, full-opacity skin points, hidden old photo lettering and unchanged other Homepage markup. TypeScript PASS; four Card/Home suites 45/45 PASS; production build PASS (`index-qOzAXWKh.js`, unchanged `index-DIK_bKNI.css`, existing chunk advisory). Diff check PASS.
- Built Homepage QA 1920/1440/1366/1280/1024/768/430/390: no horizontal overflow, overlapping columns or console errors; original proportions and ten badges retained. Desktop/mobile screenshots inspected, with fresh full-section 1440px owner screenshot. Local market-summary unavailability is pre-existing and untouched.
- Feature branch only; no main merge, deploy, Render, production, business/backend/DB changes. Existing untracked outputs preserved. Preview `http://127.0.0.1:4186/?qa=original-hand-left#card`. Await owner review before deployment.
