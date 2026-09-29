# Managed Listings review — 2026-09-29

Base: `e17aa533f7848dbced32f732d70645e482e68e57`. Review only: no merge, deployment, production resources, allocations or trades.

## Implemented

Admin Listings mounts in the existing admin layout. Create validates name, ticker/pair uniqueness against the venue registry and factory, raster logo, positive price, future UTC date, nonnegative exact allocation and automatic/manual seed. Seed and ticker are frozen on Create. Unsaved edits must be saved before Preview. Preview renders three future hours from the saved revision without publishing or crediting balances.

An independent Cloudflare SQLite Durable Object owns the canonical config. Draft reads require the backend's private bearer secret; backend routes require authenticated ADMIN, including existing revoked-session/2FA checks. Public endpoints select published rows only, ignore clock/role/draft URL overrides, and omit allocation, seed and administrator identifiers. CAS revisions and a transaction make Publish atomic; replay of its original key/revision returns the same published config. Published config is immutable. The worker has no Neon access or background generator.

The unchanged TestMarketSimulation algorithm serves metadata, authoritative server time, countdown/live transition, candles, depth and tape. Cache identity includes immutable config and preview revision. New identities load before terminal subscriptions; opening a factory market from Markets performs a document navigation to bootstrap the current directory. Legacy VTA/NRX keep their existing routing/config/seed/accounting. Several future listings coexist.

New factory markets are **market simulations for viewing, not new executable Spot instruments**. The ordinary order form remains; generic Spot, OCO and demo execution reject factory identities authoritatively. This task does not introduce a matching engine, create fills or mint USDT.

Owner allocation is a separate explicit command, default disabled. It targets only the ADMIN who created that listing. A PostgreSQL advisory transaction lock, exact decimal balance increment and immutable receipt identity make retries safe, including after the credited balance has subsequently changed. Audit failure rolls the balance back. Create/Preview/Publish never call this accounting path.

## Local evidence

- Backend and frontend TypeScript: PASS.
- Targeted Jest: 203 PASS / 12 suites (admin auth/routing/transport/execution refusal, OrderService, DemoTrading, legacy VTA/NRX simulation/depth/public API, Spot public reads, Copy CI coverage, CFD mounted terminal and unchanged Futures API fingerprint).
- Actual disposable PostgreSQL: 3 PASS (concurrent exact credit once, unchanged USDT/other accounts, refusals, atomic receipt rollback).
- Actual workerd + persistent SQLite: 8 PASS (validation, private drafts, stable seed, concurrent edit, idempotent atomic publish, restart, multiple listings and server-time live transition).
- Mounted production-build browser acceptance: PASS at **1440×1000 and 390×844** in headless Edge. `QATHIRD` and `QAFOURTH` are supplied through Admin, never added to runtime code. No rebuild occurs between Create/Publish and market entry. Checks cover preview, draft privacy, Markets entry, countdown, automatic chart/book/tape, reload and an independent USER browser. Zero financial writes and zero worker outbound I/O. See `browser-results.json` and screenshots.
- Worker staging dry-run: PASS, 194.78 KiB / 40.53 KiB gzip. No deploy.
- Frontend production build: PASS; existing large-chunk warning remains (~508 kB entry with factory enabled).

Browser tests mock unrelated identity/account/venue reads and deny external traffic; the new Admin adapter and Cloudflare SQLite implementation are real. The disconnected legacy feed banner in terminal screenshots reflects those network fixtures. These are not production screenshots or evidence of production allocation.

## Required before production (not performed)

1. Deploy a **new** worker using `workers/managed-listings/wrangler.toml` and its `ManagedListingsDO` SQLite migration. Staging and production have distinct worker identities/storage. Do not bind Deposit Catalogue or reuse `market-edge` storage/routes.
2. Set an independent random `LISTINGS_STORE_TOKEN` (at least 32 characters) as a Worker secret and matching backend secret. Set backend `LISTINGS_STORE_URL` to that worker's HTTPS origin. Never put the token in a `VITE_*` variable.
3. Set frontend `VITE_MANAGED_LISTINGS_URL` to the public worker origin for one approved initial frontend deployment. Future Create/Preview/Publish operations need no code change or deploy.
4. Keep `MANAGED_LISTINGS_ALLOCATION_ENABLED` unset until separately authorized. A later explicit allocation request uses `managed-listing:<id>:allocation:v1`, confirmation and published revision. No automatic seed/migration/startup allocation exists.
5. Verify actual Cloudflare quota/CPU budget, production authentication/CORS, observability and rollback before release. Registry capacity is 50 listings; request/logos and history windows are bounded. When factory config is enabled, account-order validation makes a private registry lookup and fails closed if unavailable. Public market reads go browser → Cloudflare, never Render → Neon polling. Initial registry loading is an additional availability dependency of Markets/Spot; missing frontend configuration leaves the factory disabled.

## Not verified here

Production hosting/configuration, real-account allocations, production traffic/latency and long-lived high-volume Cloudflare load. No production balances, VTA/NRX allocation, seeds, dates, historical simulation source or financial math were changed. Full historical multi-hour QA was not repeated; existing focused CI provides additional regression coverage.
