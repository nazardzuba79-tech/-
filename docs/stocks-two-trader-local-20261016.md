# Stocks: two-trader local review, 2026-10-16

This note describes the PR #528 candidate and local fixture boundary. It does not certify production readiness, capacity, real identity binding or live funding integration. The final commit and exact-head CI are reported separately; earlier green CI is not inherited for these runtime changes.

## Local validation, 2026-10-16

Source parent is `186b80bebd9ab31ad22aa269e9077744fbbaa32f`. Fresh `main` is `2e7acf158000404133db85723bac13695215e25c`; its newer KYC/Admin/API/schema changes were inspected, not merged into this narrow review branch.

| Check | Actual result |
| --- | --- |
| Full frontend Jest | 275 suites, 4,400 tests PASS; 0 skipped/failed |
| Global simulator, account, authorization and preview tests | 206 PASS; 0 skipped/failed |
| Final fixture Wallet and pagination revision | 5 PASS; 0 skipped/failed |
| Viewer UI authorization/no-op regressions | 14 PASS |
| Local staging, package closure and review scheduling guards | 32 PASS |
| Exact workflow transition, review selection and backend offline/admission guards | 63 PASS |
| Frontend TypeScript and production build | PASS; existing chunk-size warning retained |
| Linux backend/browser/CI | Exact-head results required separately; Windows is not a substitute |
| Strict capacity and crypto coexistence | NOT CLEARED; historical FAIL retained |

Browser verification used only labeled local synthetic fixtures. Alpha: 731.25 USDT, buy 0.1 at 100.1, partial and full sell at 100, final cash 731.24 and realized PnL -0.01; a 0.1 limit at 90 reserved 9, then cancellation released the reservation. Beta independently bought and closed 0.1, retaining 129.865 USDT. Page reload and process restart retained the ledger and history. The dedicated fixture Wallet then showed alpha cash/available 731.24000000 and reserve 0.00000000 from that same ledger.

Viewer submit with empty and valid input, plus Sell, produced no mutation request or fake result; the complete observed network interval contained four GETs and zero POSTs. Width checks at 320/360/390/430 px found no page-wide horizontal overflow. The pre-existing floating support button touches the mobile ticket edge; global/mobile styling was deliberately not changed in this Stocks authorization patch.

Local preview: `http://127.0.0.1:4452/__stocks_fixture/`. It denies external network/financial writes and labels every fixture surface. Its dedicated Wallet is a read-only fixture projection, **not** the real `/wallet` or a production `DemoBalance` adapter. Non-admin real Wallet integration remains unresolved. Ephemeral fixture login must be selected again after server restart, while financial fixture state persists.

This interactive helper exposes two instruments and three identities (alpha, beta, one viewer). Fifty viewer sessions in this helper are not fifty different users. The distinct-principal HTTP regression creates fifty viewer identities separately. The helper alone does not constitute the twenty-instrument acceptance stand. Its synthetic hub counters count method calls, not external provider HTTP requests; the fixed `externalRequests` fixture field is not independent network-egress evidence. Worker SQL metrics are snapshots, not OS CPU/fsync measurements. The interactive database contains trades and must not be presented as a pristine seed; an external acceptance harness needs its own verified initial ledger and closed-file hash.

Final handoff review found and fixed a fixture-only pagination unit error: the API's exclusive `before` cursor is milliseconds, while candle timestamps are seconds. The regression checks 1m, 15m and 1D pages, including exact boundaries, forty older candles, no overlap and no missing boundary candle. Real provider history code was unchanged.

The final HTTP authorization recheck rejects revocation or identity changes during body/quote awaits. A revocation occurring after that recheck and worker admission has no shared commit-time revocation epoch yet; do not claim atomic authorization revocation through COMMIT.

## Scope and unchanged constraints

The owner's current acceptance target is 50 read-only viewers plus exactly two explicitly permitted test traders. Viewers may use the catalogue, quotes, chart and forms; their submit actions make no financial request or success/error imitation. Backend authorization must reject a direct forged mutation. This does not replace the historical fifty-active-trader stress results with a PASS.

Continue the existing Stocks engine, Professional B UI, exact quote DTO, order rules, FIFO/precision, reserves, idempotency, FULL SQLite durability and commit-before-ACK. No replacement matching engine, invented real quotations, reference-price substitution, provider-limit increase or freshness relaxation is included. MOEX/SBER remains blocked. Binance/Bybit redistribution rights remain unconfirmed.

No merge, deploy, public routing activation, production load, live balance changes, production migration, new server or paid operation is authorized by this local review. Do not repeat the 24-hour sampler or run the previously blocked Actions experiment.

## Trusted identity and existing accounts

The authenticated CLI requires:

- `STOCKS_ACCOUNTS_DATA`: the explicitly selected isolated test-account database.
- `STOCKS_IDENTITY_ENDPOINT`: the trusted identity authority endpoint.
- `STOCKS_IDENTITY_ISSUER`: the configured issuer of that authority.
- `STOCKS_TRADE_PRINCIPALS`: JSON with exactly two distinct full `{ "issuer": "...", "subject": "..." }` pairs.
- Optional local listener/build settings: `STOCKS_GLOBAL_PORT` and `STOCKS_GLOBAL_DIST`.

The server validates a principal returned by the trusted session adapter; a subject matching under a different issuer is not the same authorization. The CLI no longer treats `STOCKS_TRADE_OWNER_SUBJECT` as sufficient. Do not put real identifiers, tokens or emails into this document, screenshots or public artifacts.

The two permitted accounts use `existingOnly`. They must be present before the service handles trading. Missing account binding fails with `ACCOUNT_NOT_BOUND`; it does not create 10,000 USDT, refill an account or reset a prior ledger. The restricted balance-adjustment endpoint is blocked. Viewer market reads avoid account registration, financial projection reads and matcher commands. Viewer state is an empty response projection, not a funded account.

### Two integration blockers remain distinct

1. **Private identity and balance binding:** the actual trusted issuer/subject pairs for the two people and their corresponding authoritative existing test balances have not been established by this fixture implementation. Synthetic identities cannot prove that binding. No live records were read or changed to construct the preview.
2. **One authoritative test-cash store:** the existing Wallet test-cash source and the Stocks SQLite ledger are not yet connected by a proven transactional adapter. The current fixture's Wallet response reads the same synthetic Stocks ledger; it does not implement or certify a `DemoBalance`/production Wallet bridge.

The required bridge should perform all cash, reservation and order effects in the **existing test-cash authority**, preferably within one transactional boundary. A stable authenticated principal and intent ID must resolve one account and one idempotency receipt. Validation, available-cash check, cash/reserve updates, execution/position/history updates and the audit journal must commit together before success is acknowledged. Replay returns that receipt rather than executing twice; failure must leave no unpaired debit or reservation. Sell proceeds return to the same test-cash account. A crash after commit but before response must be recoverable through that receipt.

Do not implement the bridge by copying an already spendable Wallet balance into a second independently funded SQLite balance. If mapping or migration is required, first verify it on synthetic copies, preserve provenance and history, and keep live transfer disabled. Test cash and Stocks valuation must never enter real deposits, withdrawals, funding, collateral or native Spot/Futures accounting.

**Auth-to-commit residual:** authorization is checked per request, but the root executor still owns the focused review/fix proving that a revoked or switched session cannot commit a previously queued financial intent. Do not infer that proof from a login test, successful build or static allowlist alone. Final evidence for this boundary is pending this note's publication.

## Reproducible fixture preview

Requires the existing repository dependencies and a Node runtime supporting the repository's `node:sqlite` implementation. Run from the repository root using PowerShell. These commands are local only; they do not install services or deploy.

```powershell
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
$env:VITE_STOCKS_SIMULATOR='false'
$env:VITE_STOCKS_GLOBAL_SIMULATOR='true'
$env:VITE_STOCKS_OWNER_USDT_ONLY='true'
$env:VITE_API_URL='/api/v1'
$env:VITE_MARKET_EDGE_URL='http://127.0.0.1:4440'
npm.cmd --prefix frontend run build -- --outDir dist-stocks-two-trader

$stocksPreviewRoot=(Get-Location).Path
node scripts/stocks-two-trader-preview.mjs "--data-dir=$stocksPreviewRoot/output/voltex-stocks-two-trader-review" "--dist=$stocksPreviewRoot/frontend/dist-stocks-two-trader" --port=4440
```

The `output` parent directory must already exist. Choose another free explicit `--port` if necessary and build with the matching local market origin. `--stocks-port` and `--authority-port` can pin the internal loopback ports; omitted values use free ephemeral ports. The default gateway port is 4440. The preview helper exports `startTwoTraderPreview` for the root browser/test executor; it returns `origin`, `stocksOrigin`, `accountsPath`, audit counters, `close()`, `accountMetrics()` and a fixture-only price control.

Open `http://127.0.0.1:4440/`. The fixture landing offers alpha, beta and viewer. Its login endpoint creates an ephemeral fixture bearer session and writes the actual frontend `exchange_token` key. It does not accept arbitrary subjects, issuer, role or `canTrade` flags from the browser. The existing trusted `identityResolver` still checks every Stocks request against the local authority.

Alpha starts with **731.25 test USDT**, beta with **129.875 test USDT**, and each has zero fixture USDC. These are deliberately distinct synthetic fixture values, not the real users' balances. The helper provisions the two ledgers once in a new staging directory, closes them and atomically publishes the dedicated fixture directory. A restart uses the existing ledger without reseeding cash, positions, orders, reserves or history. Sessions expire/revoke separately from durable financial history. The third identity never receives a paper ledger.

`dataDir` must be absolute and its basename must match `voltex-stocks-two-trader-*`. `fixture-only.json` identifies the fixture schema and synthetic seed identities. An unrecognized marker, missing/symlinked ledger or second `preview.lock` rejects startup. After an unclean shutdown, do not casually delete a lock: first establish that the owning process/listeners are absent and retain all ledger data. Initialization failures leave their isolated staging artifacts for inspection rather than silently resetting them.

The page banner and landing explicitly label all quotes, candles and identities as **LOCAL FIXTURES**. Only AAPLX and NVDAX fixture IDs are provided. This limited preview does not claim twenty live instruments or exercise real providers. The gateway, authority and Stocks service listen only on `127.0.0.1`; exact Host/origin checks and same-origin CSP prevent external connections, frames and funding routes. Native/Spot/Futures financial endpoints are denied. The Stocks commands reach only the local test service through the existing local proxy.

The read-only fixture `/api/v1/demo/vta` seam reads the selected Stocks ledger's cash and reservations. It marks its response `fixtureOnly`, `fixtureCashSource=SAME_STOCKS_SQLITE_LEDGER`, and `liveDemoBalanceBridge=false`. Its one-to-one fixture USD valuation is explicitly a synthetic test convention, not a claim about USDT/USD parity. This seam is useful for Buy → Wallet → reload → Sell verification, but is **not** the production Wallet integration or an extra spendable account.

Focused helper tests are authored at `scripts/stocks-two-trader-preview.test.mjs`; the root executor runs and records them. This note does not mark them PASS or claim final browser/CI results.

## Performance: measured diagnostic and code-derived request budget

The root's bounded Windows diagnostic used 50 viewers across 20 symbols, an injected fixture quote delay of 50 ms and the same 3-second HTTP deadline. It measured:

| Observation | Result |
|---|---:|
| Successful responses | 6 |
| `SOURCE_BUSY` responses | 44 |
| p95 response latency | 80.65 ms |
| Hub quote calls / maximum concurrent quotes | 2 / 2 |
| Financial queue delta | 0 |

This confirms that removing viewer account work does not by itself remove the distinct-instrument quote-admission limit. It is a Windows diagnostic with synthetic responses, **not** a Linux capacity qualification or a successful 50-viewer + 2-trader acceptance run. It does not supply missing CPU/RAM/throttling, p99, coexistence or real-provider measurements.

The unchanged frontend polls state every 3 seconds and latest history every 15 seconds. Server quote reuse is under 2 seconds. Per-symbol ticker responses and the shared USDC conversion are cached for 15 seconds; latest history is cached for 10 seconds. Healthy, aligned polling across all 20 US catalogue symbols (13 Binance + 7 Bybit), with one timeframe and no extra pagination, implies the following attempted steady-state upstream work:

| Source operation | Binance requests/minute | Bybit requests/minute |
|---|---:|---:|
| Native last-trade/order-book observation | 260 | 140 |
| Per-symbol ticker | 52 | 28 |
| Latest candle history | 52 | 28 |
| Shared USDC conversion | 4 | 0 |
| **Total** | **368** | **196** |
| Existing per-hostname rolling-minute limit | **100** | **100** |

These are arithmetic estimates from the current request paths, not measured sustained throughput. The limiter and two-instrument admission gate reject work before those successful totals can be reached. Even without history, quote demand is 316 Binance / 168 Bybit requests per minute. Same-symbol viewers can share requests; different-symbol native observations cannot be merged into one current request without changing the adapter/contract. Staggered requests, pagination, provider failures or extra trader observations may increase the work.

Cold metadata/catalogue discovery adds five shared calls: two Binance, two Bybit and one MOEX security-list lookup (which does not enable MOEX trading). Initial exact quotes for twenty symbols require forty native/ticker calls plus one shared FX call; twenty first-history pages add twenty more. The total is **66 cold calls** if admission is serialized sufficiently and every source succeeds. The unchanged history scheduler admits two active plus eight queued jobs with a two-second waiting deadline; an immediate twenty-unique-history burst can also reject work.

No sixty-second reference-price substitution, fabricated executable bid/ask or FX, altered READY status, larger provider allowance or modified TTL is authorized by these findings. Preserve the original strict stress FAIL evidence and crypto p95 degradation threshold of at most +5%. The old 0.05 vCPU / 256 MiB experiment is a test budget, not the full CX23 capacity. Final targeted acceptance, matched crypto coexistence, Linux resource proof and CI results remain to be recorded by the root executor; no current production-capacity PASS follows from this document.
