# TERYVANE (TYVN/USDT) — production finish plan, 27 October 2026

STATUS: API candidate prepared; NOT DEPLOYED. TYVN NOT PUBLISHED. TIMER OFF. NO BALANCES TOUCHED.

## Immutable listing specification

- Name TERYVANE; pair TYVN/USDT; start 2026-10-27 13:00 UTC = 15:00 Kyiv (winter time) = 16:00 Moscow.
- Initial price 0.0250 USDT; emission 100,000,000 TYVN (documentation, not minted or credited).
- Seed teryvane-20261026-v1, movement FREQUENT_PULLBACKS: first day target 0.45625 USDT; absolute cap 2.33675 USDT; then range.
- Demo trading flag false. No executable Spot orders before OR after listing. No fake fills/credits or owner allocations.
- Frontend countdown is server-time driven; no auto-publication or auto-start.

## Current verified infrastructure

- Public Cloudflare market-edge: v10; new Worker from isolated release branch 8cbbb73788b916eabaf0b9e1eaa12bce578ea162 (live-smoke PASS).
- Worker Durable Object listings secret accepts only server authorization. AITH (previously version 3) remains a publicly readable pair; NRX still serves data.
- Last verified live Hetzner API fingerprint 2e7acf158000404133db85723bac13695215e25c. This API predates new timer routes.
- TYVN absent from public catalogue; direct pair read 404. AITH exists. Thus creating the draft is a SEPARATE action from preparing code.
- Narrow TYVN backend candidate is Draft PR #578 at https://github.com/nazardzuba79-tech/-/pull/578, based EXACTLY on live backend 2e7acf1 (not current main).
- A code merge into GitHub main does not deploy the Hetzner API.

## Mandatory gates before server switch

1. Confirm exact reviewed PR #578 HEAD, green isolated backend QA plus green listings browser CI. Do not use an older SHA. GitHub runner pinned to Ubuntu 24.04 for older Playwright.
2. In Hetzner Cloud Console run scripts/tyvn-hetzner-preflight.sh (read-only); require exact live/local 2e7acf1 SHA, one running api-production Docker container, PostgreSQL ready, active backup timer, >=5GiB free.
3. Obtain the actual running API IMAGE ID with docker inspect. Verify rollback image remains present and that source package.json/lock, tsconfig and bootstrap have not changed relative to 2e7acf1.
4. Verify a fresh, restorable backup according to docs/KYC_RELEASE_RUNBOOK.md; no TYVN database migration is needed or approved. Do not execute Prisma migrate, reset, seed or restore.
5. Prepare a git archive from exact reviewed candidate SHA: src, tsconfig.json and scripts/tyvn-hetzner.Dockerfile only. Do not include .env, production secrets or a dirty checkout.
6. Build an INACTIVE Docker image offline from the ACTUAL current immutable image ID, not from a guessed old KYC base image.
7. Prepare a Compose overlay for ONLY api-production.image and api-production.environment.VOLTEX_RELEASE_SHA. Compare sanitized effective Compose config with the running configuration: all other fields/ports/mounts/dependencies/DB settings must be identical; do not print environment variable values.
8. Switch only api-production with the approved compose overlay AFTER explicit final deployment approval, in an operator-controlled maintenance window. Keep the old image/overlay as immediate rollback.
9. Require /health revision == exact approved SHA. Without authentication Admin Listings must return 401. With authorized owner admin verify read-only listings and preview. AITH and NRX quotes/candles must be unchanged, normal Spot/Futures/Wallet smoke must work.

## Source archive and offline build (after explicit operator approval)

Run in a verified Git checkout and transfer resulting tar through the existing secured operator process:

    RELEASE_SHA=<exact-reviewed-PR578-head>
    git diff --exit-code 2e7acf158000404133db85723bac13695215e25c "$RELEASE_SHA" -- package.json package-lock.json prisma scripts/start-render-single-service.cjs render.yaml
    git archive --format=tar -o tyvn-api-source.tar "$RELEASE_SHA" src tsconfig.json scripts/tyvn-hetzner.Dockerfile

On the Hetzner server, after inspecting actual current image ID and extracting this archive into a NEW release directory:

    docker build --network none --pull=false --build-arg LIVE_IMAGE="sha256:<ACTUAL-IMAGE-ID>" --build-arg RELEASE_COMMIT="$RELEASE_SHA" -f scripts/tyvn-hetzner.Dockerfile -t "voltex-tyvn:$RELEASE_SHA" .
    docker image inspect "voltex-tyvn:$RELEASE_SHA" --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'

Do not build from an unverified image; do not run the new API image until the effective Compose configuration and rollback plan are checked. If TypeScript compiler or current dependencies are absent in the runtime base, STOP: do not download packages into production to force this recipe.

## After API release: owner-controlled TYVN creation and timer

1. Admin > Listings > Create listing from config/test-markets/tyvn.draft.json, with 27.10.2026 16:00 in Moscow zone, 0.0250, manual seed teryvane-20261026-v1, Spot trading OFF. Keep owner allocation as a parameter ONLY.
2. Save DRAFT; verify private chart preview, initial 0.0250, 24h target 0.45625, cap 2.33675; check 1440 and 390 widths. Check ticker uniqueness, no production duplicate.
3. On separate publication approval, Publish with 'Start timer after publication' UNCHECKED (staged). Confirm TYVN remains invisible at /market/listings, not available for orders, and AITH is unchanged.
4. Only on separate timer-start approval, press Start Timer before the set instant. Verify public countdown at 13:00 UTC / 15:00 Kyiv / 16:00 Moscow; no executions.
5. At listing instant, verify chart/candle transition to live. Demo remains tradable:false and neither BUY nor SELL places real/fake orders. No owner allocation, balance credit, or registry override.
6. If start time has passed before timer was armed, DO NOT force late start: move the date in admin after explicit owner approval, republish and verify.

## Rollback and forbidden operations

- Rollback API by the exact previously captured Docker image / Compose set without resetting or restoring the DB. Check /health reverts to 2e7acf1.
- Do NOT rollback the Worker or overwrite the listings Durable Object merely to undo an API release; existing AITH and NRX live data must remain intact.
- Do NOT transfer secrets through Git, stdout, chat or build logs. Do not alter PostgreSQL schema, real Spot matching, futures accounts, tokens or balances.
- In case of mismatch, wrong SHA, incomplete backup, missing store integration, failed browser scenario or unknown behavior: STOP before any further production mutation.

Verification evidence: PR #562 timer implementation and Draft #578 isolated API candidate; GitHub Actions run #39770039323 showed build and 93/93 targeted tests PASS. Require exact new-head green after QA/runner corrections.
