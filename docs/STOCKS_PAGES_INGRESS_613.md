# Stocks #613 — Pages → Hetzner, zero-activation review

## Checked source and authority

2026-10-24, fresh main `98261cc80117e0961f8ebca84499ec2cb3f0e3b4`, Claude #613 `794ee0311a899234c33f70cb019898680f4fc6d8`. This is an isolated Codex follow-up branch, **not a push to Claude's branch**, merge, image build or deployment. Coordination: https://github.com/nazardzuba79-tech/-/pull/613#issuecomment-6380235971. Delivery exact SHA/CI receipt belongs in the linked PR comment; do not mistake the checked parent for this patch's head.

Parent #613 checks were 32 success, 1 skipped, 1 genuine unsupported-SQLite revocation failure. Not all-green; that unchanged red control is not a PG acceptance substitute. This patch does not repair, hide, weaken or rerun that legacy control, the prior broad PG/Docker audits or the 50+2 load.

## Read-only live evidence (not inferred from repository files)

| Control | Observed result |
| --- | --- |
| Pages project | Production Git root `frontend`, command `npm run build`, destination `dist`; active custom domain `voltextech.net` |
| Auth API build origin | **`https://api.voltextech.net/api/v1`**, preserved exactly; never change to relative `/api/v1` |
| Current frontend | `a7593324be9118cfda91ee8fc6bad0b6ff3acba9`; Git production auto-deploy OFF, preview policy none |
| Existing edge routes | Zone Worker routes list empty; existing Worker custom domains are market, KYC, notifications and support, not the app origin |
| DNS/origin rules | DNS record and zone-ruleset GETs denied HTTP403 with current authorization: **NOT_VERIFIED**. Active Pages domain is not evidence of all DNS/origin rules |
| Pages Functions settings | Runtime compatibility date `2026-09-09`, flags empty; fail-open **true**; no Stocks runtime bindings configured |
| Hetzner actual ingress | Active host Nginx, API TLS vhost proxies the existing loopback-published API container; no Stocks location in the inspected included config. Repository Caddyfile is NOT the active proof |
| Private gateway | No 4437/4438 listening sockets and no Stocks service observed; neither port published by inspected production containers |
| Host executable | Host Node **absent**. A host-process Node22 launch cannot be assumed; container and host loopbacks are different namespaces |
| API | Healthy immutable image `sha256:10e66b427b7941fc49335a7fc251c55e6c93a0415e45897f2518798c6e5acc7a`, release guard `89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`, StartedAt unchanged `2026-10-23T16:30:07.172147327Z`, restarts0 |
| Stocks API/provider flags | `STOCKS_CATALOGUE_ENABLED`, `STOCKS_TEST_CASH_ENABLED`, `STOCKS_ORDER_EXECUTION_ENABLED`, `STOCKS_MARKET_DATA_ENABLED` unset/OFF; Pages Stocks build flags unset/OFF |

Only existing authorized Cloudflare GETs, Docker metadata, Nginx file metadata/directives and socket/executable metadata were read. No IP, account/zone ID, secret value, identity or financial row is part of this public receipt. Detailed sanitized local receipts are in ignored `output/`. No configuration write/reload, SQL, account or financial operation occurred.

**Current request topology:** browser → active Pages app origin. There is no verified functioning Stocks relay to the private gateway. Separately, the API hostname reaches host Nginx → current API container. DNS/ruleset permission gaps prevent claiming a complete live edge topology; lack of a private Stocks listener independently prevents claiming a working catalogue chain. No drawn line below is represented as an existing production deployment.

## Chosen narrow source-only route

```text
Browser https://voltextech.net/__stocks_global/*
  ordinary VOLTEX bearer + per-view/CSRF headers; no second login
      │
      ▼
Pages Function (frontend/functions/__stocks_global/[[path]].js)
  default OFF; strict app URL/Host/Origin; read/lease allowlist only
  strip Cookie, authority, CF/forwarded headers; no auth-result cache
  fresh transport HMAC + timestamp + one-use nonce; never JWT_SECRET
      │ HTTPS, exact API hostname, no redirect following
      ▼
Existing api.voltextech.net host Nginx (UNINSTALLED location example)
  /__stocks_global/* only → host 127.0.0.1:4438
  explicit header allowlist, no X-Forwarded-*/Forwarded/Cookie
      │
      ▼
Existing hosted-ingress, same host network namespace
  transport verifies API Host, app Origin, MAC, body, timestamp, nonce
  only then translates Host to app → unchanged exact-origin validator
      │ internal Host/Origin translated only by existing private adapter
      ▼
Existing 127.0.0.1:4437 PG-only Stocks Gateway
      │ existing internal authority adapter; gateway key stays server-only
      ▼
Internal API → existing JWT/session/user/revocation → PostgreSQL authority
```

No public access to the private listener is added. An unsigned direct request to the API location cannot bypass the Pages boundary. A signed request is **not** user authentication: the existing API checks the ordinary JWT signature/session again for every read. The gateway key, JWT_SECRET and principal bindings are never put in Pages or frontend. Direct public `/api/v1/stocks-test-cash*` is blocked by the example vhost while the gateway uses the private API endpoint; normal `/api/v1/auth/*`, `/api/v1/me`, Spot/Futures and `VITE_API_URL` remain unchanged.

### Why Pages Functions, not another Worker

The verified Pages project root already matches `frontend/`. One file-based Function plus path-only `_routes.json` needs no new Worker service, DNS custom domain, durable storage, R2, database or paid plan. A separate Worker would require another service and an explicit zone route/config lifecycle. Neither choice bypasses the DNS/ruleset visibility gap, provider licensing or capacity gate.

Cloudflare documents file-based Functions and `_routes.json` at https://developers.cloudflare.com/pages/functions/routing/. Scope is **only** `/__stocks_global/*`; static pages and auth API are not sent through the Function. This is not a promise of zero request cost or unlimited quota. Functions consume the account's existing execution allowance; observe quota and obtain approval before any plan change. Current fail-open=true is NOT changed: a future scoped fail-closed setting must be owner-approved and read back before release. The private MAC check remains closed even if Pages fails open to static HTML; the frontend treats non-JSON as unavailable, never a price.

### Exact defaults and limitations

- Canonical visibility stays **`VITE_STOCKS_CATALOGUE_VISIBLE`**, unchanged. `VITE_STOCKS_ORDER_EXECUTION_ENABLED` and server `STOCKS_ORDER_EXECUTION_ENABLED` remain OFF. No alias/second visibility scheme.
- Pages transport gate `STOCKS_PAGES_PROXY_ENABLED` is new and literal default OFF. It requires exact HTTPS `STOCKS_PUBLIC_ORIGIN`, distinct HTTPS `STOCKS_API_INGRESS_ORIGIN` and a dedicated 256-bit `STOCKS_EDGE_TRANSPORT_KEY` secret binding. The Node adapter has a separate default-OFF `STOCKS_PAGES_INGRESS_ENABLED`. Neither enables catalogue, data, financial authority or execution.
- **No production secret was created.** This missing, separately provisioned transport credential is a release blocker, not a request to paste a secret into chat. Never reuse JWT_SECRET or STOCKS_TEST_CASH_GATEWAY_KEY. Local tests use a conspicuous public synthetic fixture key only.
- HMAC binds method, exact path/query, app/API origins, authorization, per-view/CSRF fields and empty-body hash. 10s skew, one-use nonce; bounded 2048-entry cache refuses admission instead of evicting a live nonce. Cache is process-local: no distributed/restart-persistent replay claim. Exactly one ingress process is the reviewed plan; replicas require a new reviewed replay fence. JWT revocation is never cached.
- GET catalogue/state/history/portfolio and DELETE lease only. All order/cancel/balances/refresh requests are refused at edge and signed ingress regardless of accidentally enabled downstream finance. The existing financial capability remains in the PG implementation, but this transport cannot activate it.
- Cloudflare may insert X-Forwarded-For/Proto; those fields are discarded and cannot select identity/origin. Forwarded, X-Forwarded-Host, unknown forwarding fields or browser-supplied edge proof are rejected. At Nginx, all unlisted request headers are dropped; at Node, unexpected forwarded headers are rejected.
- No data rights means existing `createReleaseMarket({})`: unavailable rows/null display, no quote/candle fallback and no provider requests. `DATA_RIGHTS_UNVERIFIED` is not solved by this relay or by reachable public APIs.

## Namespace / image plan — not instantiated

Host Node is absent, and current API is in a Docker network namespace. Do not point host Nginx at a different container's 127.0.0.1. The explicit future choice is **one reviewed Node22 gateway/ingress image in host network namespace**, with the existing Node22.23.3 release guard and only loopback listeners. `deploy/stocks-pages-gateway.compose.yaml.example` is deliberately not auto-loaded: inactive profile, no restart, no ports/volumes, read-only filesystem, UID1000, dropped capabilities and no-new-privileges. It requires a reviewed immutable image digest and separately approved private env file. No image/unit was created or started here; no host Node install is proposed in this task.

The private authority URL must point to the existing loopback-published API service, NOT its public TLS authority path, and pass the unchanged PG readiness proof. Include all transport modules in the reviewed release archive/image; verify Node22 module closure, release SHA guard and API module preservation before release. Current API89c3ac00 is not this #613 candidate. The sample is a topology decision, **not** Docker/image/capacity acceptance or permission to start a service.

## Isolated reproduction and evidence boundary

Install the existing root/frontend and `workers/market-edge` lockfiles; use pinned Wrangler4.148.0 only as a temporary build tool. Compile the real Pages folder:

```sh
wrangler pages functions build frontend/functions --project-directory frontend \
  --outdir output/pages-worker --output-routes-path output/pages-generated-routes.json \
  --compatibility-date 2026-09-09
node --test services/stocks-global/edge-transport/transport.test.mjs \
  services/stocks-global/hosted-ingress.test.mjs services/stocks-global/execution-off.test.mjs
node --test services/stocks-global/edge-transport/pages.workerd.test.mjs
```

Local Windows: unit/HTTP contract and real workerd use an explicit HTTP origin stand-in; **Nginx/TLS and real PG locally NOT_RUN** (not installed). This Miniflare version rewrites Host to its local listener even when dispatch URL is HTTPS. The test-only outer wrapper reconstructs the public Host from that URL before invoking the unchanged Wrangler-compiled Pages router; it changes no auth/proof/origin behavior. Independent unit tests retain forged-Host rejection. This emulator detail must not be hidden as production proof.

Focused `.github/workflows/stocks-pages-ingress-review.yml` uses Node22.23.3, the existing locked Worker tools, actual workerd + **real Nginx TLS**, pinned synthetic CA/SNI verification, the exact uninstalled Nginx location example, existing gateway and actual compiled PG router. Only DNS/TLS destination is mapped to the isolated local fixture; no external hostname/provider is contacted. Normal password login, both principals and viewer, invalid/mismatched JWT, logout/revocation, no-rights catalogue, all denied financial methods and unchanged financial rows are asserted. A dedicated disposable `stocks_disposable_*` database and matching confirmation are required; absence is NOT_RUN locally and forbidden to pass as a CI skip. This is new-chain acceptance, not a repeat production SQL audit.

CI also runs existing actual-GlobalStocks silent-submit/route/API contract suites, backend and frontend builds. Earlier #613 browser evidence is inherited, not relabeled as a new production browser test. No costly50+2 or legacy SQLite workload is in this workflow. Final exact-head results must be read after push; parent checks are not this patch's CI. Tests never seed a real account or change production balances/orders.

## Capacity / admission plan ONLY — DO NOT RUN

After explicit owner approval, use exactly50 independent synthetic viewer sessions plus2 formerly admitted principals in isolated, representative hosting. Financial/frontend execution gates stay OFF; both principals' BUY/SELL remain NO-OP. Replay normal visible-client read cadence, chart/lease lifecycle and tab pause, not an unbounded synthetic flood. Use paired crypto-only baseline and crypto+Stocks windows with identical versions/cache/warm-up/measurement plan. For EACH agreed Spot/Futures critical endpoint, require `p95_with_stocks / p95_baseline <= 1.05`; also record CPU/RSS, event-loop lag, error rate, PG connections, auth calls, request queues, cache/quotas and freshness. Require zero financial row/order/receipt deltas and no public private ports. Refused admission must be bounded/unavailable, never fake prices. Freeze the exact load envelope/duration/resource budget with the owner first; no p95 or52-session PASS exists in this task.

## Release / rollback gates (future separate approval)

1. Claude reviews/reconciles the two small ingress/launcher hook changes; preserve #613 PG-only authority, canonical visibility, all OFF protections, provider adapters and unsupported-SQLite red control. Merge is NOT authorized here.
2. Obtain read-only DNS/ruleset visibility or approved equivalent proof; review existing API WAF/origin rules and confirm public authority blocking does not affect private readiness/auth. Current 403 observability gap is a blocker, not proof that a dashboard route is missing.
3. Independently approve/materialize a Node22 immutable candidate, its closure/guard/rollback and host-network security/resource budget. Reuse accepted backup/migration/binding evidence; if an actual required DB change is pending, get its separate approval. Do not run generic migrate deploy here.
4. Separately provision/verify the dedicated edge transport credential in Pages and the private gateway environment (not VITE); verify clocks/single-instance replay contract. No credential/resource was provisioned in this work.
5. With explicit release approval, install only the reviewed API-host Nginx locations and private unit; verify no private port is externally reachable and exact API/Host/Origin/JWT/proof rejection. Keep provider/financial/frontend execution OFF. Enable the catalogue API gate only after PG readiness is met. Check ordinary auth at the EXISTING full API URL.
6. Approve/read back scoped Pages fail-closed; publish exact Function/route artifact with transport initially OFF, keep VITE_API_URL unchanged. Then separately enable transport and canonical visibility for no-data read-only smoke. Existing frontend auto-deploy stays OFF until separately instructed.
7. No provider activation before legal confirmation and no capacity claim before the approved50+2/p95 run. No trading activation is included at all.
8. On failure: edge transport OFF and catalogue visibility OFF; return to prior approved Pages version/runtime config; stop ONLY the new private unit and restore/revalidate the saved API-host Nginx location if installed. Keep current API/Worker/auth origins untouched. Use the pre-approved immutable API rollback only if that separate API release was involved. Never restore whole PG over newer financial operations, reset balances or rewrite history.

## Remaining confirmed blockers

**NO-GO for production:** DNS/ruleset observability; current fail-open policy; transport credential not provisioned; no reviewed Node22 image/host-namespace unit; actual #613 API/catalogue PG readiness and permitted ingress not released; no live hosted same-origin auth acceptance; no data display/redistribution licence; no approved52-session/p95 evidence. This bounded task supplies source and isolated tests only. All production flags/config, API/image, balances, listings, Spot/Futures/Workers remain unchanged.
