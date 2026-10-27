# API P0 fence hotfix on the live API lineage (27 October 2026)

**Коротко для власника.**
- **Live API.** The live API (`api.voltextech.net/health`) runs `89c3ac00` (branch `release/demo-off-api-20261023`, started 23.10 16:30 UTC). It does **not** contain the two merged fences, #620 and #625.
- **Proven on a disposable database with the live code and the live switch values** (all demo switches OFF):
  - a demo-valued Cross wallet can file a withdrawal, and it can be approved and marked SENT;
  - an owner or tester market sale of NRX or a listing token credits USDT that can be withdrawn.
- **Fix.** This hotfix replaces **exactly five** compiled modules in the current production image with the versions already merged into `main`. There is no migration, no dependency change, no switch change and no other module.
- **Status.** Not deployed. It needs one operator after the active listing window ends, with the steps below.

## What changes for users

| Area | Before (live `89c3ac00`) | After the hotfix |
|---|---|---|
| Cross (native demo) wallet withdrawal: owner and configured testers | listed; an unheld request is filed, approved and SENT | lists nothing; `POST /withdrawals` → 403 `DEMO_FUNDS_NOT_WITHDRAWABLE`; approve and mark-sent of an unheld row → 403; reject still works and credits nothing |
| Ordinary `Balance` withdrawal (every other account) | held request → approve → SENT | **unchanged** |
| Owner or tester MARKET SELL of NRX, managed listings, test assets | synthetic fill; model-priced USDT credited to `Balance` | refused before any write: *Simulation Spot sale is not available for this listing* |
| Owner or tester MARKET SELL of ordinary pairs; every LIMIT order; the book for all users | — | **unchanged** |
| Existing balances and requests | — | **untouched**: nothing is moved, cancelled, relabelled or paid |

The DemoBalance settlement opt-in from #625 (`SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED`) is pinned `false` here.

**Known limitation (fail-closed, unchanged from `main`).** A configured owner or tester who has an opened Cross wallet is routed to the Cross path, so they cannot file even a real-`Balance` withdrawal through the API. That is already the case today, through the unheld path. A follow-up on `main` will let such mixed accounts withdraw genuine held `Balance`.

## Evidence (disposable PostgreSQL 16, live-lineage schema and migrations, synthetic accounts)

Source: branch `claude/voltex-mobile-audit-7rpjni-api-p0-hotfix`. Base `89c3ac00`, plus the five modules and the tests from #620 and #625.

| Run | Live code `89c3ac00` (RED control) | Hotfix |
|---|---|---|
| `test-withdrawal-demo-fence-postgres.cjs` (5 switch combinations, real routers) | **17 pass / 6 FAIL**: the adverse control, the owner/tester POST, a forged service call, historic approve/SENT, concurrency, the invariant | **23/23**, `sentUnheld` 0 |
| Jest: withdrawal, admin withdrawal, mint fence PG, NRX Spot PG | **22 failed** / 104 | all pass |
| Jest, 10 suites (above + OrderService, DemoTrading, DemoLiquidity, demoReleaseOff, simulationOnlyIsolation) | — | **195/195** |
| Backend `tsc` | — | PASS |

Exact-head CI: workflow `api-p0-hotfix.yml` on the PR. It also uploads the deterministic overlay archive and its manifest.

## Artifact

- `scripts/package-api-p0-hotfix.py` refuses to package unless:
  - the tree is committed;
  - the five modules equal merged `main` byte-for-byte (`5b80fc3e` for #620, `4ac8a45e` for #625);
  - no other runtime source differs from `89c3ac00`;
  - `prisma`, `package*.json`, `src/index.ts`, `src/buildCommit.ts`, futures, private trading, listings, test markets, config, frontend and Workers are unchanged;
  - `tsc` passes.

  It writes `output/api-p0-hotfix/api-p0-hotfix-<sha>.tar` (mtime 0, reproducible) and `manifest.json` with each file's SHA-256.
- `release/api-p0-hotfix/Dockerfile`:
  - `FROM` the **current production image**;
  - copies the ten files (five `.js` + `.map`, UID 1000, 0644) and nothing else;
  - pins the four flags `false`;
  - `CMD ["node","dist/index.js"]`, so no migrations run.
- `release/api-p0-hotfix/compose.template.yaml` overrides only the `api-production` image, release SHA and pinned flags.

## Operator steps (one operator; only after the active listing window)

1. **Freeze check.**
   - No other production change in progress: the ECLAVO/QAVENTRA window is closed; Work and Codex are informed.
   - `curl -s https://api.voltextech.net/health` still reports commit `89c3ac00…`. If not, stop: the base moved.
2. **Backup.** Use the existing PostgreSQL backup mechanism and its independent restore check. The hotfix writes no schema or data, but the backup is the standard gate.
3. **Base image.**
   - Run `docker inspect --format '{{.Image}}' <api-production container>`.
   - Record the image ID as **ROLLBACK_IMAGE**.
   - Verify `docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' <image>` = `89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`.
4. **Archive.**
   - Fetch the CI artifact of the exact PR head, or run `python3 scripts/package-api-p0-hotfix.py` at that commit with Node 22.
   - Verify `archiveSha256` and every file hash against the CI manifest.
5. **Build an inactive image.**
   - `docker build --network=none --pull=false --build-arg BASE_IMAGE=<ROLLBACK_IMAGE> --build-arg RELEASE_SHA=<hotfix sha> -t voltex-api-p0-hotfix:<short sha> <extracted archive>`.
   - In a created, **stopped** container (`--network none`, no mounts or secrets), compare the ten file hashes with the manifest, then remove it.
6. **Switch `api-production` only.**
   - Apply the compose template with `P0_HOTFIX_IMAGE=<new image ID>` and `P0_HOTFIX_SHA=<hotfix sha>`.
   - Use `up -d --no-deps api-production`: no build, no pull, no migration, no other service touched.
7. **Verify.**
   - `/health` reports the hotfix SHA and a new `startedAt`.
   - Public pages, Spot tickers and order book load.
   - Login works.
   - Admin withdrawals list loads.
   - A Cross-wallet account sees no withdrawable assets.
   - No real order, withdrawal or balance write is made for the check.
8. **Rollback** on any failure:
   - re-apply the previous Compose chain with **ROLLBACK_IMAGE** (`up -d --no-deps api-production`);
   - nothing in the database needs reverting.
   - **Note:** rollback re-opens both P0 paths, so it is a stop-gap only.

## Not in this hotfix

- #612 and #619 (frontend, notification Worker, new admin endpoint): a separate frontend/API release.
- The #625 DemoBalance settlement switch: stays OFF.
- Stocks, Futures, listings and Workers.
- Reconciliation of USDT minted before the fence: read-only SQL in `docs/SIMULATION_SALE_P0_617.md` on `main`; owner decision.
