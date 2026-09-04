# AI Handoff Log

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
