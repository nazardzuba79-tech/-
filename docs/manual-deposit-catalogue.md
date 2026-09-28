# Manual receiving-address catalogue — review implementation

This change is **not activated in production**. Default builds continue to use
the existing TreasuryWallet-backed Admin and Deposit flows. No production
addresses, database records, platform settings or deployments were changed.

## Storage prerequisite / intentional stop

Inspection of the four existing `workers/*/wrangler.toml` files found no KV,
Durable Object, R2 or D1 persistence binding. The market-edge configuration
explicitly states “No KV / DO / R2 yet.” The email workers have service/email
bindings and rate limiters, not a suitable persistent configuration store.
No Cloudflare account inventory connector is available in this session; this
finding concerns the project's wired configuration, not every resource that
may exist in the account.

Following the owner's fallback instruction, this PR delivers the store
interface, server-only Cloudflare HTTP adapter and mock-backed tests. It does
**not** provision or implement/deploy a new storage Worker. Missing storage
returns 503; it never substitutes temporary files, process memory, localStorage,
Git commits or PostgreSQL as production persistence.

Minimal proposed follow-up configuration (requires separate authorization):

1. One Cloudflare Worker endpoint, e.g. `/receiving-address-catalogue`, bound to
   one SQLite-backed Durable Object namespace/class and a single named object
   `voltex-receiving-addresses-v1`. Use its persistent storage API for one JSON
   document plus revision. No alarms, cron, queues, blockchain calls or Neon.
2. A server-to-server bearer secret on both that Worker and the backend.
   Backend environment keys: `DEPOSIT_CATALOGUE_STORE_URL` (HTTPS endpoint) and
   `DEPOSIT_CATALOGUE_STORE_TOKEN` (secret, never a VITE variable).
3. The endpoint contract below, including atomic conditional writes. Plain KV
   read/modify/write is insufficient for concurrent administrators/instances.
4. A verified, one-time snapshot of **all currently resolved legacy addresses**
   in `baseline`, including TreasuryWallet overrides. Do not seed from env alone.
   Compare every existing asset/network/address with the owner before enabling.
   This PR contains only synthetic addresses, not an export of production.
5. Only after verifying persistence, CAS, restart and baseline parity, build
   with `VITE_MANUAL_DEPOSIT_CATALOGUE=true`. This initial enablement requires a
   frontend release; subsequent Admin address edits require **no redeploy**.

Cloudflare documents SQLite-backed Durable Objects on the Workers Free plan:
<https://developers.cloudflare.com/durable-objects/platform/pricing/>.
KV is not intended for atomic read-modify-write transactions:
<https://developers.cloudflare.com/kv/concepts/how-kv-works/>.
No paid service was created or selected.

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
responses). Other API instances revalidate within the TTL. No stale-on-error
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
