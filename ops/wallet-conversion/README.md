# Wallet Conversion #591 — narrow release preparation, not activation

This release branch must **not** be merged into main. The implementation is
already merged there. It composes only the reviewed conversion delta over the
actual production versions, so no unrelated main code is published.

## Exact sources

- Reviewed implementation: merged591 `ad5bd1a7b9b537b9af92af6674686b663a79d5f5`, original head `2670e426bc3e40b31ec5902a22a4a676fe5c0ebe`.
- API base: `210aefacb319374194392624d75b312b87b42e94`.
- Base/rollback image: `sha256:07a4c3e07ff36d17eb611e4d7a5a86bbbd1c2e36eaf7b1c9f041ef774b9d2a77`.
- Pages base: `6118e18e49edd226a6b250154d3893773b4522e2`.
- Pages candidate: `6f6b0189feedadcd331f6733111992ce3fe5c3b6`, branch `work/wallet-conversion-pages-20261029`.
- Node build/runtime: **22.23.3**. No application package/lockfile, Prisma schema or migration delta.

The API has exactly four changed runtime modules: index, WalletPortfolioService,
and the new WalletConversionService/walletActivity router. The source of both
new modules is byte-preserved from591. Portfolio changes are display-only fiat
valuation; financial conversion math is unchanged. All other production source,
including the five629 fences, NRX alias denial, ECLV/QVTR, Admin Delete, banking,
notifications and runtime bootstrap/collector, remains the production base.

The old production-source WithdrawalService **test** still expected the removed
configurable unheld-withdrawal constructor. The current merged permanent-fence
test was copied without weakening assertions. Withdrawal runtime is unchanged.

## Actual production evidence, 29 October 2026 (READ ONLY)

- API healthy at210aefac; conversion/activity modules absent; availability GET404.
- All four Node-process environments have conversion flag/limits UNSET and
  reserves unconfigured; existing Demo Spot/Liquidity/withdrawal guard are ON.
- Canonical Pages95010b1c, source6118e18e, success. Conversion build flag unset;
  automatic production deployments OFF and previews none.
- Demo Liquidity account is an unblocked USER, with zero nonzero ordinary Balance
  rows. Read-only transaction, 3s statement/500ms lock limits. Positive available
  demo inventory exists in BTC/ETH/USDT; no USD/EUR/USDC inventory rows. No IDs,
  email, amounts, credentials or financial records are published here.
- Therefore Crypto→Fiat and USDC destination capacity are **NOT established in
  production**. They must fail closed. Do not create inventory or invent reserves.

## Validation gates

Local on the two narrow sources: API TypeScript/build PASS, 4 backend suites146
tests PASS; frontend TypeScript/flagged build PASS, 6 wallet/i18n/Futures suites201
tests PASS; preflight1 positive +10 negative controls PASS. Initial backend test
selection encountered the stale withdrawal fixture and one nonexistent test
path; these were corrected, without changing withdrawal implementation.

Local real PostgreSQL cannot run: this environment exposes only UID0 and rejects
setgroups/setuid. No workaround of that restriction was attempted. The dedicated
Ubuntu24.04 workflow runs the existing disposable PostgreSQL and real-HTTP/browser
fixtures against these exact sources, including seven-language1440/390 coverage,
demo inventory conservation, default-OFF build, retry/replay, session revocation,
lock waiting, insufficient funds/reserves, and Spot contention. Until its final
head result is read, new candidate PG/browser checks remain **PENDING**, not PASS.

## Artifact preparation

On Node22.23.3, after committing the candidate and building the API:

```sh
WALLET_RELEASE_FRONTEND_ROOT=/path/to/exact-pages-candidate node ops/wallet-conversion/prepare-release.cjs
python3 ops/wallet-conversion/preflight.py --self-test
```

`output/wallet-conversion-release` contains only the four compiled modules plus
maps, a Dockerfile FROM the immutable deployed image, and a SHA256 manifest. It
does not install packages, copy Prisma, run migrations, change entrypoint/CMD or
build/deploy an image. The manifest pins16 original runtime fingerprints, exact
source SHA and the companion Pages source. It verifies unchanged dependencies,
schema, protected runtime paths and every frontend conversion path.

On Hetzner, with that reviewed manifest available, the following is READ ONLY:

```sh
python3 ops/wallet-conversion/preflight.py --manifest /private/reviewed/manifest.json
```

That command is not permission to release. It refuses base-image/source drift,
changed bootstrap/startup/migration command, wrong Node, unhealthy API/DB,
missing rollback/14-file Compose stack, mounted runtime files, mismatching
protected modules, enabled conversion/reserves, or altered demo safety flags.

## Controlled deployment plan — separately authorized, NOT executed

1. Re-read actual API source/image, Pages canonical SHA, health, current backup
   receipts/freshness and immutable image rollback; run the read-only preflight.
   Stop for any drift. Keep all14 current Compose overlays and private runtime
   bootstrap configuration. Do not use the repository's generic Dockerfile or
   its migration-start command.
2. Only after explicit owner API-release permission, build the reviewed overlay
   FROM the pinned production image. Verify the nine payload hashes. Compare
   before/after resolved Compose JSON: only api-production image and
   VOLTEX_RELEASE_SHA may differ; preserve all services, environment, mounts,
   networks, profile, ports, resources, bootstrap and single collector. Apply
   ONLY api-production (`--no-deps`), with WALLET_CONVERSION_ENABLED still OFF
   and WALLET_CONVERSION_RESERVES empty. No DB restore/migration or financial
   operation belongs in this step.
3. Check health/source, new module hashes,16 protected baseline modules (the two
   intentionally replaced index/portfolio are compared to payload instead),
   unchanged DB/collector, bounded public BTC/ETH/Futures/CFD reads, and
   authenticated conversion404/default-OFF behavior. Never create a real order.
4. Only after explicit separate Pages-release permission, use the existing
   reviewed Pages release path for the exact Pages candidate, default-OFF build.
   Do not publish raw main. Preserve canonical6118e18e as the frontend rollback.
   Check Wallet/Banking, auth and no conversion request at1440/390; preserve
   listings/timers/SEO/Admin Delete. Installing hidden code is not activation.
5. **Activation is another owner decision:** demo conversion permission, explicit
   asset inventory/allocation decision and reviewed1000/5000 USD limits. Confirm
   market bid/ask/depth freshness for every admitted direction. Ordinary Balance
   remains closed with empty reserves;630 legacy provenance remains NO-GO.
   Mixed accounts retaining ordinary Balance continue to follow existing Spot
   ledger selection; do not erase/relabel old funds to make conversion work.
6. Only after separately approved activation, enable the two conversion switches
   through their existing configuration/build mechanisms. No liquidity, admin
   credit, genuine-funds or reserve action is implied by a code-release approval.

## Rollback

- Before switching API image, save the exact applied overlay list, old image,
  sanitized signatures and current health. Keep the base image locally.
- If health/identity/auth/collector fails, stop further rollout and restore only
  api-production's prior immutable image plus prior release-identity overlay,
  using the same14-file stack/profile and `--no-deps`. Do not restore a database,
  restart DB, change flags, delete volumes or switch unrelated workers.
- Restore Pages to canonical6118e18e only if this frontend release regresses.
- A future disable prevents new conversions; it does not reverse committed
  financial transactions. Do not delete receipts or balances. If a future
  activation produces an anomaly, disable admission, retain evidence, and use
  the established idempotent receipt/reconciliation process under owner control.

Production flags, balances, liquidity, orders, timers, schema, API/Pages/Workers
were **not changed** by this preparation. No duplicate PR is needed.
