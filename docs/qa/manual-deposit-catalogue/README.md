# Manual deposit catalogue — review evidence

Base: `9511ce037993d65fa375da6a4bc5d1c5675922ad` (fresh `origin/main`).
Branch: `codex/manual-deposit-catalogue`.

## Scope and activation blocker

This is the explicitly permitted adapter + synthetic-test delivery. No suitable
persistent Cloudflare store is wired in the repository. No infrastructure was
provisioned. Production activation is blocked pending the configuration and
verified legacy-address snapshot described in
[the storage runbook](../../manual-deposit-catalogue.md).

The new frontend mode is opt-in; ordinary deployments keep the existing
TreasuryWallet-based flow. The unconfigured new backend fails closed (503).
Tests use an in-memory store only, never production addresses or accounts.
Initial fixture: **3 configured assets, 4 asset/network entries, 3 networks**:
BTC/Bitcoin, ETH/Ethereum, USDT/Ethereum and USDT/TRON. This is not a production
inventory; the live configured count was not independently queried.

TOP-20 resolution uses existing CoinGecko market-cap ranks and stable asset IDs.
Browser screenshots use a synthetic ranking. Saved assets survive ranking changes;
unmapped new ranked assets are unconfigured, and VTA is excluded.

## Verification

- **147 tests PASS, 0 FAIL, 9 suites PASS**, including 31 new catalogue tests.
- Backend and frontend TypeScript checks: PASS.
- Backend build: PASS.
- Frontend builds with the feature enabled and disabled: PASS. Vite reports its
  bundle-size advisory for a chunk over 500 kB; this is not a build failure.
- Real frontend + real catalogue routes/service + mock persistence browser QA:
  **9 scenarios PASS**, no page errors, no horizontal overflow at **1440 and 390 px**.
- Add, reload, edit, disable, clear, multi-network selection, memo/address clipboard,
  existing BTC/ETH/USDT resolution, and reopened configuration refresh verified.
- Server tests cover real authorization middleware with mocked user/session reads,
  non-admin/customer rejection, validation, cache/ETag, concurrent CAS, and failures.
- Source guards verify no catalogue Prisma migration, watcher, financial-service
  calls, transaction submission or automatic credit path.

See [browser-results.json](browser-results.json) and
[tests-summary.json](tests-summary.json). Reproduce through
`.github/workflows/deposit-catalogue.yml` and `scripts/qa-deposit-catalogue.cjs`.

## Measured load

Counts are API requests, excluding static files, in isolated synthetic browser QA.

| Action | Whole-page API requests | Catalogue API requests | Store reads | Store writes |
| --- | ---: | ---: | ---: | ---: |
| Admin cold open | 3 | 1 | 1 | 0 |
| Customer Wallet + Deposit cold open | 8 | 1 | 1 | 0 |
| Asset/network selection + copy | 0 | 0 | 0 | 0 |
| Admin idle, 60.1 seconds | 0 | 0 | 0 | 0 |
| Customer idle, 60.1 seconds | 0 | 0 | 0 | 0 |

The remaining page requests are existing authentication, alerts and Wallet data.
Admin authorization performs two mocked existing user/session reads; these are
not catalogue reads. The public catalogue performs no authentication DB access.
Warm reads within the server's 30-second TTL use zero additional store reads,
verified in unit tests. An explicit save reads once and performs one atomic
conditional write, then invalidates the cache. Other instances expire within 30s.

Catalogue Neon queries/writes: **0 / 0**. New deposit-event writes: **0**.
Blockchain calls, txHash submissions and financial writes caused by this feature:
**0**. No production DB was contacted for QA. Existing unrelated Wallet portfolio
snapshot behavior is unchanged and not claimed to be part of this catalogue.

## Screenshots

- [Admin desktop](admin-desktop.png)
- [Admin mobile](admin-mobile.png)
- [Admin editor mobile](admin-editor-mobile.png)
- [Customer Deposit desktop](customer-desktop.png)
- [Customer Deposit mobile](customer-mobile.png)

All screenshots contain synthetic addresses/data.

## Change manifest and boundaries

The exact changed file list is in [files-changed.txt](files-changed.txt).

Merged: **NO**. Deployed: **NO**. Production data changed: **NO**.
Neon schema changed: **NO**. Neon address storage added: **NO**.
Deposit event storage added: **NO**. Automatic deposit credit added: **NO**.
Blockchain polling added: **NO**. txHash submission added: **NO**.

CI integration follow-up: preserved the existing locale-byte digests while explicitly
validating the one added neutral key, included the new shared client in Copy Trading
workflow triggers, and set the legacy-mode flag in the old admin test loader. No
runtime code changed in this follow-up; the existing browser evidence remains valid.

## Persistent Worker follow-up (PR #318)

- Existing regressions: 147 PASS / 9 suites in the final complete run (local jsdom resolver path corrected).
- Actual workerd + SQLite DO: 15 PASS, including full runtime restart, 12-way CAS (1 commit / 11 conflicts), two backend instances, uncertain commit recovery, shared inflight and TTL.
- Read-only baseline exporter: 5 PASS. Total targeted: 167 PASS / 0 FAIL.
- Backend build, frontend TypeScript and Wrangler staging dry-run: PASS.
- No visual/layout changes; existing approved screenshots retained. Follow-up changes only persistence and truthful uncertain-save error copy. CI repeats the existing browser scenarios.
- Actual production baseline: 4 rails / 3 networks, captured read-only from authenticated legacy admin DOM; BSC/Solana/TON unconfigured. Local file: `output/deposit-catalogue-baseline/production-baseline-review-20260928.json`. Not committed, seeded or activated; owner review pending.
- Worker prepared only, not deployed; feature flag remains off by default. See runbook for exact names and separate activation gates.
