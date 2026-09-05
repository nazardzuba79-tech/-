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

## 2026-09-04 — Claude (Opus 5) — Authentication UI: one split screen for /register and /login

Branch `claude/auth-ui-refine`, cut from `origin/main` (`32f7bbe`). Not merged,
not deployed, Render untouched.

### What changed

`/register` and `/login` are now the same screen: a dark VOLTEX presentation
column (~56%) and a light, warm-neutral auth workspace (~44%). New shared
shell in `frontend/src/pages/auth-shell/`:

- `AuthShell.tsx` — the split layout, the hero, the three benefit rows, the
  Crypto Card section and the privacy footnote. Each page passes its own form
  as children plus the header's switch prompt/link.
- `AuthFields.tsx` — `AuthField` and `AuthPasswordField`, the two controls both
  forms are built from (real `<label for>`, `${id}-error` + aria-describedby,
  a real toggle button with aria-label/aria-pressed).
- `auth-shell.css` — every selector prefixed `.vx-auth`; carries its own
  `:where()`-wrapped preflight substitute, since Tailwind runs with
  `corePlugins.preflight: false`.

`AuthPage.tsx` was rewritten onto that shell and is now sign-in only (the
former marketing fold — hero tickers, phone mockup, CFD section, perks banner,
legal row and the `AUTH_V0_VARS` cyan palette — is gone). `RegisterPage.tsx`
became a thin wrapper; `RegisterPanel.tsx` kept its logic verbatim and changed
only presentation. `RegisterVisual.tsx`, `Field.tsx`, `PasswordField.tsx` and
`register.css` were superseded and deleted.

Copy: hero is `Торгуйте. / Управляйте. / Платите.` with gold on the third line
only. The fake "Платформа работает" status dot and the
"DIGITAL ASSET INFRASTRUCTURE" eyebrow are gone and are asserted absent by the
QA script. The design source's fake submit confirmations ("Проверьте данные и
продолжите регистрацию.", "Данные готовы к проверке.") were deliberately not
ported — the forms show only the server's own messages.

i18n: 22 now-unused keys removed, 27 added, across all 7 dictionaries
(988 → 993 keys each, all seven equal and unique).

### Preserved

- Registration is still Email + Password only, 10+ chars with 1 uppercase, one
  `POST /auth/register` that returns a session token and lands the user in the
  platform. No confirm-password, phone, country, referral input, OTP, email
  verification or terms checkbox. The referral code still arrives silently from
  `REFERRAL_CODE_STORAGE_KEY`.
- Login keeps `requires2fa` → pending-token → `loginWith2FA`, and `?next=`
  handling via `readNext`/`defaultTradingPath`.
- The approved physical card artwork is reused through `HomeCryptoCard`
  (`/cards/voltex-card-dark.png`) — not redrawn, not recoloured, no invented
  card number. The design source's CSS-drawn placeholder card was not ported.
- Privacy microcopy is the repository's existing `auth.privacyNote` sentence,
  not the design source's tax-authority wording.

### Notes for whoever picks this up

- "Забыли пароль?" opens the real support chat (`openSupportWidget`), because
  there is no self-service reset endpoint on the backend. If one is ever added,
  that is the single call site to change.
- `frontend/src/components/PhoneMockup.tsx` is now unreferenced. It was left in
  place rather than deleted — that is outside this task's scope.
- The repository has no ESLint configuration (root or frontend), so no lint
  step was run; `tsc -b` under strict mode is the static gate.
- Google Fonts are blocked by this sandbox's egress proxy, so local screenshots
  render in fallback faces. DM Sans and Manrope are already preloaded by
  `index.html` in production; no new font request was added.

### Checks actually run

Frontend `tsc -b` clean; `npm run build` clean (`✓ built in 4.44s`). Full
backend suite: 70 suites, 720 tests, all passing. Auth suites specifically:
44 tests passing. Real browser QA against the running app (backend on :3000,
Vite on :5173): registration with a fresh address returned a real token,
stored it and navigated to `/futures`; a wrong password on `/login` rendered
the server's own "Invalid email or password"; the correct password signed in;
password toggle flips `type`; inline validation shows "Введите корректный
email" / "Пароль слишком короткий"; tab order is logical on both pages and
both labels are correctly associated; no page errors. Responsive sweep at
1920/1440/1366/1280/1024/768/430/390/375 on both routes: zero page-level
horizontal overflow, and none of the four banned strings present at any width.
No production deployment was performed and none is claimed.

### 2026-09-04 — follow-up on the same branch: final left-side copy

Copy-only alignment on `claude/auth-ui-refine`. Layout, warm background
treatment, spacing, responsive behaviour, auth logic, Crypto Card artwork,
inputs, form structure and routing are all untouched.

Hero is now `Биржа / институционального / уровня` — "Биржа" in warm white
(`#F4F1EA`), the second and third lines in the existing restrained gold
(`#D9A441`); the type scale is the one already in place, unchanged. Supporting
line and the three benefit rows replaced with the approved wording ("0%
комиссия", "500+ цифровых активов", "VOLTEX Crypto Card").

One non-string change came with it: the first two benefit icons were a
candlestick and a building, which described the previous copy. They are now a
percent mark and coins. Revert is one line each in `AuthShell.tsx` if not
wanted.

Verified: frontend `tsc -b` exit 0, `npm run build` clean. Browser check at
1920/1440/1280/1024/768/430/375 — no page-level horizontal overflow, the hero's
long middle word fits on one line at every width, hero colours confirmed by
computed style, and none of "60+ стран", "300+ криптовалют", "низкие комиссии",
"Платформа работает", "DIGITAL ASSET INFRASTRUCTURE" or the retired
"Торгуйте./Управляйте./Платите." lines appear at any width.

## 2026-09-04 — Claude (Opus 5) — `claude/ui-polish-ready`: the two approved UI branches, consolidated

Review branch cut fresh from `origin/main` (`32f7bbe`). Not merged, not
deployed, Render untouched.

Five commits cherry-picked, no merge commits and no branch histories pulled
in — in order: the auth split screen, the final left-side copy, the benefit
icon family, the registration password checklist, and the header balance
removal. Every cherry-pick applied cleanly; there were no conflicts, because
the two source branches share no file (auth touches `pages/auth-shell`,
`pages/register`, `AuthPage.tsx`, `lib/i18n.tsx`; header touches `Nav.tsx`
and `index.css`).

Verified rather than assumed: the resulting tree is byte-identical to
`claude/auth-ui-refine` on every auth file and to
`claude/header-balance-cleanup` on every header file, and it differs from
`origin/main` in exactly those 14 paths and no others. `src/`,
`prisma/`, `render.yaml`, `package.json`, Wallet, Analytics, Copy Trading,
Futures, Markets, Admin and `lib/api.ts` are all untouched.

`WalletBalanceControl` is preserved and still imported by
`pages/home/HomeHeader.tsx`; only the `Nav.tsx` call site is gone.

### Checks actually run

Frontend `tsc -b` exit 0; `npm run build` clean (`✓ built in 4.70s`); auth
suites 44/44 passing; all seven i18n dictionaries at 996 keys, equal and
unique.

Browser regression at 1920/1440/1366/1024/768/390/375. Auth, both routes at
every width: registration is `reg-email` + `reg-password` only, the two-row
password checklist renders, login carries no checklist, and there is no
checkbox, phone, OTP or confirm-password control anywhere; no page-level
horizontal overflow; none of the retired strings present. Live flow: a
password without an uppercase letter keeps the CTA disabled, a valid one
enables it, and submitting returned a real token and landed on `/futures`.
Header, six routes × seven widths (42 combinations): no balance control,
Кошелёк / Пополнить / language / Профиль all present, zero trailing gap, no
overflow.
## 2026-09-04 — Claude (Opus 5) — Wallet: detailed PnL / performance page

Branch `claude/wallet-pnl-detail`, cut from `origin/main` (`32f7bbe`). Not
merged, not deployed, Render untouched.

### What was added

`/wallet/performance`, behind the Wallet's existing PnL card, under the same
`RequireAuth` guard as `/wallet`. New folder
`frontend/src/pages/wallet-performance/`:

- `analytics.ts` — pure derivation over the canonical equity series: daily
  PnL, drawdown, statistics, period buckets. No fetching, no data of its own.
- `charts.tsx` — three hand-drawn SVG charts (equity, daily-PnL histogram,
  drawdown) with a shared hover crosshair and tooltip.
- `WalletPerformancePage.tsx`, `performance.css`.
- `__tests__/analytics.test.ts` — 27 tests.

### The single source of truth is unchanged

`PortfolioPerformanceEngine` still builds the one time-weighted series and
still measures the five windows off it; `GET /wallet/performance` still
serves it. This page consumes `periods[period].points` and derives
everything else from that array. No second engine, no hardcoded dataset, no
backend change at all — `src/`, `prisma/` and `render.yaml` are untouched.

Because the series is already cash-flow adjusted upstream, deposits,
withdrawals and Spot↔Futures transfers cannot distort anything here. That is
asserted in tests through the real engine, and it is visible in the live
fixture: an account seeded with a $40,000 deposit reports all-time PnL of
$12,564.85 (+23.45%), not $46k.

Daily PnL is `equity[i] - equity[i-1]`, so it telescopes: the bars sum to the
window's PnL exactly and the histogram cannot disagree with the curve. That
invariant is a test.

### Metrics

Total PnL, ROI, days in period, profitable/losing days, win-day rate, average
daily PnL, best/worst day, max drawdown (% and $), annualised volatility,
Sharpe, Sortino, profit/loss ratio. Anything that cannot be computed honestly
returns `null` and renders "Недостаточно данных" — a single return has no
dispersion, and a window with no losing day has no P/L denominator.
Risk-free rate is taken as zero for Sharpe/Sortino; this deployment has no
rate curve and inventing one would silently change every figure.

### Shared files touched, and why

- `App.tsx` — the route.
- `PortfolioStrip.tsx` — the PnL block became a `<Link>` to
  `/wallet/performance?period=<current>`, carrying the selected window over.
  The period buttons stayed outside the link; they are controls.
- `useWalletData.ts` — an additive `{ rankings: false }` option so the
  performance page does not poll a 200-row coin feed it never renders.
  Default unchanged, so WalletPage behaves exactly as before.
- `tailwind.config.js` — the new folder added to `content`.
- `i18n.tsx` — 40 keys × 7 languages (988 → 1028 each, all equal and unique).

### Checks actually run

Frontend `tsc -b` exit 0; `npm run build` clean; full suite 71 files, 747
tests passing. Browser QA at 1920/1440/1366/1024/768/430/390/375: no
page-level horizontal overflow at any width (the breakdown table scrolls
inside its own container below 768). All five periods verified against the
API's own numbers; 1Y correctly shows the not-enough-history state on a
140-day account. Tooltips confirmed on all three charts. The PnL card
navigates in and the breadcrumb navigates back. Signed-out access redirects
to `/login?next=%2Fwallet%2Fperformance`.

### Limitations

- Charts are pointer-driven, so tooltips do not arm on touch; every figure
  they show is also printed as text beside the chart.
- The breakdown keeps the most recent 60 buckets and reports the count.
- Flow valuation inherits the engine's existing caveat: flows are valued at
  today's price, exact for stablecoins and approximate otherwise.

## 2026-09-04 — Claude (Opus 5) — `claude/review-ready`: both approved features together

Review branch cut fresh from `origin/main` (`32f7bbe`). Not merged, not
deployed, Render untouched.

Seven commits cherry-picked, no branch histories merged: the six from
`claude/ui-polish-ready` (auth split screen, final copy, benefit icons,
password checklist, header balance removal, its handoff note) and the one
from `claude/wallet-pnl-detail` (the performance page).

One conflict, in `docs/AI_HANDOFF.md`: both branches append their own entry
at the end of the file. Resolved by keeping both entries in order — nothing
was dropped. `frontend/src/lib/i18n.tsx` auto-merged cleanly because the two
features add keys at different anchors (`auth.backToLogin` /
`register.password` for auth, `wallet.notEnoughHistory` for performance);
verified afterwards rather than assumed: 1036 keys per dictionary, all seven
equal and unique, 26 auth keys and 40 `perf.` keys present, and the retired
`register.passwordHint` gone.

Every non-overlapping file is byte-identical to its source branch, and the
tree differs from `origin/main` in exactly 23 paths — `src/`, `prisma/`,
`render.yaml`, Copy Trading, Analytics, Markets, Trade, Futures, Admin, the
Crypto Card artwork and `lib/api.ts` are all untouched.

### Checks actually run

Frontend `tsc -b` exit 0; `npm run build` clean; auth + wallet/performance +
admin-profile suites 98 tests passing. Browser smoke at 1440/1024/390 over
`/register`, `/login`, `/wallet`, `/wallet/performance`, `/trade`,
`/futures`, `/copy-trading` — 21 combinations, no horizontal overflow, no
error boundary, no console or page errors, and on every authenticated route
the header carries Кошелёк/Пополнить/language/Профиль with no balance
control. Registration is email + password only with the two-line checklist
and correct CTA gating; login shares the shell and shows no checklist. The
Wallet PnL card opens `/wallet/performance?period=7d`; all five periods
render (1Y honestly empty on a 140-day account), the daily-PnL histogram's
tallest bar is 2.0x-5.7x its median rather than one spike, and all-time PnL
reads +$13,501.44 (+25.28%) on an account holding a $40,000 deposit — the
deposit still excluded.
## 2026-09-04 — Codex — Copy Trading visual refinement (local only)

- Branch: `codex/copytrading-functional`, continuing the existing isolated worktree as requested. Implementation commit: `99d3e441ba1b9eed72a3c9324465b8807029b21f` (base `32f7bbe48eaa18ca731713a0095d87a315512ef8`). No merge, push or deployment performed in this pass.
- Files: `frontend/src/pages/CopyTradingPage.tsx`, `frontend/src/pages/copy-trading-bolt/components.tsx`, new scoped `CopyTradingRefinement.css`, `frontend/src/lib/dailyPnlChart.ts`, and its three tests.
- Marketplace: lifted charcoal/graphite surfaces, clearer card borders and secondary text; existing VOLTEX branding and layout retained. Profile: near-white workspace, compact KPI sidebar, wider chart column, responsive stacking, readable tables and follower panels. Shared header/navigation and unrelated products were not edited.
- Charts: period ROI and cumulative PnL readouts; Daily PnL total and daily average. Replaced minimum-height flex bars with dated, signed, zero-based linear SVG bars from the existing daily ledger, with numeric axes, exact-value titles and internal horizontal scrolling for dense histories. No smoothing, clipping, fake zero bars or redistribution. Real late-period growth remains visible because the existing synthetic ledger requires it; generator and backend were not changed.
- Profiles without a daily ledger retain their existing ROI chart and now explicitly show PnL/history unavailable. PnL switching is disabled there instead of relabeling an ROI curve as PnL. No new financial constants added.
- Preserved Claude/integration work: Auth, Wallet, Analytics, Markets, Trade, Futures, API/security/permissions, and the existing synthetic engine and rolling/ALL selectors. Existing copying/subscription behavior is unchanged; this visual pass does not establish real backend copy execution.
- Validation: frontend TypeScript passed; Jest 3 suites / 11 tests passed, including all-period bar/ledger totals at initial state and +90 days. Frontend production Vite build passed (1996 modules); existing >500 kB bundle warning remains. `git diff --check` passed.
- Browser QA: marketplace and profile checked at 1920/1440/1366/1024/768/390; no page-level horizontal overflow or overflowing panel bounds. Desktop/mobile visual checks passed. Search, ranking, favorites, profile/back, ROI/PnL and trade tab tested. 7D/30D/90D produce 7/30/90 bars; ALL retains the complete 90-day initial fixture. Unavailable-history profile checked. No error/warning console entries recorded in this local QA session.
- QA limitation: `http://127.0.0.1:4174/copy-trading` serves the actual production frontend build using a local-only fixture server outside the repository, with the unchanged synthetic engine's generated response and a zero-balance QA identity. This is visual/interaction verification, not production or backend persistence verification. Production, Render and main untouched. Review this local commit before any integration/deployment.

## 2026-09-04 — Codex — isolated Render visual-review workflow

- Started from the then-current `origin/main` `c360802233ac480083be81e76a6cd93ffccd22c1`. Reconciled the already-live `claude/review-ready` work (auth UI and Wallet PnL detail), then integrated the validated Copy Trading visual commits `99d3e441ba1b9eed72a3c9324465b8807029b21f` / `92d89be9c7ad072ce1f7f02a42619df4cffa0e42`. Staging isolation implementation: `724ccd2d7642aeedd4225e11721686185b014b5b`.
- Existing Render `voltex-review` is the single review service and auto-deploys `claude/review-ready`. No second service was created. Existing production frontend/API services and `render.yaml` were not modified.
- Added the branch-selected review build, separate public component-review entry, persistent warning, generated synthetic Copy Trading sample, strict API/network policy and `docs/STAGING_REVIEW.md`. Production `App.tsx`, route guards, service settings, domains and production environment variables are unchanged. Normal build still performs `tsc -b && vite build`.
- Review is not a staging account environment. It cannot authenticate, register, load account/Wallet data, place orders or perform writes. The client stops such calls before the network; the preview server separately blocks `/api/*` and non-GET methods, applies `form-action 'none'`, no-store/noindex, and never proxies the production API. The sole sample is the repository engine's explicitly synthetic Copy Trading response. See `docs/STAGING_REVIEW.md`.
- Validation: frontend TypeScript passed through both builds; normal production build passed (1999 modules, 4.45s); isolated review build passed (1954 modules, 4.01s); existing large-chunk warning only. Four focused suites / 13 tests passed, including review-denial and Copy Trading ledger/period tests. Local browser matrix covered `/login`, `/register`, `/copy-trading`, `/wallet`, `/markets`, `/futures`, `/trade` at 1920/1440/1366/1024/768/390/375: no horizontal overflow and no error boundary. Login submission stayed local and rendered the review-only rejection; Copy profile loaded 90 ledger bars and consistent numeric readouts; console warning/error log was empty. Review bundle scan contained no `api.voltextech.net` string; direct HTML routes returned 200 with the isolation headers; an `/api` POST returned 403.

## 2026-09-04 — Codex — homepage Copy Trading, motion and institutional references

- Source branch: `codex/homepage-copytrading-motion`, based on `origin/main` `c360802233ac480083be81e76a6cd93ffccd22c1`. Integrated source commits: `87cd944c7ba18d8f147f5b3663634da93b13efef` and `3a4b0bd822416ba5a7ddbfb0ded7d820b5d140ba`.
- Added a premium Copy Trading section between Crypto Card and Markets. Its four strategy aliases, ROI, AUM, win rate, copier count, risk and derived PnL come from the existing `copy-trading-bolt/traders.ts` catalogue/functions; no second financial model or request was added. The CTA is `/copy-trading`, and the section explicitly labels results as product presentation rather than promised returns.
- Added the lower light institutional-standards section with Nasdaq, NYSE, CME Group, Interactive Brokers, Saxo Bank and UBS Switzerland as restrained typographic industry references. No logo files were found or fabricated, and the visible disclaimer expressly rejects partnership, sponsorship and affiliation claims.
- Motion is CSS-only: existing one-time section Reveal now stages the new cards, with restrained lift/CTA feedback. `prefers-reduced-motion` disables the effects, and mobile disables the staged/hover travel. No animation dependency, image asset, timer, scroll listener or additional network request was added.
- Files integrated: `frontend/src/pages/home/HomePage.tsx`, `HomeCopyTrading.tsx`, `HomeInstitutional.tsx`, `homeContent.ts`, `home.css`, `frontend/src/lib/i18n.tsx`, and `frontend/src/lib/__tests__/homeContent.test.ts`. Auth, Wallet, Analytics, trader detail, backend execution, Render configuration and production settings were not changed.
- Validation before review push: focused homepage suite 2/2 passed; frontend TypeScript passed; normal production build passed (2002 modules, 4.41s); isolated review build passed (1957 modules, 4.09s). The existing large-chunk warning remains. Browser QA at 1920/1440/1366/1024/768/430/390/375 reported no page-level overflow, four cards, both new sections within bounds and a live CTA at every width. Desktop and 375px visual passes were checked; the CTA followed the existing route/auth behavior.
- First live review smoke exposed a review-entry-only issue: Home's Tailwind utility layer arrived in production through the Settings route, which the isolated entry intentionally omits. `src/review/main.tsx` now imports that already-existing scoped utility file directly. This changes only the review bundle; the rebuilt review CSS restored the verified homepage layout without touching production entry/routes or application behavior.

## 2026-09-05 — Codex — Homepage hero copy micro-fix

- Source branch: `codex/homepage-hero-copy`, based on completed Homepage commit `3a4b0bd822416ba5a7ddbfb0ded7d820b5d140ba`. Source commit: `df89d0b`; staging code commit: `4da614e`.
- Changed only `frontend/src/lib/i18n.tsx`: the hero headline is now the locale-independent brand line `OWN YOUR FUTURE.`; the Russian supporting statement is exactly `Ваш доступ к мировым рынкам и свободе.`. The former generic headline and technical feature-list sentence were removed in all seven locales, with the new supporting statement localized outside Russian.
- Preserved without modification: Hero JSX/CSS, eyebrow, CTAs, terminal and phone previews, background, motion, layout, responsive rules, Copy Trading and institutional sections, Markets, navigation, footer, Auth, Wallet, Analytics, backend and review isolation.
- Validation: frontend TypeScript passed; focused Homepage suite 2/2 passed; production Vite build passed (1995 modules; existing large-chunk warning only). Browser QA at 1920/1440/1366/1024/768/430/390/375 confirmed the exact Russian copy, no old copy, no page-level horizontal overflow, content and CTAs within viewport, and the unchanged terminal present. The headline uses one line except the existing 1024px split-column layout, where it wraps naturally to two.
- Scope: integrated only into `claude/review-ready` for the existing isolated Render review service. `main`, production services, production configuration, domains and environment variables remain untouched.

## 2026-09-05 — Codex — source-pixel physical card recovery

- Baseline: freshly fetched `origin/claude/review-ready` `31d54ad239f2892c838cf36cf210aed14ada694c`. Corrective branch: `codex/physical-card-fidelity`. Implementation: `bc99a07e37414e0e713c959249a376197340855b`. The rejected local ImageGen drafts were replaced before commit; this correction uses no generative model.
- Added six raster files and provenance JSON under `frontend/public/cards/`, `VoltexPhysicalCard.tsx`/CSS, the isolated `PhysicalCardsReview.tsx`/CSS and `/physical-cards` route, offline extraction/validation scripts and `docs/PHYSICAL_CARDS.md`.
- Black Signature is a bicubic homography of the original source; 97.09% of opaque output is unchanged after rectification, with only the payment mark repaired. Titanium preserves 58.11% of opaque output, reconstructs 39.17% occlusion through deterministic material/groove continuation and repairs the remaining 2.72% payment-mark area. The review's blue/orange overlays expose these boundaries. These are preservation measurements, not a 1:1 fidelity claim; Titanium's unseen design and edge inference remain approximate.
- Both masters are true RGBA 1000 × 630; lossless WebP derivatives preserve visible pixels. No network/contactless marks, CSS card-face reconstruction, invented card details, glow, tilt, blur or motion in the comparison. Existing source-image softness/lighting remains visible; additional exact detail requires unobscured source artwork.
- Preserved Claude/shared work: Home, Auth, CardPage/CardFace/HomeCryptoCard, Copy Trading, Wallet, Analytics, markets/trading functionality, permissions, production App routes and all Render configuration. Changes are confined to reusable assets and isolated review usage.
- Checks: frontend TypeScript passed; production build passed (2002 modules), review build passed (1962 modules), existing chunk-size warning only; 2 Jest suites / 4 tests passed. Offline validation passed for both assets: source/master hashes, alpha, ratio, lossless derivatives, exact unmasked source equality and removal of saturated payment-mark pixels.
- Browser: local `/physical-cards` tested at 1920/1440/1366/1024/768/430/390/375; images loaded, ratio retained, no overflow, no animation/transform, no warning/error console logs. Variant selection and repair maps checked; keyboard activation also verified. The browser's full-page capture showed scaling/stitching artifacts, so stable viewport captures plus measured element bounds were used for verification.
- Delivery scope: push the corrective branch and fast-forward only this work into existing `claude/review-ready`; verify the existing review service's actual deployment and `/physical-cards`. No main or production deployment is authorized by this task.

## 2026-09-05 — Codex — final approved Crypto Card archive integration (local)

- User confirmed `VOLTEX-CryptoCard-Codex-bundle.zip` as the design source. Fetched latest shared/review/card refs first. Continued the clean existing `work/physical-card-assets` worktree on `codex/crypto-card-integration`, fast-forwarding from `d5f1f60` to `4cd24ec2c20f43bcf691c57f0f1be12cfcc7da29`. This base contains current `origin/integration/claude-codex` `32f7bbe48eaa18ca731713a0095d87a315512ef8`. Implementation: `841dc63f4ea8d659cbdfa8e8bf76c4997c44afd4`.
- Material files: `frontend/src/pages/CardPage.tsx`, new `crypto-card-final/` components/data/state/scoped CSS, dedicated prefixed Tailwind config, 15 supplied/self-hosted assets under `frontend/public/cards/crypto-card-final/`, package manifest/lock, isolated review route, two focused test files and `docs/CRYPTO_CARD_ASSETS.md`.
- Ported all archive landing sections and their dark/cream composition, card choices, currency/service marks, typography and motion. Supplied physical PNG masters are byte-identical; phone/card composites exclude obsolete embedded text via deterministic alpha masks. No image generation. POS/ATM artwork uses one SVG coordinate system so the card stays in the hand under responsive cropping. Source provenance and mask coordinates are documented.
- Final owner copy adjustment: hero reads “Карта, которой можно платить каждый день”; paragraph reads “Оплачивайте покупки, онлайн-сервисы и подписки, а также снимайте наличные во всем мире.” Removed the specified presentation paragraph beneath hero CTAs. Approved benefits are HTML: “До 20% кешбека.”, “Без комиссий.”, “$1 млн в месяц.” Black Signature limit explicitly says “в месяц”; no old daily-limit copy is published.
- Preserved newer real functionality: shared Nav/Footer, production `/card` RequireAuth, KYC-approved persisted waitlist GET/POST, pending/duplicate protection, server joined timestamp, localized status, errors/retry and verification link. No issuing/payment/balance/freeze APIs were fabricated. The application area still distinguishes a waitlist from issuance. Archive marketing remains Russian; shared locale controls and waitlist date/status localization are retained.
- Review `/card` explicitly passes `reviewOnly`; it makes no card-account requests or submissions. Existing review network policy, backend/API/auth/schema, Home, Copy Trading, Wallet, Analytics, Trade/Futures, shared CSS/configuration and Render configuration unchanged. Existing dirty Copy Trading/Nav work in `work/staging-setup` was left intact.
- Validation: frontend TypeScript passed; 4 Jest suites / 24 tests passed (presentation, waitlist controller, existing backend card endpoints, review policy). Production build passed (5627 modules, 5.00s), isolated review build passed (5589 modules, 5.25s); existing large-chunk warning remains. `git diff --check` passed. Compiled audit found all 436 vc-prefixed utility rules scoped under `.crypto-card-page`.
- Browser: local `http://127.0.0.1:4178/card`; measured actual viewport widths 1920/1440/1366/1024/768/430/390/375, no horizontal overflow or over-wide headings. Inspected hero, POS/ATM, subscriptions, tablet currency arc, card choices, fees, FAQ and application art. Mobile menu opens/closes and anchors navigate; FAQ works with mouse and Enter; Get card goes to the explicit review-only application state. No broken loaded images and no console warning/error entries observed. Actual card issuing/provider or production-account behavior was not browser-tested.
- Scope: local implementation commit only, no push/merge/deployment in this task. Main, shared staging, Render and production untouched. Preview runs separately on port 4178 and the existing browser tab is reused. Next step is owner review before shared integration/staging promotion; this task does not establish a live card-issuing product.

## 2026-09-05 — Codex — distributed synthetic Daily PnL

- Branch: `codex/copytrading-daily-pnl`, isolated from freshly fetched review `fff59a4c34076691a3e8c6d07ae784c0b59d5dab` (the current Copy Trading visual implementation). Code: `f52a1f0f5ff61a3937d4b77a200ab8da631becb3`. The Crypto Card branch/worktree remains untouched.
- Root cause was the synthetic generator, not SVG geometry: its 60/23/7-day equity anchors allocated 61.49% of the initial 841,000 USDT PnL to the final week. Replaced fresh-state generation with seeded additive session PnL, irregular losing days, daily variation and overlapping stronger/weaker clusters. The 90-day total remains 841,000 USDT / +841% ROI; 30-day block shares are now 31.28%, 34.55%, 34.17%; last-seven share 6.52%; largest day 2.25%; nine losing days. Short-window ROI and risk/follower figures are recalculated, not held to incompatible historical targets.
- Version 2 continuation appends bounded dollar-PnL sessions with deterministic drift instead of compounding each template return against growing capital. Existing persisted version-1 ledgers retain their history and continuation; no migration, persistence-key change, reset or account/database write was performed. The new distribution applies to fresh review/new synthetic environments or an explicitly requested synthetic reset. Existing stored production histories are NOT silently repaired by deploying this code.
- Fixed the related rolling follower-PnL boundary: exclude the opening-equity cutoff day while including eligible subscription-start trades. This matches the same 7D/30D/90D trading windows used by the profile.
- Files: `src/services/copyTrading/SyntheticCopyTradingEngine.ts`, `syntheticConfig.ts`, `types.ts`, `analytics.ts`, existing `__tests__/SyntheticCopyTradingEngine.test.ts`, new `__tests__/SyntheticDailyPnlDistribution.test.ts`, and this handoff. No frontend chart/CSS/design change. Preserved Claude/shared routing, authentication, permissions, real trading, account data, Wallet, Analytics, Home, Crypto Card, review isolation and synthetic disclosure.
- Validation: 5 Jest suites / 24 tests passed. Distribution and one-ledger metrics checked at initial, +7/+30/+90/+180; ALL prefixes remain unchanged; split/batch advances match. Frontend TypeScript and targeted strict engine/service TypeScript passed. Production frontend build (2002 modules) and isolated review build (1962 modules) passed, existing >500 kB chunk warning only. Full backend `tsc --noEmit` reports 53 unrelated errors also reproduced on untouched baseline worktree `physical-card-assets`; no check disabled and no unrelated source repaired.
- Browser: actual isolated local `/copy-trading` at `http://127.0.0.1:4176/copy-trading`; Nazara profile visually checked at desktop 1440 and mobile 390. The 90 daily bars show distributed gains and nine red days, no ending concentration; 7D/30D/90D/ALL show 7/30/90/90 bars with matching KPI totals; ROI/PnL switching checked. Zero page-level horizontal overflow; existing internal mobile chart scrolling retains every day; no console warning/error entries.
- Delivery: feature-branch push only. No integration into shared staging or main, no Render operation and no production deployment in this task. Local preview is a freshly generated, labelled synthetic scenario, not a verification of real trading performance or persisted production data.

## 2026-09-05 — Codex — 97.2% synthetic win rate and smaller down days

- Follow-up on `codex/copytrading-daily-pnl`, starting `5efeb5fc265647ee089b701348caa371ff40e6fb`; implementation `c8c060e06f0acb04a2c8c49477aa90640ad7f334`. The user explicitly requested 97.2% successful trades and less prominent negative days. Earlier fresh-state counts were 702 wins / 728 trades = 96.43%, not 97.2%.
- Fresh version-3 scenarios contain 750 trades, 729 wins and 21 losses: exactly 97.2%, computed by the unchanged analytics and frontend. Daily counts still vary within 4–12, with count reconciliation spread across shuffled days. Nine days have net losses; twelve additional profitable days contain a losing trade. All losses, gains, fees and daily/equity totals remain in the same synthetic ledger.
- Reduced negative daily weights from 0.25–0.75 to 0.06–0.18 and renormalized the whole scenario to the existing 841,000 USDT / +841% endpoint. Net losing days now range from -639.06 to -1,836.03 USDT (about 77% smaller); largest red bar is 10.13% of the largest green on the unchanged linear chart. Initial drawdown 0.842%, Profit Factor 4.6; risk and follower metrics recompute. Shorter windows and future observations retain their actual count-derived win rates, not a fixed 97.2% label.
- Files: engine, synthetic configuration, state version type, distribution test version expectations, new `SyntheticWinRateCalibration.test.ts`, this handoff. Preserved frontend layout/CSS/chart scale/colors, all other product areas, persisted v1/v2 histories and their continuation. No automatic reset/migration or database write. Fresh preview/new environments receive v3; persisted environments require an explicit reset to regenerate history.
- Checks: 6 suites / 34 tests passed, including exact counts, small genuine red days, all rolling/ALL math through +180 days and legacy persistence. Frontend TypeScript and strict targeted engine/service TypeScript passed. Production frontend and refreshed review builds passed (existing chunk warning only). Browser at local `http://127.0.0.1:4176/copy-trading` visibly shows Win Rate 97,20%, Total Trades 750, Winning Trades 729, Losing Trades 21 and smaller red bars; no page overflow or console errors.
- Feature-branch push only. Shared staging, main, Render and production untouched. This is explicitly synthetic demo calibration, not modification or evidence of real trading performance.

## 2026-09-05 — Codex — synthetic ALL inception, copier cohorts and XRP

- Continued `codex/copytrading-daily-pnl` from freshly fetched `717691e0c1181f37bb2dbe99972ee46b0913ba72`. Code commit: `6f6e292b09066a2c3f155f24ec2f9bae1a148e3b`. User requested +3727% (percentage, not money) since 12.5 months ago, 2/6/12 early copiers and logical later growth, plus XRP in Main Markets.
- Fresh v4 inception is 12 calendar months plus 15 days before bootstrap, using clamped UTC calendar arithmetic. On 2026-09-05 this is 2025-08-21: 380 trading days, 381 equity points, 100,000 USDT opening equity, 3,727,000 USDT realized PnL and 3,827,000 USDT closing equity. ALL +3727% and 97.2% derive from 3,250 actual synthetic trades (3,159 wins / 91 losses), not display overrides.
- Preserved approved recent-90-day +841% ROI and 750/729/21 counts with nine relatively small red days. Compatible anchors require 406,695.0053 USDT opening equity and 3,420,304.9947 USDT PnL for those 90 days: 91.77% of lifetime dollar PnL is in the last 90 days. This consequence was explained to the user; ALL is not independently smoothed to conceal it. Last-seven share remains 6.49% of 90-day PnL, with stronger clusters earlier in that window. v4 stores its original recent-90 template offset so advancement does not replay low-PnL prehistory.
- Seeded, irregular copier join dates reproduce 2 at inception, 6 on day 7, 12 at month 1, 17 at month 2, 25 at month 6 and 32 currently. Per-follower PnL uses only join-date-or-later closed trades and the prior close as opening exposure, including existing copy-ratio/slippage/latency deductions. New v4 daily AUM snapshots also record historical follower counts; past snapshots remain intact during advancement. Current allocated AUM remains 7,200,000 USDT (not including accumulated PnL); generated ALL follower PnL is 137,376,661.24 USDT, calculated from these allocations and join dates, not separately calibrated.
- Profile additions stay within existing structure: full inception/end dates and year-aware ALL labels, opening/current strategy capital, allocated-AUM and copier step-history charts with recorded milestone values. Individual follower PnL/ROI explicitly means since joining; marketplace ALL follower PnL uses the same all-time total. Main Markets now includes XRP when present in the complete strategy ledger, retaining BTC / ETH / SOL and independent of the selected rolling period.
- Files: backend engine, analytics, config and types; existing distribution/win-rate tests plus new `SyntheticInceptionHistory.test.ts`; frontend `lib/syntheticCopyTrading.ts`, `pages/copy-trading-bolt/components.tsx`, scoped `CopyTradingRefinement.css`, new `lib/__tests__/syntheticInceptionPresentation.test.ts`; this handoff. Preserved Claude/shared Auth, Wallet, Analytics, Homepage, Crypto Card, trading/navigation/permissions, review isolation, Daily PnL linear geometry/colors and unrelated worktrees.
- Validation: 8 Jest suites / 47 tests passed in one final run. Exact initial percentages/counts, calendar/leap/month-end cases, daily cohort/AUM values, follower PnL, complete ledger/risk math, append-only +1/+7/+30/+90/+180 and legacy preservation are covered. At +90, ALL contains 470 days while rolling windows contain exactly 7/30/90; old ALL trades/equity/AUM prefixes remain unchanged. Frontend TypeScript and targeted strict engine/service TypeScript passed. Normal frontend build (2002 modules) and isolated review build (1962 modules) passed; existing >500 kB chunk warning only. Full backend TypeScript was not rerun here; previous handoff records 53 unrelated baseline errors. `git diff --check` passed.
- Actual browser verification at `http://127.0.0.1:4176/copy-trading`: ALL displays +3727.0%, +3,727,000 USDT, 97.20%, 380 daily bars and 381 equity points; opening/current capital, six cohort milestones and BTC / ETH / SOL / XRP confirmed. 7D/30D/90D show 7/30/90 bars, ROI/PnL switching works, and the 90-day bars retain distributed gains with small genuine negative days. Default/1440 desktop and 390 mobile layout checks show no page-level overflow; ALL date labels retain years and history charts use internal scrolling where needed. No warning/error console entries. Left the profile open on ALL.
- Delivery is feature-branch push only. Shared staging stays `fff59a4c34076691a3e8c6d07ae784c0b59d5dab`; main stays `c360802233ac480083be81e76a6cd93ffccd22c1`. No Render operation, deployment, production change, real account/database write or automatic reset/migration. The new scenario applies to fresh review/new synthetic environments or an explicitly requested synthetic reset; persisted v1–v3 histories and policies are retained. This is synthetic analytics, not real copy execution or verified historical investment performance.

## 2026-09-05 — Codex — livelier Copy Trading catalogue cards

- Continued existing `codex/copytrading-daily-pnl` from `73368f631eca637705ec31819488ee9378d4199f`; code commit `8b08f05`. Fetched remote state first. This is a feature-branch visual follow-up, not a new marketplace implementation or deployment.
- Changed `copy-trading-bolt/components.tsx` and scoped `CopyTradingRefinement.css`; added `demoPerformance.ts`, `traderVisuals.ts`, `TraderAvatarArt.tsx`, two focused tests and `public/copy-trading/avatars/*`. Selected cards have silver/copper/gold highlights; ROI and sparklines occupy separate columns with restrained guides. Four original generated avatars (two playful characters, two fictional portraits) use 192px WebP derivatives, approximately 28 kB combined; original PNGs and exact prompts are retained in `PROVENANCE.md`. Other aliases use original code-native artwork.
- Non-Nazara catalogue aliases now use one deterministic normalized equity snapshot each, retaining existing ALL/90D/30D/7D ROI endpoints. Steady/choppy/recovery paths have genuine signed variation; a selected subset has sharp mid-period bursts. Drawdown, volatility, Sharpe and Sortino derive from the selected slice; undefined ratios are shown as unavailable, never capped. Cards, profile ROI charts and drawdown sorting agree. These illustrative curves are not trade ledgers or advancing server accounts; existing example trade/follower fields remain catalogue inputs. Per-card demo badges were not added; a catalogue-level explanation remains, and fictional aliases no longer receive the legacy verified checkmark.
- Preserved the Nazara backend ledger, Daily PnL/history, all existing rolling/ALL engine behavior, uploaded operator portrait precedence, deposit eligibility, favourites/following behavior, navigation/auth/permissions and unrelated Claude functionality. This does not implement real copy execution or certify investment performance. The earlier seven pending backend v5 files and local Nav/icon port remain unstaged and are deliberately excluded from this commit.
- Validation: 9 scoped Jest suites / 57 tests passed; after the final catalogue-noise regression was added, the affected 4 frontend suites / 17 tests passed (58 distinct scoped tests covered overall). Frontend TypeScript passed through normal and isolated-review workflows. Production build passed (2006 modules, 4.28 s); review build passed (1966 modules, 4.82 s); pre-existing >500 kB chunk warning only. Final staged diff check passed.
- Browser: actual isolated review at `http://127.0.0.1:4176/copy-trading`; desktop and 375px mobile visual checks, layout measurements at 1920/1440/1280/1024/768/430/390/375 found no page-level horizontal overflow or ROI/chart overlap, including long ALL ROI. Four WebP avatars loaded. Search, favourites add/list/remove, ROI/drawdown sorting, all four periods, profile/back and Nazara ROI/PnL switching passed; console warnings/errors empty. Nazara retained the pre-existing local v5 ALL 4,711,027 USDT / 380 days. QA ran with that prior uncommitted v5 scenario and icon port present, not as a claim those files were included here. Viewport override cleared and one marketplace tab left open.
- Delivery: feature branch only. `main` remains `c360802233ac480083be81e76a6cd93ffccd22c1`; shared review remains `fff59a4c34076691a3e8c6d07ae784c0b59d5dab`. No merge, Render/configuration operation, production/account/database write or deployment. Review the independently pending v5 work before any future integration.

## 2026-09-05 — Codex — Crypto Card final product correction (staging scope)

- Starting worktree: `work/physical-card-assets`, clean `codex/crypto-card-integration` at `d42c730372babbe5468e21a3eda455eb75d9c6f4`, including approved archive implementation `841dc63f4ea8d659cbdfa8e8bf76c4997c44afd4`. Short-lived branch: `codex/crypto-card-product-final`; product implementation commit `3c12344d9b64e5999e5a097922bb213bd60938fa`.
- Remote-audit correction: this clone's `remote.origin.fetch` fetches only `codex-test`. Plain fetch did not refresh the cached `origin/claude/review-ready` (`fff59a4`). Before pushing, Render's live deployment and `git ls-remote` exposed current review `179b513845fc6c1407bb7f5e628083e8091f36bc`. Explicitly fetched review/integration/main refspecs. Current integration is `32f7bbe`; current remote main is `ced48a598c64269880ed00fca712ce1c148298de`, advanced by other work, not this task. Do not use the old cached main/ref values as deployment evidence.
- Integrated current review history into the feature branch before promotion, preserving every newer Copy Trading source/asset byte from `179b513`. Only conflict was append-only `docs/AI_HANDOFF.md`; retained both complete entries, no blanket ours/theirs resolution. No Copy Trading redesign or edits to its pending local v5 scenario. Other dirty worktrees remain untouched.
- Product copy: removed active waitlist/prototype/legacy card terminology. One concise eligibility area, three steps, seven useful FAQs, exact owner privacy wording, neutral subscription examples including App Store (not Apple Music), approved fiat/crypto lists. All 131 card-copy keys localized in RU/EN/ZH/ES/HI/JA/KO; removed 574 unused old `card.*` entries only, retaining Home/Auth/Wallet and other namespaces.
- Exactly two terms: Titanium first, Visa/gold ring, base tier, cashback up to 10–15%, $50,000/month; Black Signature second, Mastercard/rainbow ring, premium tier, up to 15–20%, $1,000,000/month. Both issuance/service zero and selected-subscription compensation up to 100%. Removed repetitive fee explanations. The hero uses approved cryptocurrency/everyday-payment copy and the exact three marketing benefits. A small scoped headline scale correction prevents its longest word exceeding the desktop column.
- Backend: new `CardApplicationService`, authenticated GET `/api/v1/card/application/me` and POST `/api/v1/card/application`, strict product input, no-store, account-owned requests. The rule is exactly APPROVED verification AND (credited deposit >= $5,000 OR persisted executed volume >= $50,000), never AND between financial routes. KYC comes from `User.kycStatus`; deposits from real CREDITED `Deposit` rows; volume from `Trade.price * quantity` for maker/taker Spot/Futures fills, excluding DemoTrade and same-user self-trades. No artificial volume period or frontend eligibility math.
- Valuation reuses existing `WalletPortfolioService.pricesFor`, not Wallet presentation holdings. No historical USD marks exist, so non-USD amounts use explicitly reported current USD quotes. BigNumber comparison precedes display rounding; missing prices fail closed, while independently sufficient known amounts can qualify. The existing Futures writer can swallow a failed Trade persistence; the service includes all persisted fills and does not claim to recover missing history. Full contract/caveats: `docs/CRYPTO_CARD_PRODUCT.md`.
- Additive Prisma migration creates CardApplication/product/status enums, unique account request, audit evidence and maker/taker query indexes. Submission rechecks account/history inside Serializable, retries conflicts, retains original request ID/product/time on replay. Only real saved SUBMITTED is displayed, never issued/activated/shipped. Legacy interest timestamps remain intact, legacy GET is read-only and legacy POST returns 410; no backfill, real account/customer-data modification or database migration was performed.
- Frontend `CardApplication`/state replaces the obsolete waitlist component/controller (recoverable in Git). A/F → actual verification route; B → deposit/trading routes; C/D/E → submit; missing data/error → honest unavailable/retry; saved request → actual server product/ID/time. Pending duplicate submits are disabled and uncertain POST outcomes refresh the server state. Review-only mode performs no account/API calls. Removed unsupported freeze/limit-setting/transaction-alert capability claims; controls describe verification, selection and request status.
- Approved master hashes remain unchanged: Black `494de1377e5fb5ae1108398a1788cd6b98981215b6315edc4aea0cc54f4a3ad1`, Titanium `b4d69e2b18dd4459127ecedcd21876a569275bc83e9878a54466dfc6737195f8`. Every /card face uses these same PNGs; hero/final reuse phone-only masks plus scaled/tilted masters, comparison is unoverlapped. No image generation, pixel rewriting or Homepage/registration visual changes. Asset composition provenance updated in `docs/CRYPTO_CARD_ASSETS.md`.
- Product validation before shared-history integration: frontend/backend TypeScript passed; 10 suites / 148 tests passed (37 frontend including review isolation, 111 backend including credited deposits, Spot/Futures and quotes); Prisma schema validation passed with inert local URL placeholders and no DB connection. Production build passed (5633 modules); review build passed (5595 modules); pre-existing >500 kB chunk warning remains. No check disabled.
- Browser QA uses the real isolated /card on port4178: 1920/1440/1366/1280/1024/768/430/390/375, stable viewport measurements after settling, no page-level overflow or over-wide headings in the final bundle. Full master images visible in stacked/mobile and side-by-side comparison; hero/benefits, POS/ATM, subscriptions, currency section, eligibility, fees, FAQ and final application composition inspected. Conditions use 14–16+ px body text. Mobile menu open/close/anchor navigation, FAQ expansion and English/Russian switching verified. Existing review warning retained as environment safety, not product-unavailability wording.
- Separate local UI fixture harness at port4180 mounted the real CardApplication with visibly labelled API test doubles (outside repository, real network blocked). A–F decisions, unavailable prices, pending/duplicate protection, saved-response ID after refresh and lost-POST-response recovery verified. These are UI fixture checks, not live DB persistence evidence.
- Promotion target is ONLY existing frontend-only Render `voltex-review` (`srv-dadf50id0e5s73dplnpg`) on `claude/review-ready`, https://voltex-review.onrender.com/card. It intentionally cannot run backend/account application flow. No Render config/env/domain change, backend deployment, DB migration, main merge/push or production deployment. Live review status must be verified after the push; a frontend deploy is not evidence of backend rollout.
- Post-integration verification on merge `c75fcdb469d109690d02ee1e86793fbf49aea4b4`: full backend TypeScript passed; 17 suites / 199 tests passed, including the preserved review's synthetic engine/inception/win-rate/distribution/catalogue regressions. Production build passed (5636 modules), isolated review build passed (5598 modules), existing chunk-size advisory only. Copy Trading sources/assets are byte-identical to `179b513` (`git diff --quiet` exit0); Home/Auth/Wallet/Nav/Footer/Render files have no diff against that review. Final integrated /card smoke at1440 confirmed both products, exact copy, disabled review-only application, no page/headline overflow and the new review bundle. /card emitted no runtime errors or warnings; only two React Router v7 advisory warnings came from the separate development-only port4180 fixture bundle.
- Final responsive document client/scroll widths matched at all requested settings: 1920→1910/1910, 1440→1430/1430, 1366→1356/1356, 1280→1270/1270, 1024→1014/1014, 768→758/758, 430→420/420, 390→380/380, 375→365/365 (10px browser scrollbar). Initial immediately-after-resize snapshots were stale; only settled viewport measurements were accepted. Final hero scale verified at1920 (84px) and1024 (57.344px), both without word overflow. Database persistence remains covered by Prisma-backed service code with mocked DB tests, not an applied-migration/live-database E2E test.

## 2026-09-05 — Codex — coherent synthetic ALL history and profile footer

- Starting current review `775541770d8c2f5880f0248b085607080f834d05`; short-lived `codex/copytrading-history-footer`; implementation `a12d0ec3d6cbe0f4d7cbf30cc2dcae9e7b8a56df`. Explicitly fetched review before editing/promotion; Render confirms `claude/review-ready` on existing frontend-only `voltex-review` service.
- Observed live review had 380 days, not93. v4's +841%90D/+3727%ALL anchors concentrated91.77% lifetime PnL in90days; a wide scrolling daily strip further hid most ALL dates. Backend legacy JSON under `nazara-v1` can indeed remain stale, but this review service has no Prisma/backend and no real93dayDBrow was queried.
- Engine/config/types now v6: one additive lifetime budget, seeded irregular regimes/losses, no independent rolling anchors or final balancing spike. Preserved primary+3727% and earlier owner-approved4,711,027USDT by deriving126,402.6563USDT synthetic opening. 380days from2025-08-21; rolling7/30/90=2.048/8.551/26.664%; winrate97.2%; maxday25,804.3505USDT(0.547744%ALL), final7=2.060909%ALL. Exact trade/daily/equity-delta equality in0.0001USDT units. Reused the intent of the separately pending v5 work, not its changedROI or dirtyfiles.
- Review build uses pinned `reviewSyntheticHistory.ts` baseline with explicit `nazara-review-v6` manifest metadata, appending elapsed days across future builds. Prisma store adds only explicit review namespace selection; default existing API caller stayslegacy. Tests prove new review row initializes without falling back to/deleting/overwriting old93dayJSON and survives advance/reload. No live DB migration performed; review is still a build-time synthetic snapshot, not a running backend.
- UI changes limited to Daily PnL x-spacing/minwidth (one unchanged-valued daily bar, linear y) plus sharedFooter social removal and scoped profile-footer theme/gutters/mobilebottomclearance. Original Logo/Nav untouched; Performance ALLROI already correctly matched chartreadout and was preserved. Legal links/warning/copyright retained. No marketplace/profile redesign or otherCopyfeatures removed.
- Material files: synthetic engine/config/types, PrismaSyntheticStateStore, newreviewhistory helper, isolatedVite reviewconfig; DailyPnl helper/components/CSS; sharedFooter; four updatedengine tests and new review/namespace/footer tests. Full evidence and metrics: `docs/COPY_HISTORY_REVIEW.md`.
- Validation: backend/frontendTypeScript PASS;11relevantJest suites/67testsPASS, finalfooter4/4PASS. Productionbuild5636modules and reviewbuild5598PASS (existingchunksizeadvisory). Browser8widths1920/1440/1366/1024/768/430/390/375: no documentoverflow,380bars, matchingALLROI/PnL, readablefulllogo,nosocial; periods/ROI-PnL/historyverified. Mobilebottomnav occlusion fixed through footerpadding only. No newruntime errors (oldport4180Cardfixture routerwarnings separate).
- Preserved all newer Claude/Card work, defaultPrismastatepolicy, auth/permissions, realledger/balances/deposits/withdrawals/matching/Futures/Wallet, marketplace, followers/AUM and eligibility. Otherdirtyworktree v5/Nav/icon/50pagework remains intact and unmerged. Main remainsremote`ced48a598c64269880ed00fca712ce1c148298de`; main/production/Renderconfig/env/domains/DB untouched. Delivery target ONLY https://voltex-review.onrender.com/copy-trading; verifyactualRenderSHA and page afterpush, not merelylocalbuild.

## 2026-09-05 — Codex — premium Spot terminal and execution integration

- Base: freshly fetched review `2d1329c67ccac2f38c8b43c3b1fa151c3abf8141`, which contains current shared integration `32f7bbe`; isolated branch `codex/trade-terminal-premium`, implementation `cc4a56f0b631ca72f6059be8bb97b421291e7243`. Owner delivery target is existing `claude/review-ready` / `voltex-review`, not main. Explicit review fetch and ls-remote repeated before promotion; remote review had not advanced.
- Read the supplied terminal Number 2 ZIP without copying its Next/React version, generated market data or inert controls. Reused current VOLTEX real components in its chart-first instrument-spine / single Flow Rail / compact dock direction. Added lifted graphite tiers, readable execution fields, restrained gold, precise tool states, keyboard market/command dialog and Standard/Chart focus/Flow presets. Best Bid / Best Ask exist only inside Flow Rail; the spine contains current price, actual 24h metrics, raw spread and observed depth within 0.5% of mid, explicitly not whole-market liquidity.
- Material files (17): components `OrderBookPanel.tsx`, `OrderForm.tsx`, `PairListSidebar.tsx`, `PriceChart.tsx`; lib `api.ts`, new `terminalExecution.ts`, `terminalMarket.ts`, `reviewMarketData.ts`; new tests `terminalExecution.test.ts`, `terminalMarket.test.ts`, `reviewMarketData.test.ts`; `pages/TradePage.tsx`; new `pages/trade-terminal/MarketSpine.tsx`, `FlowContext.tsx`, `TerminalPremium.css`; `review/main.tsx`, `review/review.css`. This handoff is the only documentation change.
- Connected real form draft ENTRY / conditional execution / STOP / TAKE PROFIT / OCO stop-limit to read-only native chart price lines. Separate refs and cleanup preserve actual persisted-order trigger dragging, drawings and real placeOrder/placeOcoOrder payloads. Book hover/keyboard focus projects a guide, and row click fills the real limit form; tab changes preserve draft state. OCO remains the app's actual two-leg order, not an invented bracket order. Futures default PriceChart appearance, default PairList formatter and default detailed OrderForm remain unchanged; premium/compact/precision are opt-in from Spot.
- Actual raw book is the shared source of bid, ask, spread and observed liquidity. Magnitude-aware grouping floors bids/ceils asks and preserves volume; tiny-token prices/spreads retain precision, while EUR/crypto quotes have no false USD approximation. Watchdog resumes REST if a socket drops after connecting; version/pair guards reject late replies, tape fallback recovers, and spine quote reads are serialized. Existing connection warning is retained, not hidden.
- Review-only adapter permits six fixed-origin public Kraken GET shapes, credentials omitted, private endpoints/mutations rejected, bounded timeout/cache/deduplication and native USD/USDT distinction. Single-pair 24h percentage uses the real completed 5-minute candle at/before the 24-hour boundary (less than 5-minute reference lag); unavailable history gives unavailable percentage. Broad ticker list preserves the existing UTC-open percentage convention without thousands of per-pair OHLC requests. No generated financial data was imported. Trade's compact review notice explains public data and disabled account operations; other review safety notices remain unchanged.
- Validation: frontend TypeScript and backend `tsc --noEmit` PASS. Final 12 relevant Jest suites / 186 tests PASS (market/order APIs, order service/recovery, conditional watcher, Kraken, pair favourites, draft/group/precision, review allowlist). Expected negative-path logs in existing tests are not application errors. Final production build 5640 modules PASS; isolated review build 5604 modules PASS. Existing >500 kB chunk advisory remains; no check disabled. Staged diff check PASS.
- Browser: actual local built `/trade` on port 4178; 1920/1440/1366/1280/1024/768/430/390/375 measured with no document horizontal overflow or out-of-bounds execution controls. Mobile chart remains 380px tall, tablet 480px, rail stacks; desktop uses 360/400px execution rail and 208/176px dock. Inspected desktop/mobile, real candles/line/RSI, interval changes, drawing-menu and placed horizontal drawing, ENTRY/STOP/TP/OCO guide screenshots, keyboard book guide, click-to-price/total, Sell/order families, grouping, depth/tape, market search/EUR filter/sorting/favourite, pair change, command/workspace and dock tabs. IAB stalled on the existing native delete-drawings confirmation; recovered in one fresh tab and closed the stalled local tab, without changing that existing confirmation implementation. No JavaScript errors recorded; inherited extreme-change diagnostic warnings for one real market were separate from runtime failures.
- Safety: account balances and review fees remain unavailable, and real submission/percent allocation are disabled in this frontend-only review. Real financial execution was not performed or claimed; backend behavior remains covered by tests. No Auth, Wallet, Copy Trading, Card, Home, Futures, matching engine, Prisma, Render configuration/env/domain, production service or main changes. Other worktrees remain untouched. Main audit SHA is `ced48a598c64269880ed00fca712ce1c148298de`.
- Promotion uses the existing auto-deploy only, with no force-push or infrastructure change. Owner review URL: https://voltex-review.onrender.com/trade. This entry records pre-push QA; completion requires verifying the final pushed SHA in Render as live, HTTP 200, browser rendering and service error logs, not just the local build.
