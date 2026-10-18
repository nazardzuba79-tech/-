# History20 as a price source for the native Futures TEST account (review seam)

This answers the CTO's final scope correction on PR #544 (2026-10-18). History20 is a **price-path input**, not a new trading system. The existing native Futures TEST account keeps its orders, demo balance, margin, fees, funding, journal and replay. This seam only chooses where the **price** of one model contract comes from.

**Terminology.**
- **Private pricing-scenario selection:** an owner chooses a saved History20 window draft as the price path of a private model contract.
- **Public listing publication:** a different thing. It stays refused by `checkPublishable` (`HISTORICAL_RIGHTS_UNVERIFIED`), and the selection refuses a published listing.

**Status.** Code-only, **wired nowhere**. Production construction (`privateTrading.ts`) is unchanged, so no live account sees any of this. No migration, deploy, balance or flag change.

## The exact path: existing source → selected trajectory → existing engine

```
Admin → Listings draft (Worker Durable Object)            existing
   └─ ListingStore.list()  (Render's client, read only)   existing: src/services/listings/store.ts
       └─ loadHistory20Selection(store, listingId)        NEW: parseListingConfig re-validates schema, logs checksum, scenario
           └─ History20PriceSource                        NEW: simulationFor(listingSimulationConfig(draft)), the same model the Admin preview and listing chart read
               └─ withHistory20Prices(market, …)          NEW: Proxy around PrivateTradingMarketData; only the model contract is routed
                   └─ NativeDemoService                   existing, unchanged: HISTORICAL_DEMO contract
                       └─ engine / replay / journal       existing, unchanged
```

The engine is unchanged. How each market read is answered:

| Engine read | Call site | For the model contract `<SYMBOL>SIMUSDT` | Every other contract |
|---|---|---|---|
| `historicalDemoPrices` | `service.ts` `demoCurrentPrices`: entry, CLOSE, REFRESH, limit pass | model price of the last completed 10 s tick. Timestamps ≤ now. It passes `assertHistoricalDemoCurrentPrice` | venue, unchanged |
| `marks` | `service.ts` valuation | same model mark | venue, unchanged |
| `history` | `historyCache.ts` → replay bars: funding boundaries, entry marks | **closed** 1m/5m/15m/60m model bars only (trade = mark). A forming bar is refused (`history20_not_closed`). No provider funding: the engine's own schedule applies | venue, unchanged |
| `instrument` | `service.ts` OPEN, sizing, rules | the injected contract; **none defined** → `history20_contract_undefined` | venue, unchanged |
| `freshQuote` | LIVE_EXECUTION book | refused `history20_no_book` (no depth is invented) | venue, unchanged |
| `resolveCandle` | candle-selected entry | refused `history20_candle_source_unsupported` | venue, unchanged |
| `chartCandles` | terminal chart | refused `history20_chart_source_unsupported` | venue, unchanged |
| `funding` | venue funding | refused `history20_no_venue_funding` | venue, unchanged |

With no selected window, `withHistory20Prices` returns the original market object.

**How Buy/Sell executes on the model, all through the existing HISTORICAL_DEMO rules.** These are proven in the tests below.

- **Manual Buy/Sell.** A LIMIT at or through the model price fills at once at the model price (`NEAR_LIVE_DEMO`). The demo margin is reserved and the fees are charged by the engine.
- **Insufficient demo margin.** Refused (`INSUFFICIENT_DEMO_MARGIN`) before any write.
- **Resting LIMIT.** It reserves demo margin. Cancel releases it. It fills when a later model price reaches it, via REFRESH or the limit pass.
- **TP/SL.** Both fire on the model mark. Realized PnL is the engine's own.
- **Funding.** At the 8 h boundary it settles on the model bar's mark (`MARK_SETTLEMENT`).
- **Retry.** The same `idempotencyKey` returns the first result. A different body with the same key is `idempotency_conflict`.
- **Restart.** A new price source and service on the stored account replay to the same outcome.
- **Venue isolation.** The model contract never reaches the venue: no quote, ticker, history or candle call. A venue contract run through the seam gives exactly the same account as without it.

## Files

- `src/private-trading/native/history20Prices.ts` (new): selection, price source, seam.
- `src/private-trading/__tests__/nativeHistory20Prices.test.ts` (new): 9 tests. Wired into `.github/workflows/private-trading.yml`.
- No existing source file changed.

## Wiring (follow-up Draft, stacked on #549)

The owner and CTO decision of 2026-10-18: reuse the approved Futures terminal, and change only the price path.

**Off by default.** With `NATIVE_HISTORY20_PINS` unset, `index.ts` passes the collector market itself. Production behaviour is unchanged until the owner sets a pin.

**Pins (server only).** `NATIVE_HISTORY20_PINS` is a JSON array of `{listingId, symbol, draftRevision, logsSha256, listingAt, intrabar}`.
- A pin is served only while the stored draft is exactly the pinned one: same revision, checksum, start and model version. Otherwise its contract answers `history20_unavailable`. It never falls back to another path or to the venue.
- An invalid variable means no pins at all, and is logged by name only.

**One market, four sites.** `history20Market(...)` wraps `PrivateTradingService.market` once. So the owner terminal, the tester routes, the withdrawal projection and the background limit pass all read the same pinned path.

**Draft freeze.** `guardHistory20Listings` refuses saving or publishing a pinned listing (`409 HISTORY20_PRICE_PATH_IN_USE`) while any `NativeDemoAccount` row or `NativeDemoRevision` mentions its contract. Revisions are immutable, so once a contract has traded, its path is frozen.

**Model contract (test-only, `provider: 'voltex-model'`, `parameterModel: 'VOLTEX_HISTORY20_TEST_CONTRACT_V1'`).** These values are **an owner decision to confirm before activation**:

| Parameter | Value |
|---|---|
| tick | 1e-8 (model prices carry 8 significant figures) |
| quantity step and minimum | 0.01 |
| minimum notional | 5 USDT |
| leverage | 1–10× |
| risk tier | one: initial 10%, maintenance 1% |
| fees | the engine's standard demo profile (taker 0.055%, maker 0.02%) |
| funding | the native fixed schedule |

`parameterVersion` records the pinned path (`history20-test-v1:<scenario>:<model>:<logs sha16>:r<revision>:<start>`), so every journaled entry names the path it used.

**Buy/Sell.**
- **New entry, MARKET or LIMIT.** The server sets HISTORICAL_DEMO for a model contract, so the terminal sends what it sends for any contract.
  - A MARKET entry needs no candle. It executes at the sampled model price, journaled as a reducing MARKET already is (`point` = last).
  - A venue contract still needs its candle (`HISTORICAL_ENTRY_REQUIRED`). A model MARKET needs a quantity.
- **After entry:** Close, cancel, resting LIMIT and TP/SL follow the existing rules.

**Chart.** `chartCandles` serves the listing chart's own series, labelled `VOLTEX_HISTORY20_MODEL`. Volume is modeled. Nothing is served after now.
- The private candle routes accept that source.
- A label that does not match the data is refused (`chart_source_mismatch`), and only after authorization is rechecked.

**Model list.** `GET /private-trading/native/models` lists the served model contracts with their provenance and current model price. The list is empty without a pin.

**Withdrawal gate.**
- `nativeWithdrawableRows` holds back the positive net realized result (price, fees, funding) of History20 contracts from the settle asset, read around the valuation.
- Losses still reduce it.
- Venue contracts and accounts without model trades are unchanged; this is pinned by tests.

**Terminal (no redesign).** Same chooser, chart, order form and positions table. For a native Futures TEST account:
- `/native/models` adds the served model pairs (`VHXTSIM/USDT`) to the existing market chooser, tagged «модель».
- A model pair stays selected only while it is served. Venue pairs resolve as before.
- The chart reads `/private-trading/candles?source=VOLTEX_HISTORY20_MODEL` and refuses any page under another label.
- One note («History20 · модель») is shown over the chart. On a phone it takes its own line.
- The venue-candle trading menu is hidden for a model pair.
- Nothing is subscribed or asked of a venue for a model pair:
  - no book or tape;
  - no `/futures/mark-price` (which reads Kraken); the shared mark is the model price, from a source `lib/history20Models` registers with `useFuturesMark`.
- The ticket's last price is the model price, so MARKET and LIMIT work from the ordinary form.
- Three new translation keys in 7 languages: `futures.history20Badge`, `futures.history20Short`, `futures.history20Hint`. They are additions only, listed in the digest guard and placed apart from #543's keys.
- The audited `FuturesPage` and `FuturesPairList` fingerprints are re-taken, with the reason recorded.

**Browser QA** (`scripts/qa-history20-native-browser.cjs`, 1440 and 390, wired into `native-demo-qa.yml`). It runs on the isolated review server with `NATIVE_PREVIEW_HISTORY20_QA=1`: a synthetic window, fixture venue, every other origin aborted.
- The model pair is in the chooser, with its tag.
- The chart reads the model route and shows the note.
- MARKET Long 20 and MARKET Short 10 from the ordinary ticket both fill at the model price.
- The Short closes from the positions table.
- No venue route is asked about the model, no real-account endpoint is called, and there is no horizontal overflow.

Evidence: `docs/qa/history20-native-20261018/` (synthetic data only).

**Still open before activation (owner decisions):**
1. Confirm or change the test-only model contract parameters above.
2. Confirm the withdrawal hold, then set a pin (`NATIVE_HISTORY20_PINS`) on Render. That is a configuration change, not done here.
3. The order form's leverage ceiling comes from the venue `/futures/config` (up to 100×). For a model contract the server refuses above 10× (`INVALID_LEVERAGE`). Capping the ticket by the contract would be a form-logic change; it is not made here.
4. Bots: API-key bots cannot reach the native engine (JWT only). The smallest hook would be an authenticated, allowlisted API-key route onto `/private-trading/native/commands` for owner and test accounts only. It is not built here, and nothing implies it works.
5. Rights stay `HISTORICAL_RIGHTS_UNVERIFIED`. Model contracts are private (owner and test accounts), never a public listing.

## Exact missing hooks and blockers (not improvised)

1. **No model contract is defined.**
   - The engine needs tick, quantity step, leverage, risk tiers and fees for the model contract (`instrument`).
   - `PrivateInstrument` has literal `provider: 'bybit'`, `contractType: 'LinearPerpetual'` and `parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS'` (`marketData.ts:23-34`), so a model contract cannot be described honestly today.
   - **Needed:** the owner's contract parameters, and a model provider value in a type kept separate from the collector schema (the collector path must stay strict).
   - The tests use a clearly marked test-only contract.
2. **MARKET entry.**
   - HISTORICAL_DEMO requires a selected candle for a new MARKET entry (`HISTORICAL_ENTRY_REQUIRED`, `service.ts` `historicalDemoAttempt`).
   - The candle source is the literal `BYBIT_LINEAR` in four places: `routes.ts:17`, `service.ts:51` (`NativeCandle`), `replay.ts:41` (`NativeCandleRef`), `marketData.ts:47-49`.
   - **Today** a model entry is a marketable LIMIT.
   - **Needed:** either a modeled candle source value or a MARKET rule for model contracts. Both touch the journal's candle reference.
3. **Chart.**
   - `chartCandles` and `getChartCandles` (`private-trading/service.ts:134`) carry the literal `BYBIT_LINEAR`.
   - **Needed:** a modeled-candle source with a «modeled» label in the terminal. That needs i18n in 7 locales, and #543 touches every locale.
4. **Terminal symbol entry.** The native terminal lists venue instruments (`useNativeDemo.tsx`, `nativeDemoApi.ts`), so a model contract needs an entry there.
5. **Server wiring and pinning.**
   - The same market must be given at all four construction sites, or resting orders and TP/SL would not fire without a manual REFRESH:
     - `privateTrading.ts:80`;
     - `native/testRoutes.ts:23`;
     - `native/withdrawable.ts:21`;
     - `native/limitPass.ts:70`, the background limit pass.
   - The owner must choose which draft id and how it is configured.
   - **Retroactive price change.** Editing the draft after positions open would change the model path, which is not allowed. The selection carries `draftRevision` and `logsSha256`. The wiring must refuse a change while any account holds the contract.
6. **Bots.**
   - The native engine is JWT-only; API-key bots cannot reach it (`/private-trading/native/*`).
   - Bot orders need their own authorized entry. This is not in scope here.
7. **Withdrawal cap, existing and reported.** Native wallet PnL caps the owner's and test users' real `Withdrawal` requests (`withdrawals.ts:45-142`). Model PnL would raise that cap like any other demo PnL.
8. **Rights.** `HISTORICAL_RIGHTS_UNVERIFIED`. The seam is private only, and no source trajectory is in git.

## Verified locally (exact commit in the PR)

- `nativeHistory20Prices.test.ts`: 9/9.
- **Mutation checks, each caught:**
  - serving the next tick (a future leak): 5 tests fail;
  - sending the model contract to the venue: 5 tests fail;
  - serving a forming bar: 1 test fails.
- All `src/private-trading` suites: 50 PASS, 4 skipped (they need a database). `nativeReviewHarness` passes after `npm run build`; it requires `dist/`.
- Backend `npm run build`: PASS.
- **Not run:** production, a database, the browser terminal (nothing in the UI changed).
