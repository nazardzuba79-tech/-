# Cloudflare activation — Admin Listings and the direct Deposit catalogue read

The code, workflows and checks below are prepared and tested locally. Nothing
here has been deployed, and no secret, production setting, balance or address
has been changed. Every step is an owner-approved release action.

Secrets travel only through GitHub Actions secrets, the Render dashboard and
Cloudflare Worker secrets — never git, the frontend, chat or logs.

## A. Admin → Listings (market-edge Worker + Render)

The order matters. Each step fails closed: before the next one, Admin → Listings
shows «Листинги не подключены», never a false success.

| # | Where | Action | Check |
|---|---|---|---|
| 1 | Owner's machine | Generate a random value of at least 32 characters (e.g. `openssl rand -hex 32`). Do not paste it anywhere else. | — |
| 2 | GitHub → Settings → Secrets → Actions | Add `LISTINGS_STORE_TOKEN` with that value. (`CLOUDFLARE_API_TOKEN` already exists for the market-edge deploy.) | — |
| 3 | GitHub Actions | Run **Verify / deploy voltex-market-edge** (manual dispatch on main, or a `[deploy-market-edge]` commit on `cloudflare-market-edge`). | See below. |
| 4 | Render → the API service → Environment | Set `LISTINGS_STORE_URL=https://market.voltextech.net` and `LISTINGS_STORE_TOKEN` (the same value). Declared in `render.yaml` as `sync: false`, so the values stay in the dashboard. Render redeploys. | No `[listings] store not configured: …` line in the start-up log. |
| 5 | Browser (production QA, owner) | Open Admin → Listings. | The list loads with no «не подключены» banner. Do not create or publish anything unless you decide to; no owner allocation is run. |

Step 3 does the following, in order:

1. Runs the verify job: Worker contract tests, listings Durable Object tests, the smoke-script tests and a wrangler dry-run.
2. Runs `wrangler deploy`, which applies the `listings-v1` migration. This creates a new, empty SQLite namespace, `ManagedListingsDO`.
3. Puts `LISTINGS_STORE_TOKEN` from the GitHub secret with `wrangler secret put` (stdin, never printed). It refuses values shorter than 32 characters.
4. Checks that `/health` is `public-display-edge-v10`.
5. Runs `scripts/smoke-market-edge-listings.mjs --require-admin`. It is read-only and must end with `listings admin store: CONNECTED`.

If the GitHub secret is absent, the deploy still succeeds. The public edge (v10) works, and the smoke reports `NOT CONFIGURED`.

The frontend needs no setting: it reads `https://market.voltextech.net` by default. Pages deploys from main as usual. Deploy the Worker (step 3) before a frontend containing Listings goes live; otherwise every Markets/Trade page would ask the v9 Worker for `/market/listings` and get 404.

What a half-finished rollout looks like:

| State | Render `/admin/listings` | Admin page |
|---|---|---|
| Render settings missing or invalid | 503 `STORE_NOT_CONFIGURED`, logged by name only | «Листинги не подключены: хранилище Cloudflare не настроено…», Create disabled |
| Worker has no secret | 503 `STORE_NOT_CONFIGURED` | same |
| Tokens differ | 503 `STORE_AUTH_FAILED` | «…ключ хранилища на сервере и в Cloudflare не совпадает…», Create disabled |
| Worker unreachable | 503 `STORE_UNAVAILABLE` | «временно недоступно», retry |

**Rollback:** remove the two Render variables. Admin → Listings goes back to "not connected". The Worker keeps serving v10 public data, and the Durable Object keeps its data.

## B. Deposit dialog reads the catalogue directly from Cloudflare

**Precondition, owner-approved and separate:**
- The production Worker `voltex-deposit-catalogue-production` exists with its `DEPOSIT_CATALOGUE_STORE_TOKEN`.
- It holds the reviewed catalogue (see `docs/manual-deposit-catalogue.md`).

The workflow below refuses to run otherwise. It never creates the Worker, never seeds or edits addresses, and never touches that secret.

| # | Where | Action | Check |
|---|---|---|---|
| 1 | GitHub Actions | Run **Deploy deposit catalogue public read (production Worker)** with `confirm = deploy-production-public-read`. | See below. |
| 2 | Cloudflare → Pages → `voltex-exchange` → Settings → Environment variables (Production) | `VITE_MANUAL_DEPOSIT_CATALOGUE=true` and `VITE_DEPOSIT_CATALOGUE_URL=<the URL from step 1>`. Retry the latest production deployment. | An invalid URL fails the Pages build (the previous deployment stays live). |
| 3 | Browser (production QA, owner) | Open Deposit with DevTools → Network. | One GET to `<URL>/public/deposit-catalogue` and none to `/api/v1/deposit-catalogue`. Nothing more on asset/network/Copy/QR and nothing while idle. |

Step 1 does the following, in order:

1. Runs the Worker tests, including the smoke-script tests.
2. Checks that the production Worker exists and has its secret (names only).
3. Runs `wrangler deploy --env production` (code only; same script, class and `v1` tag, so the Durable Object namespace and its data are unchanged).
4. Resolves the Worker's real public origin from Cloudflare (`/accounts/{id}/workers/subdomain` → `https://voltex-deposit-catalogue-production.<subdomain>.workers.dev`).
5. Runs `scripts/smoke-deposit-public.mjs`. It checks for 200 plus CORS for `https://voltextech.net`, active entries only, 304 on revalidation, a foreign origin refused, public writes refused, and the private path needing the secret.
6. Writes the exact `VITE_DEPOSIT_CATALOGUE_URL` to the run summary.

With `VITE_MANUAL_DEPOSIT_CATALOGUE=true`, the Deposit dialog offers only the catalogue's active destinations. Turn it on only after the production catalogue has been reviewed.

**Rollback:** remove the two Pages variables and redeploy Pages. The dialog returns to the existing flow.

## Access this activation needs (not available to the agent)

- Writing GitHub Actions secrets and dispatching the deploy workflows.
- The Render dashboard (API service environment).
- The Cloudflare Pages project settings.
- Cloudflare account confirmation that `voltex-deposit-catalogue-production` exists. Its `workers.dev` subdomain is account-level and is not in the repository; the workflow reads it from the API instead of guessing it.
