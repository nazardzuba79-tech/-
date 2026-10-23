# Stocks #611 — code-only completion, not production release

Reviewed bases (fresh fetched 2026-10-23): main `98261cc80117e0961f8ebca84499ec2cb3f0e3b4`; #611 `d8720915be455849025d2f46404564f46862f0b7`; #609 `ecd5bf92383ded971852547b606ee2b586f85de3`; #610 `9095d9d78ac0e7a3ce7955df5cb7439890674ca1`. No edits/pushes to Claude branches; coordination: https://github.com/nazardzuba79-tech/-/pull/609#issuecomment-6372504973.

## Shipped safety delta

- Actual `GlobalStocks`, not only `StockOrderPanel`: `VITE_STOCKS_ORDER_EXECUTION_ENABLED === 'true'` independently gates every `act`, order intent, submit, position sell, cancel, balance and quote-refresh command. Default OFF leaves BUY/SELL clickable and Market/Limit/quantity/price editable. No validation/error/success notice or storage mutation due to submit. Read-only permitted account presentation is separate.
- Actual `/__stocks_global/*` server: `financialEnabled=false` by default; CLI sets it only from exact `STOCKS_ORDER_EXECUTION_ENABLED=true`. OFF rejects financial POST with HTTP 403 `ACCOUNT_TRADING_DISABLED`, even for both admitted principals, before touching the financial authority. OFF also disables financial GET observations/background matching. API's independent #593 command gate remains unchanged.
- Existing execution acceptance fixtures explicitly opt in. This does not change production configuration or remove the real PostgreSQL acceptance tests. New PG test leaves the API gate ON in a disposable database and gateway OFF to prove independent rejection and byte-equivalent cash/accounts/receipts/audit.

## Actual local evidence

Run `scripts/qa-stocks-hosted-silent.cjs` against a hosted-flag build with execution OFF. It launches the built App/AuthPage/GlobalStocks in actual Chromium and loopback HTTP, with synthetic session and quote fixtures. It does NOT establish production authentication, provider rights or PostgreSQL acceptance.

- Viewer, stale-admitted Alpha and Beta (`canTrade=true`), each 1440/390: all four Market/Limit BUY/SELL combinations; mouse, real keyboard Enter and repeated clicks; zero financial UI POST, unchanged inputs/notices/storage and finance hash; financial authority never accessed.
- Normal VOLTEX Login UI, protected-route redirect, real catalogue/chart, actual Nav logout, new login and reload: 6/6 PASS. Direct forged HTTP: 12/12 rejected 403. No page exceptions. External fonts/CDNs were deliberately blocked and recorded, not treated as successful provider tests.
- Six screenshots and full sanitized HTTP trace/report: `docs/qa/stocks-hosted-silent/` (CI artifact `stocks-hosted-silent-browser`). No credentials/request bodies in trace. Mounted actual component: 26/26; full selected frontend/API contracts: 65/65. Backend and default-OFF/hosted frontend builds PASS (existing large-chunk warnings retained).
- Broad local gateway tests: 276/277 PASS; one confirmed existing SQLite pre-COMMIT revocation regression FAIL, also reproduced unchanged on main. Separate two-principal HTTP execution acceptance: 4/4 PASS excluding the prohibited 50-viewer load test. Do not report the broad suite green. Do not use SQLite financial execution for a hosted release. Real PG CI is authoritative and must have zero skips; local PG is NOT_RUN (no disposable local server), not substituted with these fixtures.

## Funding CI diagnosis (no Futures financial code change)

Original cancelled Native job: https://github.com/nazardzuba79-tech/-/actions/runs/39997422866/job/120564807646. Downloaded run-log ZIP and exact step 16: 1920/1440 PASS; 390 expected 5 funding boundaries but recorded 4. Later Limit-close step was cancelled; cancellation is not a Funding PASS.

Funding script, fixture server and financial sources were identical between #611 and main. Running the original script on both at simulated CI UTC start `2026-10-23T18:00:09Z` reproduced 4-vs-5. The three cases accumulate 34h each; width 390 ends in 00:00's **forming** boundary minute. `replay.ts` deliberately uses only complete boundary candles; `/live` revalues without settlement and advances display `asOf`. The test wrongly assumed that display time implied the just-started minute was already settled. This is a QA-clock defect, not evidence to change funding rates/account math.

Fix: use the EXISTING forward-only `/qa/clock` fixture lever once before scenarios, anchoring five minutes after the next four-hour boundary. Subsequent 34h steps stay outside forming boundary minutes. Every original settlement-count, quantity × mark × rate, version, no-duplicate, PnL and ledger assertion stays intact. All 1920/1440/390 engine and browser checks PASS at the reproduced problematic start. Production clock, replay and financial sources unchanged. Exact-head Native CI must still complete.

## Precise integration with Claude — do not mechanically merge

| File | Confirmed conflict | Future resolution |
| --- | --- | --- |
| `App.tsx` | #609 uses catalogue visibility alone and conditional hosted auth; #611 uses separate enabled+hosted flags and unconditional route auth | One computed visibility contract used by routes and header. Preserve ordinary `RequireAuth` for both Stocks routes; no second login |
| `StocksPage.tsx` / `stockHostPolicy.ts` | different hosted flag names and host helpers | Keep one `shouldMountGlobalStocks`; local fixture remains literal 127.0.0.1, hosted never inherits a simulator |
| `vite.config.ts` | #609 `CATALOGUE_VISIBLE`; #611 `HOSTED_PILOT` plus stricter route and no-origin checks | Canonical `VITE_STOCKS_ENABLED && VITE_STOCKS_HOSTED_PILOT`. Transitional `CATALOGUE_VISIBLE` may alias visibility ONLY, never execution; reject simulator/widget/cross-origin combinations, not weaken #611 checks |
| `HeaderDropdown.tsx` | #609 ORs catalogue flag directly into nav | Same canonical visibility calculation as App; no independent menu-only activation |
| `GlobalStocks.tsx` | #609 forces hosted USDT and adds comment but retains vulnerable `mayTrade` | Preserve hosted USDT restriction and apply #611 `mayReadAccount`/separate execution gate exactly; retain no-POST mounted+browser tests |
| `server.mjs` | #609 adds branded PG release startup fence but defaults `financialEnabled=true` | Preserve branded PG authority, production startup rejection, 429/auth/session and Node22 work. Override financial default FALSE, CLI literal gate, early 403 and OFF GET/background guards from #611; never replace Claude server wholesale |
| PG fixtures/tests | #609 changes fixture and runtime contracts | Preserve real PG/commit-linearization tests. Explicitly opt execution fixtures in and run OFF test too; never use SQLite acceptance as PG proof |

#610 does not change the five requested frontend files relative to #609; it layers real feed/admission/rights adapters and depends on #609. Preserve these adapters, transport limits, cleanup and rights gates. No new quote API or synthetic hosted fallback is introduced here. Need Claude review of this exact patch before future reconciliation. This is an integration plan, not a claim that unresolved overlapping branches can already be safely merged.

## Read-only production readiness

Existing SSH channel worked. Only Docker metadata, internal GET /health, image existence and Cloudflare GET metadata were read; no repeat PG/Docker capacity audit or SQL writes.

- Production API remains source `89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`, image `sha256:10e66b427b7941fc49335a7fc251c55e6c93a0415e45897f2518798c6e5acc7a`, healthy, RestartCount 0, same StartedAt `2026-10-23T16:30:07.172147327Z`. Internal GET /health 200 reports that exact commit. `VOLTEX_RELEASE_SHA` retained.
- `STOCKS_TEST_CASH_ENABLED` and `STOCKS_ORDER_EXECUTION_ENABLED` unset/OFF. Pages Stocks flags (including hosted/catalogue and new frontend execution) unset/OFF. Pages auto-production-deploy false; canonical frontend still `a7593324be9118cfda91ee8fc6bad0b6ff3acba9`.
- Existing rollback image `sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012` present. Rollback procedure/approval remains unchanged; no restart/rollback exercise performed.
- No running Stocks-named container. Repo `local-proxy.mjs` is deliberately literal-loopback review ONLY, not a production ingress. External probes all received edge/proxy HTTP 403 text rather than application JSON: production same-origin route/auth reachability is **NOT_VERIFIED**, not attributed to successful Stocks authorization.
- Hosted source uses real `MarketHub`/later #610 adapters, not the synthetic browser harness. API accessibility proves no commercial display/redistribution right. Unconfirmed instruments must stay unavailable. Session uses existing VOLTEX bearer and fences, no second login.

## Release blockers / next approved action

**NO-GO for production; code-only Draft.** Reconcile the above overlapping patches after Claude completion; require final exact-head PG/CI/browser acceptance and preserved default-OFF gates. Provision/review same-origin authenticated ingress and loopback/private service without exposing service ports or gateway key. Require approved private PG identity binding, licensing/provider admission and disconnected-feed fail-closed acceptance; reuse previous PG/restore/capacity readiness unless something changed. Legacy SQLite pre-COMMIT failure forbids using that path for hosted finance. Production normal-login/gateway/browser end-to-end remains NOT_RUN, not replaced by synthetic QA.

Only after separate owner release approval: prepare immutable image/SHA guarded API plus rollback, gateway and explicit frontend visibility build; execution stays OFF everywhere, no migrations/finance writes or 50+2 load test under this task. No merge/deploy/TYVN/ECLAVO changes occurred.
