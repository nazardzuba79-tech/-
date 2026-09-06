# Selective Crypto Card production promotion — 2026-09-06

## Scope and provenance

- Owner explicitly authorized production promotion of the already reviewed product, not a redesign.
- Production base: `cb29b7f1afce7fb17cf68462573949166933640e`.
- Reviewed source: `0a9c9022b8cf0cac757328606eaf9c7b52fa3a86` (`claude/review-ready`).
- Isolated branch: `codex/crypto-card-production`, created from production main.
- Remote refs were explicitly fetched with `+refs/heads/*:refs/remotes/origin/*`; this clone's normal fetch configuration only refreshes codex-test.
- Exact reviewed `CardPage`, 30 page-local files, dedicated prefixed Tailwind configuration and 15 self-hosted assets. Three pinned reviewed runtime dependencies only; existing build scripts retained.
- API client changes are limited to the CardApplication types and GET/POST methods. The seven obsolete `card.*` translation namespaces are removed; current Copy/Home/Auth and other translations remain unchanged.
- Home card components are identical in main and review and require no changes. They are intentionally not promoted or redesigned.
- Existing production App route/auth, global DEMO/PRE-LAUNCH notice, Nav, Footer, Copy Trading, Trade, Futures, Wallet, Analytics, Arbitrage, Admin, pricing source, Dockerfiles, nginx and Render settings remain unchanged.

## Product and application contract

Titanium: Visa, cashback up to 10–15%, $50,000/month. Black Signature: Mastercard, up to 15–20%, $1,000,000/month. Both issuance/service zero; selected-subscription compensation up to 100%.

The exact reviewed backend requires `APPROVED && (creditedDepositUsd >= 5000 || persistedExecutedVolumeUsd >= 50000)`. BigNumber comparisons precede display rounding. Existing WalletPortfolioService quote injection is reused, not wallet presentation holdings. Same-product requests are idempotent; another product conflicts. Authentication, strict body validation, no-store, serializable retry, unique account request, eligibility snapshot and atomic AuditLog are preserved. SUBMITTED means a recorded application, never issuance, activation, funding or shipment. See [the reviewed contract](CRYPTO_CARD_PRODUCT.md) for valuation caveats.

Legacy interest timestamps remain unchanged, legacy GET is read-only, and legacy POST returns 410. There is no backfill.

## Migration safety

The sole new migration is the reviewed `20260905193000_card_applications`: two enums, one new table, its unique index/FK, and two maker/taker indexes on Trade. No DML, table recreation or modifications of existing User/Balance/Deposit/Withdrawal/Order/Trade/Copy records.

Production preflight used the existing production exchange-api DIRECT_URL, never review credentials. Neon target/database identity, verified TLS, default read-only and repeatable-read transaction were asserted; the transaction ended with ROLLBACK. Redacted count/checksum evidence is kept outside Git.

At 2026-09-06T14:35:44Z: 11 Users, 0 Trades, 24 completed migrations, no unfinished migration and no Card table/type/index/constraint collisions. Both Copy scenario rows and canonical seed hashes were recorded. Trade is empty, so the additive index creation does not scan a populated execution ledger. All existing financial-table aggregate fingerprints are retained for post-deploy comparison. No production records were written during preflight.

## Validation and rollout evidence

- Backend TypeScript noEmit and production compile: PASS.
- Frontend TypeScript and normal Vite production build: PASS, 5634 modules. Existing >500 kB chunk advisory remains; no dependency upgrade or code splitting outside this task.
- Prisma generate and validate: PASS; validation used inert localhost URLs and made no database connection.
- Full configured Jest: 99 suites / 996 tests PASS, including backend Card eligibility/auth/persistence semantics, Copy canonical/future-history regressions and frontend suites.
- Card backend subset: 2 suites / 47 tests; Card frontend subset: 4 suites / 41 tests. All available frontend suites: 17 / 136.
- Asset preservation tests cover all 15 assets and exact reviewed source bytes after newline normalization. Protected-current-main fingerprints cover 38 unrelated production sources.
- Unchanged Copy candidate nginx/browser regression: all 9 requested widths PASS; both canonical response hashes unchanged; all periods, actual percentage bars, recent trades, identity, Favorites/search, F5 and deposit-only eligibility pass.
- Actual SQL integration: 15 checks PASS using the unchanged compiled CardApplicationService and generated Prisma over a local PGlite PostgreSQL 18.3 TCP socket. All 24 historical migrations plus exact Card migration applied; seeded account/financial/Copy fingerprints stayed unchanged. Real SQL unique/FK constraints, AuditLog failure rollback, stored snapshot, disconnect/reconnect persistence, same-product replay and different-product conflict passed. This is isolated WASM PostgreSQL with one connection, not a production write or a multi-connection concurrency test. The separate HTTP fixture and Jest suites cover concurrent-request/retry behavior.
- Card candidate browser: PASS at 1920/1440/1366/1280/1024/768/430/390/375, using the normal build through nginx and the real compiled Card router/service/auth with isolated local account/SQL adapters. All 12 sections, all 15 served asset hashes/MIMEs, both products, the A–I eligibility matrix, duplicate requests/clicks, F5/persistence and product conflict passed. All seven languages passed at 1440/390, including real RU-to-EN navigation switching. No horizontal overflow, broken images or browser JS/console errors. Evidence: local `node_modules/.cache/qa-card/result.json` and screenshots.
- Independent selective-scope audit passed for every candidate source/asset/migration and shared hunk. No review-only entry, newer Spot, Wallet or unrelated product changes were imported.
- Production rollout results are recorded separately only after execution. This document alone is not a claim that deployment has occurred.

## Approved master integrity

- Titanium PNG: `b4d69e2b18dd4459127ecedcd21876a569275bc83e9878a54466dfc6737195f8`.
- Black Signature PNG: `494de1377e5fb5ae1108398a1788cd6b98981215b6315edc4aea0cc54f4a3ad1`.
- Both 1580×996 original masters, exact reviewed PNG/WebP files and existing phone/photo composition retained. No image generation, pixel editing or old CardFace restoration.

## Rollout boundary

Only the validated selective candidate may fast-forward main. Existing voltex-exchange and exchange-api auto-deploy from main; no duplicate manual deployment, configuration, environment, domain or review-service/database changes. Runtime migration uses the existing backend startup workflow. Completion requires both services LIVE at the promoted SHA, post-migration read-only safety comparison and actual authenticated live /card/direct-load/F5/mobile/asset checks.

Live financial qualification must not be manufactured by creating deposits/trades or changing balances. Eligible submission is validated with isolated fixtures/SQL tests when the existing production account is not qualified. Production read-only gating remains authoritative.
