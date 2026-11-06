# Issue #691 — order ticket, isolated evidence and release gate

## Verified source and boundary

Observed Pages production on 2026-11-06: deployment
`cf27696f-8493-47dc-bc07-ddcfb3fbbfc1`, source
`03d5467bf9e8451eddade12e1c528c211350a1b1`.
Pages Git integration reports production auto-deployment disabled and preview setting `none`.
Fresh main was `6260ae7731652831480824d4c1eb911c0bef2b87`.
The implementation was built/tested first on the actual Pages source, not arbitrary main.
The production-based commit must remain separate from the review/main integration commit.

The original built OrderForm reproduced `2` becoming `2.00` immediately on both
1440 and 390 px. Without a reference price, the old total field discarded the input.
This is isolated browser evidence, not an authenticated production replay.

Changes:
- Draft numeric text remains text; comma/dot are accepted, complete values are
  normalized only for the existing executor. Total has its own draft instead of
  a two-decimal display loop. Missing prices never fabricate a quantity.
- Both tickets check a session-bound server capability before validation, messages,
  confirmation, request IDs, resets or writes. Viewer CTA remains enabled even
  when a listing is not tradable. No local role or balance grants capability.
- `orderTicketBoundary` is mounted before order routers. It validates the existing
  pinned owner plus exactly one distinct native tester and current authenticated
  session. Missing/ambiguous configuration fails closed. API keys and legacy
  sessionless JWTs do not acquire interactive demo permission.
- The underlying engines, accounting, listing gates, withdrawals and wallets are
  unchanged. Existing `/demo/orders` and native Futures execution retain their
  own feature/market checks. Ordinary Balance BUY/conditional/OCO creation is
  refused, including for the two admitted identities: no fallback from demo to
  real settlement. The existing simulation-only MARKET SELL path remains.
- Legacy ADMIN/funded-user exceptions remain internal service behavior, but do
  not bypass the new outer HTTP boundary. Tests explicitly compose that boundary
  with the real routers. Old engine-only router tests remain independent.
- A retired market is not classified as an ordinary Demo Spot pair; no listing,
  retirement record, price model or timer is edited.

## Actual checks

- Backend TypeScript/build PASS; frontend TypeScript/build PASS.
- 45 targeted suites, 887 tests PASS (Futures, draft decimals, session/forged
  requests, unchanged financial fixture rows, existing Spot request semantics).
- Existing DemoTrading/FuturesProtection router suites plus composed boundary:
  68 tests PASS in a separate run.
- Baseline browser reproduction: desktop/mobile PASS; `baseline.json`.
- Final browser matrix: built app, ECLV/USDT + BTC/USDT + Futures at 1440/390.
  See `browser.json` and screenshots. No provider/production requests are allowed;
  all market/account values are explicitly synthetic fixtures. Mutation attempts
  are counted and refused rather than forwarded. These are NOT production screenshots.
- PostgreSQL check uses disposable PostgreSQL 18.6 via PGlite 0.5.15 (WASM).
  Actual authorization SQL and unchanged Balance/DemoBalance/order/trade fixture
  rows are checked. This is not a native PostgreSQL/Prisma/TLS financial-engine
  integration claim. Native local `initdb` is unavailable under the runtime's
  root-only UID mapping; no production database was used.
- Browser capability session-switch, stale/out-of-order grant, offline, and
  synchronous old-session callback checks pass independently with the real hook.
- Existing test fixtures now model an admitted trader explicitly; viewer behavior
  is covered separately by browser and server-boundary tests. Semantic fingerprint
  changes cover the intentional new total field/admission policy, not an exemption
  for financial payload changes.

## Remaining release blockers — no production write performed

1. Connected-browser extension returns `Browser access requires the originating
   browser context`; the separate cloud Chrome inventory has no authenticated tabs.
   No authorized production viewer or trader session is available in this runtime.
2. No local Windows terminal/authorized Hetzner OS connection is exposed. Actual
   production API source/image, runtime-bootstrap, and the two pinned bindings
   cannot be verified. Do not copy `src/index.ts` from a frontend source tree over
   an unknown API revision.
3. Before release, verify exactly one existing owner plus one distinct existing
   tester (without publishing IDs), session enforcement and existing demo flags.
   No additional account, ADMIN role or demo credit may be opted in. Do not enable
   a financial flag to make QA green. If Demo Spot is disabled, do not claim that
   its BUY/LIMIT flow is active; the boundary must not substitute real Balance.
4. CI and native disposable PostgreSQL checks must be assessed on the exact PR
   head. The owner-authorized narrow production release is still conditional on
   these checks and authenticated post-deploy verification.

## Controlled release / rollback (prepared, NOT executed)

- Re-read canonical Pages deployment and actual API source/image. Abort on drift.
- Apply only the boundary middleware/router and its import/mount to the verified
  API source, preserving runtime bootstrap and all existing protections. Include
  the existing native access dependencies unchanged; compare checksums.
- Retain the exact prior API image/config and verify health/rollback before cutover.
  No migrations, balance changes, listing changes, container/volume cleanup or
  financial flag changes are part of this patch.
- Verify authenticated GET `/api/v1/orders/access`, ordinary session denied,
  exact two demo identities admitted, forged trading writes refused, other reads
  unaffected. Positive financial tests belong only in a disposable environment.
- Build the frontend patch on the production source with the SAME reviewed public
  build environment/flags. Local QA bundles deliberately use loopback and must
  NEVER be uploaded. Compare the file allowlist; do not publish main wholesale.
- Deploy frontend only after the API boundary is verified; preserve the previous
  Pages deployment for frontend-only rollback. Repeat the 1440/390 matrix with
  authorized ordinary production session, capturing sanitized status/route counts.
- If critical checks fail, roll back only the changed frontend/API artifact to its
  captured predecessor. Do not remove protections by changing financial flags.
- Acceptance remains BLOCKED until actual voltextech.net verification. No deployed
  SHA, production PASS, merge or release completion is claimed by this document.

## First CI follow-up

Review PR #692 initial head `c6f7e01f31fd1d7386abaf17494d52d178dea4c2`:
focused Node 22 / Ubuntu 24.04 Chromium + PostgreSQL-WASM workflow
[42288219604](https://github.com/nazardzuba79-tech/-/actions/runs/42288219604)
passed. The full frontend run had 307 passing suites / 4 failing suites.
Three failures were legacy disabled-button assertions or a component harness
missing the new imports; these are corrected without changing runtime.
The fourth was a pre-existing main/API pin mismatch: main lacked the exact
#688 withdrawal-review normalizer and its negative controls already present in
observed production source 03d5467b. Restore that tested normalizer, keeping
its ORIGINAL pin and mutation-refusal assertions; api.ts remains unchanged.
Legacy browser executor fixtures now explicitly supply their synthetic admission
capability. These fixture capabilities are not production allowlist evidence.
The dedicated CI SQL check now also supports disposable native PostgreSQL via
Prisma; its next CI result must be checked before claiming native validation.

Native CI confirmation: review head `724c8de4db3a585c05920d5a0f67b84b802b6e56`,
[run 42289519383](https://github.com/nazardzuba79-tech/-/actions/runs/42289519383):
7 suites / 152 tests PASS and Chromium 6/6 PASS, all financial-request counts 0.
Runner logs confirm native PostgreSQL 18.6. Prisma executes the actual session
SQL against disposable fixture tables; no production database or financial-engine
settlement is implied by this admission test. This closes the local native-SQL
availability gap; production runtime/bindings/browser gates remain unchanged.
The #688 nonpayable `reviewAssets` field is also asserted in the legacy disposable
ledger QA without relaxing empty withdrawable assets or withdrawal rejection.
