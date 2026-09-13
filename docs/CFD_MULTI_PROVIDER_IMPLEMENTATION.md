# CFD Multi-Provider — admission-first implementation

Status: **DRAFT / shadow foundation, not an activated multi-provider production feed**.
Baseline freshly read: `54d7eea3fbac0f566d4c27e2cf99e7214cc20558` (2026-09-13).
Owner authorized implementation, NOT merge/deploy. Re-fetch main before every review, change and PR operation. Preserve PRs #51, #54, #55 and current homepage work. PR #50 remains separate; #52/#53 are not dependencies.

## Implemented in this change

- A bounded, synchronous, reference-only quote router with admission-by-evidence, exact contract/currency/unit/kind matching, per-instrument failover, delayed failback, source/receipt freshness and conflict quarantine.
- Current data is null when unavailable. Historical data is separately labelled `lastKnown`. Valid zero and negative reference observations are not missing values. Decimal strings are preserved. No averaging, fabricated spread or order book.
- A date-only daily observation retains `observationDate`, with `sourceTimestamp: null`; no invented end-of-day timestamp.
- Independent-source reporting uses explicitly verified upstream lineage, not vendor count. EIA and FRED delivery of EIA count as one underlying source. Unknown lineage does not count.
- 31 deterministic Node tests, with test fixtures clearly isolated from runtime.
- A bounded, credential-free public probe and PR CI for backend/frontend builds, existing CFD tests, new router tests and public endpoint samples.

**No production code imports this module yet.** No runtime providers, account entitlements or execution approvals have been enabled. Existing CfdMarketDataService, risk gates, routes, accounting, balances, margin, liquidation, database, collector and frontend are unchanged. Local standalone strict TypeScript compilation and all 31 router tests passed; full repository CI and live probes must be read from the actual workflow results, not inferred.

## Source admission research (official sources, checked 2026-09-13)

- Gold API: https://gold-api.com/docs and https://gold-api.com/llms.txt document XAU/XAG/XPT/XPD and public current-price endpoints. The instructions request a 30-second response cache. https://gold-api.com/terms permits commercial web/mobile display but forbids abuse/multiple requests per second and provides no accuracy/uptime warranty. Thus probes are serialized with a pause. Never treat the marketing phrase "no rate limits" as permission to flood. Underlying spot/futures methodology and suitability for our financial pricing remain unverified; no execution admission.
- EIA/FRED: https://fred.stlouisfed.org/series/DCOILWTICO and https://fred.stlouisfed.org/series/DCOILBRENTEU are separate daily WTI/Brent observations, USD/barrel, not tick feeds. EIA API documentation https://www.eia.gov/opendata/documentation.php requires a free individually registered key. EIA direct is not probed without that key. Both delivery paths share EIA lineage.
- TraderMade: https://tradermade.com/docs/restful-api documents live currency/CFD delivery and authenticated symbol discovery. Its bid/mid/ask data must not be renamed as a provider last-trade price. Account sample, exact commodity contract mapping, quota and public redistribution/pricing rights are pending. No provider-specific commodity aliases are guessed.
- OANDA: https://developer.oanda.com/rest-live-v20/pricing-ep/ documents account pricing and a stream. Account instrument availability, contract mapping and redistribution/pricing agreement are pending. A broker account is not a license for another public exchange.
- Capital.com: https://open-api.capital.com/ documents an authenticated API. Demo quotes are not admissible production quotes; broker-specific CFD contracts require semantic verification and rights. No admission.
- Twelve Data: the current repository catalog names 13 supported instruments, independently of account entitlement. https://twelvedata.com/pricing-business distinguishes internal access and external-use plans. Existing key configuration is not evidence of all permissions. Keep it as a candidate, never as the sole hardcoded selection.

Public documentation is NOT a successful API sample. An HTTP 200 is NOT redistribution or execution permission. The development container cannot resolve external hosts; web-tool API reads also failed. The PR workflow runs the public probe from a GitHub runner and preserves real results (including errors), rather than inventing them. A runner result still does not prove Render-region reachability or session stability.

## Coverage and candid admission matrix

All rows require two independently verified compatible live sources before claiming live redundancy. None is claimed admitted by this PR.

| Current symbol | Existing candidate | Additional candidate / evidence required | Separate public reference |
|---|---|---|---|
| XAUUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: mapping + account + rights | Gold API XAU, indicative pending basis verification |
| XAGUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: mapping + account + rights | Gold API XAG, indicative pending basis verification |
| XPTUSD | Twelve Data, verify account | Registry discovery required; support not assumed | Gold API XPT, indicative pending basis verification |
| XPDUSD | Twelve Data, verify account | Registry discovery required; support not assumed | Gold API XPD, indicative pending basis verification |
| WTIUSD | Twelve Data, verify account | Registry/contract discovery; spot != expiring futures != cash CFD | EIA/FRED DCOILWTICO, daily only |
| XBRUSD | Twelve Data, verify account | Registry/contract discovery; Brent != WTI | EIA/FRED DCOILBRENTEU, daily only |
| EURUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| GBPUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| USDJPY | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| AUDUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| USDCAD | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| USDCHF | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |
| NZDUSD | Twelve Data, verify account | TraderMade/OANDA/Capital: account + basis + rights | None admitted |

## Remaining implementation gates (do not claim done)

1. Capture authenticated instrument registry and sanitized samples from the selected live candidates. Record provider symbol, exact contract/expiry/roll rule, quote kind, currency/unit, event-time precision, sessions/timezone, latency/age distributions, quota per operation and current rights evidence. Keep unknowns null. Never expose secrets in reports, query strings in logs, artifacts, chat or commits.
2. Finish actual network adapters only for admitted mappings; place them in the existing collector, not browser polling and not a new paid service. One connection/budget owner per key; warm backup within its licensed quota. Shared keys across staging/production/replicas require coordination or separate keys. Do not double-spend via old and new services.
3. Fix current request budgeting carefully. CfdMarketDataService currently clamps limits with Math.min(8, ...) / Math.min(800, ...). At 8 credits/minute, 800/8=100 minutes of sustained usage, not a measured outage diagnosis. Use verified plan limits, rolling daily pacing, reserve for existing risk, per-symbol/permission failures distinct from transport failure, and retry/backoff accounting. Preserve usage across restarts or start conservatively; do not let a restart reset shared quota. Never auto-upgrade a plan or bypass limits.
4. Add an opt-in shadow service. Separate display/reference observations from CfdQuoteSource financial observations. Current financial consumers require lastDecimal and strict live timestamp/entitlement checks; a mid/bid/ask-only source cannot silently satisfy that model. Any pricing-model change is a separate explicitly approved migration. Default execution stays fail-closed; missing new-position approval must not itself disable valid close/risk quotes.
5. Integrate read-only frontend output after data admission. GOLD/OIL stay English; oil must state Brent vs WTI, daily vs live and source date. Preserve current homepage/terminal design and native TradingView. No fictitious changes, candles, trades or order book. Quote metadata may be expandable but must remain available. Daily references never enter orders, margin or liquidation.
6. Test shared cache/single-flight, provider timeouts, 429/401/403, session close/open, stale timestamps despite heartbeat, source jumps, reconnect storms, quota exhaustion, malformed decimals, unsupported symbol isolation, restart and clock skew. Calibrate divergence thresholds per contract; the router defaults are test/shadow defaults, NOT validated trading thresholds. Old daily revisions with the same date currently fail closed; define a documented revision policy before activation.
7. Staging soak must cross a live market session and deliberately disable each admitted provider. Include memory/CPU, request budgets, failover timings, p95/p99 age, source-switch reasons and independent-source coverage. No positions or DB writes just to test quotes. Do not simulate success with test fixtures.
8. Re-fetch main/head, inspect combined diff, obtain owner merge approval, merge only with expected head SHA, and verify actual Cloudflare/Render successful deployment and visible prices. PR success alone is not deployed success.

## Reproduce tests and probes

After normal repository dependency installation and `npx prisma generate`:

```sh
npm run build
node --test scripts/test-cfd-reference-router.cjs
node scripts/probe-cfd-reference-providers.cjs
cd frontend && npm run build
```

Probe output is an evidence artifact, NOT a production cache/config. No secret-backed provider is probed by this script. Do not confuse a successful probe job with all sources being reachable; inspect each sample's HTTP/schema/freshness/error fields.
