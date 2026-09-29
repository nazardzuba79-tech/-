# VOLTEX mobile clients — local owner review

This integrates the isolated PWA and Telegram Mini App review from PR #311 onto the current VOLTEX source (base `c237649ccd93e74c68013c861ab9cbd38af56726`). It does not launch them. The ordinary production entry, routes, authentication, backend financial engine and deployment configuration remain unchanged.

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

The adapter consumes the official `window.Telegram.WebApp` SDK contract, handles ready/expand, stable viewport, finite safe area and content safe area, theme events and BackButton. The activity hook combines browser visibility/page lifecycle with Telegram `isActive`, `activated` and `deactivated`; one source cannot incorrectly override another inactive source. Only the chart unmounts while paused, so the unsent in-memory draft survives a temporary hide. BackButton returns from Trade/Account to Chart, then to Markets. Listener and style cleanup is explicit. The mock implements that same contract locally. Production SDK loading and launch URLs are deliberately absent.

No frontend Telegram user is trusted. The mock result is explicitly **unverified**, with no linked account. A real SDK launch cannot authenticate on this branch. `src/auth/telegramInitData.ts` is an unmounted server-only verifier: HMAC-SHA-256, constant-time comparison, unique fields, bounded size, timestamp freshness, signed numeric user ID. It reads no environment variable and has no DB or HTTP calls. Tests use a synthetic bot-token string.

Future linking flow: user signs into an existing VOLTEX account → server issues a short-lived single-use linking challenge bound to that session → server verifies raw initData using a server-held bot token → atomically consumes challenge/query ID → user explicitly confirms linking → store a unique Telegram-ID-to-existing-account relation. No automatic account creation; no session minted from frontend profile data; unlinking requires reauthentication. Replay storage, rate limits, CSRF/session binding and endpoint registration are release prerequisites, not claimed as active here. Current production auth is unchanged.

Protocol references: [Telegram Mini Apps / validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) and [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Hosting and environment

The existing product API contract already uses `VITE_API_URL`; there is no new Render or Neon assumption. `reviewDeployment` validates hosting-neutral `MOBILE_FRONTEND_ORIGIN`, `MOBILE_TELEGRAM_ORIGIN` and `MOBILE_API_BASE` descriptors. Defaults are loopback and `/api/v1`; review build rejects remote or credential-bearing values. These descriptors prepare the future deployment seam, but do not override the disabled transport in this build. Review Vite never reads the normal production env directory. `MOBILE_REVIEW_PORT` changes the local server port. Public staging activation requires a separate reviewed release config and explicit origin allowlist; changing an env variable cannot enable trading on this branch.

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

The dedicated `mobile-clients-review.yml` runs on relevant pull requests, relevant main pushes and explicit manual runs. Its paths include shared frontend source and build dependencies so a later chart or form change cannot silently leave the review bundle stale. Normal production workflows keep their own existing triggers and job conditions. The old PR's widespread branch-specific job bypasses were not transplanted.

The mobile job has a read-only token, no environments, production secrets, database service, release command or deploy hook. Dependency installation disables lifecycle scripts. `mobile-review-ci-safety.cjs` checks this dedicated workflow and rejects any reintroduction of the old branch quarantine in other workflows. `mobile-review-checks.cjs` forces dummy loopback test DB URLs and preloads a network denial boundary before unit/regression tests. The browser harness starts its own local static server, records external/API requests for every browser context and fails if one occurs. It does not start the backend.

Merging this source does not publish a PWA manifest or service worker: ordinary `npm run build --prefix frontend` emits only the regular product. No production service, Worker, Neon resource, Render hook, BotFather URL, Cloudflare route or environment variable is configured by these files. There is no branch-specific skip marker required for this integrated review; normal release checks remain enabled. Actual public clients require a separate reviewed build/launch configuration.

## Validation and evidence

```sh
node scripts/mobile-review-ci-safety.cjs
node scripts/mobile-review-checks.cjs
# Install Playwright in a disposable tooling directory, then point at its module:
MOBILE_REVIEW_PLAYWRIGHT=/path/to/playwright node scripts/qa-mobile-review.cjs
```

The browser harness checks 320, 360, 390, 430 px, mobile touch layout, Markets/Futures/Spot/Positions/Orders/Wallet/Copy, disabled ticket, offline state, safe-area/viewport/theme events, BackButton, untrusted identity, hidden/pagehide and Telegram inactivity, draft preservation, static cache contents, worker update preserving a typed draft and offline navigation. Screenshots and JSON evidence go to `output/mobile-review/`; GitHub CI retains them as an artifact. Icons can be regenerated from the existing SVG with `scripts/mobile-review-icons.cjs` using the same disposable Playwright module.

The original review had 188 passing tests in eight suites. Integration adds regression coverage for Telegram cleanup, finite insets, signed extension fields and the freshness boundary. Current validation and exact source identity are recorded in `docs/qa/mobile-review-20260929/README.md` after the integration runs; original counts are not presented as new verification. Ordinary frontend typecheck/build and the isolated bundle passed. Vite reports the existing large-chunk warning and, for the isolated bundle, font URLs emitted explicitly by the review plugin; the browser harness verifies these local files and the offline worker installation.

## Public launch prerequisites

| Item | Concrete remaining work | Current boundary |
|---|---|---|
| HTTPS origin | Select an isolated staging hostname and configure a dedicated build, CSP and exact origin allowlist. Existing static hosting can be evaluated; a new paid server is not a requirement of this client. | This bundle intentionally rejects every public origin. |
| Telegram bot | Identify the intended bot and configure its Mini App launch URL. The owner must supply the bot identity through the authorized account/secret mechanism. | No bot selected, no remote SDK loaded, no BotFather call; an existing notification bot/token is not reused implicitly. |
| Account identity | Implement the existing-account challenge/explicit confirmation flow above, with server verification, unique mapping, replay consumption, CSRF/session binding and rate limits. | Signature verification is pure and unmounted; no login, session, account creation or linking endpoint. |
| Real account views | Connect read-only account and market views to the existing providers on disposable staging, then measure actual traffic and stale/offline handling. | Fixtures and unknown account state; zero API traffic is not a prediction for live clients. |
| Financial execution | Review the existing execution-provider integration and verify server admission rules with disposable accounts before enabling action handlers. | There is no submit handler or account write path in this review. |
| Devices | Install and reopen the PWA on real iOS and Samsung browsers; launch in real Telegram on both; check keyboard, safe areas, BackButton, minimize/restore, offline and update behavior. | Chromium mobile viewport emulation only; no physical install or real Telegram launch is claimed. |

Official references checked for this integration: [Telegram WebApp SDK and lifecycle events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps), [Telegram server validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), and [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
