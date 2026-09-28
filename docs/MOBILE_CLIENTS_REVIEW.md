# VOLTEX mobile clients — local owner review

This branch prepares a PWA and Telegram Mini App using the same VOLTEX React source and API contracts. It does not launch them. The ordinary production entry, routes, authentication, backend financial engine and deployment configuration remain unchanged.

## Run the previews

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
npm run build --prefix frontend
cd frontend
node node_modules/vite/bin/vite.js build --config vite.mobile-review.config.ts
cd ..
node scripts/serve-mobile-review.cjs
```

- PWA: `http://127.0.0.1:4178/pwa`
- Telegram fixture: `http://127.0.0.1:4178/telegram?mock=1`
- Invalid Telegram fixture: `http://127.0.0.1:4178/telegram?mock=1&invalid=1`
- No SDK / no launch: `http://127.0.0.1:4178/telegram`

The server binds loopback only, rejects non-loopback Host values, has no proxy and rejects writes. Do not expose it through a tunnel. No production token, account or database is needed. A PWA on a physical phone and a real Telegram launch will require a separately approved staging origin later; Chromium mobile viewport emulation is the current evidence, not a physical-device claim.

## Architecture and reuse

`frontend/mobile-review.html` and `vite.mobile-review.config.ts` form an isolated entry and build output (`dist-mobile-review`). The ordinary `vite build` cannot ship its manifest, icons, entry or worker. No navigation item or production route enables the clients. The boot gate refuses public origins even if someone copies the review bundle elsewhere.

Both clients use `ReviewApp`, with Markets → asset → shared VOLTEX `TerminalChart` / `PriceChart` → order panel → Positions / Orders. Spot, Wallet and Copy Trading are reachable from mobile navigation. The chart uses the existing `ChartCandleLoader` seam with in-memory candles and an existing `MarketTicker` contract. The view reuses `FuturesMarginLeverage`, `OrderFamilyTabs`, `OrderFamilyFields`, `PercentSlider`, i18n, formatting, the terminal design CSS and the existing brand artwork. There is no new trading or financial calculation engine.

The order ticket is a presentation draft with no submission handler. Margin, balances, positions, orders, P&L and Copy Trading account data remain `—` / account-not-connected. Known synthetic market values are labelled as fixtures. Leverage is unavailable without authoritative account rules. Wallet actions are disabled. Future activation must connect these views to the existing account/authentication and execution providers after infrastructure and launch approval; this review intentionally does not simulate successful trades, balances, account linking or copy returns.

The shared chart uses its futures presentation namespace in both review terminals to avoid the ordinary Spot chart's authenticated conditional-order polling. Both use synthetic candles. This is a review-only adapter choice; the production Spot chart is untouched. Drawing tools and external TradingView embedding are not offered in the compact review chart.

## Financial and network boundaries

- The review installs a transport guard **before** importing shared components: fetch, XHR, WebSocket, EventSource and beacon cannot contact APIs.
- The built page also has CSP `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`. Its worker can fetch only from the same local origin.
- The financial gate requires active + online + authoritative + non-review state. This build always has review=true and authoritative=false. Enabling a button through browser developer tools cannot create a trade because there is no write handler.
- Account state is never persisted. The worker has an exact static build allowlist. APIs, wallet/private paths, query-bearing requests and non-GET methods never enter its cache. HTML navigation uses network-first, no-store and a fixed offline shell with no account data or trade controls.
- The worker is emitted only by the separate review build, and registration and worker handlers both require a loopback origin. Telegram alone does not register a worker.
- An update waits while the old client is open. No `skipWaiting`, `clients.claim`, forced reload or update interval exists. The user is told to finish the draft, close review windows and reopen. Drafts are not persisted or silently submitted.

## Telegram and account linking

The adapter consumes the official `window.Telegram.WebApp` SDK contract, handles ready/expand, stable viewport, safe area and content safe area, theme events and BackButton. Listener cleanup is explicit. The mock implements that same contract locally. Production SDK loading and launch URLs are deliberately absent.

No frontend Telegram user is trusted. The mock result is explicitly **unverified**, with no linked account. A real SDK launch cannot authenticate on this branch. `src/auth/telegramInitData.ts` is an unmounted server-only verifier: HMAC-SHA-256, constant-time comparison, unique fields, bounded size, timestamp freshness, signed numeric user ID. It reads no environment variable and has no DB or HTTP calls. Tests use a synthetic bot-token string.

Future linking flow: user signs into an existing VOLTEX account → server issues a short-lived single-use linking challenge bound to that session → server verifies raw initData using a server-held bot token → atomically consumes challenge/query ID → user explicitly confirms linking → store a unique Telegram-ID-to-existing-account relation. No automatic account creation; no session minted from frontend profile data; unlinking requires reauthentication. Replay storage, rate limits, CSRF/session binding and endpoint registration are release prerequisites, not claimed as active here. Current production auth is unchanged.

Protocol references: [Telegram Mini Apps / validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) and [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Hosting and environment

The existing product API contract already uses `VITE_API_URL`; there is no new Render or Neon assumption. `reviewDeployment` validates hosting-neutral `MOBILE_FRONTEND_ORIGIN`, `MOBILE_TELEGRAM_ORIGIN` and `MOBILE_API_BASE` descriptors. Defaults are loopback and `/api/v1`; review build rejects remote or credential-bearing values. These descriptors prepare the future deployment seam, but do not override the disabled transport in this build. Review Vite never reads the normal production env directory. `MOBILE_REVIEW_PORT` changes the local server port. Hetzner activation requires a separate reviewed release config and explicit origin allowlist; changing an env variable cannot enable trading on this branch.

## Resource budget

All figures below are **additional** traffic from these clients in this branch.

| Client / state | API requests/min | DB queries/min | Behavior |
|---|---:|---:|---|
| Feature exists, no client open | 0 | 0 | No server registration, timer, job or worker deployment |
| Hidden / pagehide / closed Mini App or PWA | 0 | 0 | Chart unmounts, existing timers/controllers clean up |
| Active Markets | 0 | 0 | In-memory ticker fixtures |
| Active Futures / Spot chart | 0 | 0 | Existing chart calls local candle loader at up to 12 reads/min; no HTTP |
| Active order draft | 0 | 0 | Local form state; writes locked |
| Positions / Orders / Wallet / Copy | 0 | 0 | Explicit unavailable account state |

First PWA install downloads local immutable JS/CSS/fonts/icons once; navigation and normal browser install/update checks are local static traffic, not Render requests. There is no heartbeat, cron, background sync, push, webhook, keepalive or application update polling.

For a future authorized online release: initial screen entry should issue only required existing read contracts; market subscriptions belong only to an active chart, and account reads share existing stores. An order would use the existing explicit user-driven write and revalidation path. Hidden/unmounted views must cancel/stop those subscriptions. Exact live per-screen request/DB budgets must be measured on disposable staging after the existing stores are connected; the zero API numbers above describe the current fixture implementation and are not a forecast of live trading.

## CI safety

Every pre-existing workflow job excludes `codex/mobile-clients-review` by both PR head ref and push/manual ref. Existing job conditions remain conjuncts. This is a deliberate temporary branch-specific quarantine: broad frontend paths would otherwise start legacy browser/integration/release workflows. It does not change behavior on main or other branches. Do not rename the branch without updating and testing both guards.

The only runnable job for this branch is `mobile-clients-review.yml`: read-only token, no environments, production secrets, DATABASE_URL secret, DB service, release command or deploy hook. Dependency installation disables lifecycle scripts. `mobile-review-ci-safety.cjs` parses all workflow YAML and checks the isolation contract. `mobile-review-checks.cjs` forces dummy loopback test DB URLs and preloads a network denial boundary before unit/regression tests. The browser harness starts its own local static server, records any external/API requests and fails if one occurs. It does not start the backend.

No production service, Worker, Neon resource, Render hook, BotFather URL, Cloudflare route or environment variable has been changed by this work. Publication uses a `[CF-Pages-Skip]` commit prefix and `[skip render]` in both commit message and PR title. These are documented [Cloudflare Pages build skips](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) and [Render deployment/preview skips](https://render.com/docs/service-previews#skipping-a-preview). Repository-side CI guards do not configure third-party integrations. Keep these markers on every follow-up commit and keep the PR's skip marker until separately approved for release.

## Validation and evidence

```sh
node scripts/mobile-review-ci-safety.cjs
node scripts/mobile-review-checks.cjs
# Install Playwright in a disposable tooling directory, then point at its module:
MOBILE_REVIEW_PLAYWRIGHT=/path/to/playwright node scripts/qa-mobile-review.cjs
```

The browser harness checks 320, 360, 390, 430 px, mobile touch layout, all initial sections, disabled ticket, offline state, safe-area/viewport/theme events, BackButton, untrusted identity, hidden/pagehide teardown, static cache contents, worker update preserving a typed draft and offline navigation. Screenshots and JSON evidence go to `output/mobile-review/`; GitHub CI retains them as an artifact. Icons can be regenerated from the existing SVG with `scripts/mobile-review-icons.cjs` using the same disposable Playwright module.

Local verification: 188 tests passed in 8 suites, including existing Futures order/terminal, Spot order presentation, mobile parity and chart regressions. The final rerun and exact commit/PR are recorded in the owner handoff. Ordinary frontend typecheck/build and the isolated bundle passed. Vite reports the existing large-chunk warning and, for the isolated bundle, font URLs emitted explicitly by the review plugin; the browser harness verifies these local files and the offline worker installation.

Remaining launch prerequisites: owner approval, Hetzner/disposable staging setup, real Telegram SDK launch on an approved HTTPS origin, real iOS/Samsung device install checks, existing-account linking endpoint with replay protection, and a separate security review before financial execution is enabled. None of these are activated by this PR.
