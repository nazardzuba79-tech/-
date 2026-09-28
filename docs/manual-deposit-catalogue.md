# Manual receiving-address catalogue — review implementation

## Owner-authorized activation follow-up (2026-09-28)

PR #318 is merged in `405431f43905a51b4b26c11a2fe85fbb6ee6a004`.
The owner has authorized the separate staging/production rollout and supplied
nine explicit asset/network destinations, including native POL/Polygon and TON
with an empty memo. Real destinations remain outside source control.

The production environment is `voltex-deposit-catalogue-production`, with its own
Worker, secret and SQLite namespace. Its binding/class/object/endpoint names
are the same as staging; never connect production Render to the staging URL.
No custom route or account ID is added. Set the server secret independently in
each environment. Production frontend activation must follow verified storage,
CAS seeding with a saved previous document, Render connectivity and a successful
public catalogue response. Preserve unrelated rails and legacy configuration.

Pre-release verification: 148 existing tests PASS, 15 actual local SQLite/Worker
tests PASS and production bundle dry-run PASS. Authorized remote staging verifies
unauthorized GET/PUT refusal, one commit versus eleven concurrent conflicts,
persisted revision/document after redeploy, and edit/disable/memo clearing.
Cloudflare account is Workers Free; no paid upgrade was requested or performed.
These results do not claim production activation; record actual deployment and
live QA separately after the release gates complete.

The sections below retain the original pre-activation implementation history.

This change is **not activated in production**. Default builds continue to use
the existing TreasuryWallet-backed Admin and Deposit flows. No production
addresses, database records, platform settings or deployments were changed.

## Persistent storage follow-up — prepared, not deployed

The original adapter-only stop below is historical. The follow-up to PR #318
implements `workers/deposit-catalogue` and verifies actual workerd + SQLite
restart persistence, atomic CAS, authentication, cache and uncertain-write
recovery. No Cloudflare resources or secrets were provisioned.

| Setting | Exact value |
| --- | --- |
| Local Worker | `voltex-deposit-catalogue-local` |
| Prepared staging Worker | `voltex-deposit-catalogue-staging` |
| Durable Object class | `ReceivingAddressCatalogueDO` |
| Binding | `RECEIVING_ADDRESS_CATALOGUE` |
| Single named object | `voltex-receiving-addresses-v1` |
| Endpoint | `/receiving-address-catalogue` |
| Cloudflare secret | `DEPOSIT_CATALOGUE_STORE_TOKEN` (random, at least 32 characters) |
| Render server env | `DEPOSIT_CATALOGUE_STORE_URL`, `DEPOSIT_CATALOGUE_STORE_TOKEN` |

The staging namespace belongs to its own Worker. No account ID, production
environment/route, cron or deployment automation is configured. Default
workers.dev and previews are disabled. Staging workers.dev requires the secret.
Origin-bearing requests are rejected; no CORS. Never add a VITE secret.

A singleton SQLite table stores the canonical JSON and decimal-string revision.
An unseeded object returns revision `0` and an empty document. `transactionSync`
performs read/compare/increment/write without an await. No memory/KV fallback.
Body limit: 256 KiB. The Worker imports the same strict backend schema and rails.
No alarms, scheduled handlers, blockchain requests or financial dependencies.

Local verification (no credentials/deployment):

```sh
npm run build
npm ci --prefix workers/deposit-catalogue
npm test --prefix workers/deposit-catalogue
npm run build:check --prefix workers/deposit-catalogue
node --test scripts/export-deposit-catalogue-baseline.test.cjs
```

`build:check` uses `wrangler deploy --dry-run --env staging`: bundle/configuration
validation only. Deployment, secrets, baseline seeding and feature activation
each remain separate owner-approved operations.

Sources: [SQLite storage / transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[DO migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

### Read-only baseline exporter

`scripts/export-deposit-catalogue-baseline.cjs` reads the existing authenticated
`GET /api/v1/admin/wallets` resolver, which applies overrides over env defaults.
This one-time legacy read is separate from runtime catalogue persistence.
Use an existing admin credential only through `VOLTEX_BASELINE_ADMIN_TOKEN` in
the local process environment; never paste it in command arguments/output and
never use the Worker secret. The script does not load .env or Prisma:

```sh
node scripts/export-deposit-catalogue-baseline.cjs --api-base https://BACKEND/api/v1 --out BASELINE-REVIEW.json
```

Alternatively `--ui-snapshot FILE` converts a complete read-only DOM capture
from the existing authenticated legacy admin page, avoiding extraction of browser
credentials. Both modes require all six legacy chains accounted for, reject
unknown/unmapped rails and duplicates, and preserve addresses verbatim. Unknown
tokens block export rather than being dropped or mapped to an invented network.
No remote mutation, output overwrite, Worker seeding or blockchain lookup occurs.

Actual capture: **2026-09-28T16:39:11.917Z**, authenticated
`https://voltextech.net/admin/wallets` DOM backed by the existing resolver.
The UI reports **4 rails / 3 networks**: BTC Bitcoin, ETH Ethereum, USDT Ethereum,
USDT TRON; BSC/Solana/TON explicitly unconfigured. Script-generated local files:

- `output/deposit-catalogue-baseline/production-admin-dom-20260928.json`
- `output/deposit-catalogue-baseline/production-baseline-review-20260928.json`

These owner-review files are excluded from git/CI artifacts. The review file
includes provenance, timestamp, canonical document and SHA-256. No secret was
extracted, no address seeded, and address ownership is not independently verified.
Refresh and review the snapshot with the owner before activation. No direct
production SQL or direct authenticated API export was run in this session.

Keep `VITE_MANUAL_DEPOSIT_CATALOGUE` absent/false in production. Implementation
is ready for review; deployment, reviewed baseline seeding, remote verification
and feature activation remain pending explicit owner authorization.

## Adapter contract

Both requests use `Authorization: Bearer <server secret>`; redirects are refused
and requests have an 8-second deadline. Credentials and upstream response bodies
are never returned to a customer. The endpoint must itself authenticate both
reads and writes and apply a small request-body limit.

- `GET`: one full-document read, response `{ revision, document }`.
- `PUT`: JSON document plus `If-Match: <revision>`; persist only if the revision
  matches, increment the revision, return the same envelope. Compare and write
  must be one atomic transaction. On conflict return 409/412. Do not emulate CAS
  with a process lock in the Render API or with eventually consistent KV.
- Revision: 1–128 alphanumeric/underscore/hyphen characters.
- Document: `{ schemaVersion: 1, baseline: AddressEntry[], overrides: AddressEntry[] }`.
- Entry: `{ assetId, networkId, address, enabled, memo, memoLabel }`.

`baseline + overrides` is keyed by stable CoinGecko ID + explicit network ID.
Clear writes an empty disabled override, so the old baseline cannot reappear.
An address change affects only the selected asset/network, not all tokens sharing
an EVM treasury. Stored documents reject duplicate rails and unknown fields.

Server cache: one shared in-flight load, 30-second TTL, public fingerprint/ETag,
explicit Admin refresh, local invalidation after save (including uncertain
responses). An uncertain PUT forces one fresh GET without retrying PUT or
assuming success/failure; the caller must refresh before another save. Even if
reconciliation also fails, local cache is invalidated. Other API instances
revalidate within the TTL. No stale-on-error
fallback after expiry. Browsers fetch once per open, never keep authoritative
addresses locally and never fetch per asset/network row. An already-open modal
is a snapshot until reopened; there is intentionally no polling.

## Ranking and network identity

Admin uses the existing injected `CoinGeckoService.getRankings()` source, sorted
by reported market-cap rank, with VTA excluded. It shows 20 distinct identities,
including stablecoins; it does not make the explicit rail registry a ranking.
Saved destinations outside the top 20 remain in “Другие сохранённые”, including
disabled addresses. A newly ranked unmapped asset is visible as unconfigured
and cannot accept an address until its network is explicitly reviewed/mapped.
Polygon POL is registered explicitly as `polygon-ecosystem-token` on the native `polygon` rail; its EVM address format is validated independently from Ethereum/BSC and is not inferred from the shared 0x address value.
Wrapped/staked assets are separate stable identities. Rank-provider failure
retains saved destinations and offers the explicit registry without fake ranks.

Address checks cover network-specific format, known asset/network, lengths,
memo capability and XRP tag bounds. EVM uses ethers address validation. Other
network formats are syntactic checks, not proof of ownership or full checksum
verification; the administrator must independently verify the receiving address.
No chain/explorer request is made to validate it.

## Isolation and legacy compatibility

New public endpoint: `GET /api/v1/deposit-catalogue`, no authentication/DB call.
New Admin endpoints: GET/PUT `/api/v1/admin/deposit-catalogue`, using the existing
server-side `requireAuth` + `requireAdmin`; browser role flags have no authority.
Existing authentication may read users/sessions and update session last-seen.
Those existing auth operations are separate from catalogue persistence.

Legacy chain-address endpoints, TreasuryWallet, chain providers, watcher,
deposit processing and explicit credit workflows are unchanged. New manual
destinations are not supplied to those watchers or proof/credit routes. The
catalogue has no dependency on balances, orders, VTA or a deposit-event service.
The feature ends with displaying/copying an address and optional memo.

Rollout must not independently edit both legacy treasury configuration and the
new baseline: once enabled, Admin edits the new overrides. Existing legacy
monitoring continues to use its original configuration and is outside this
manual catalogue; do not infer that a new displayed address is monitored.

The existing Wallet page has its own portfolio-snapshot effect and account
reads. They are not caused by the Deposit modal and remain unchanged. Browser
evidence lists all page requests separately from the catalogue's requests.

## Verification

See `docs/qa/manual-deposit-catalogue/README.md` and the dedicated
`Manual deposit catalogue` CI workflow. All addresses and balances in screenshots
and tests are synthetic. No production account was used for these tests.
