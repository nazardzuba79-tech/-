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
