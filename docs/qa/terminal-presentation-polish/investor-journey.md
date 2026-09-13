# Exchange journey audit fixes — 2026-09-13

Same draft PR #66, `codex/terminal-presentation-polish`. Main fetched at start: `e2f22451e75b29baba4e3f2c4ec667886b688a90`. Ordinary merge commit: `e82eee53bbf44205398bf1d3c600769f31c82eb2`. No conflicts, merge to main, deployment or financial submission.

## Implemented

- Futures catalogue, header and bottom tape use exact linear-perpetual reference rows from the existing shared public SSE. Spot prices cannot substitute for perpetuals, especially scaled contracts such as 1000PEPE. Stale/unavailable/invalid rows remain unknown.
- Futures depth uses the selected exact USDT perpetual through the public linear WebSocket. Snapshot/delta identity, timestamp, sequence, decimal and crossed-book checks run before atomic application. No Spot fallback. Updates coalesce at 300 ms; stale connections clear and reconnect with backoff; hidden tabs disconnect. This is reference depth, not a change to VOLTEX matching or execution prices.
- Changing Futures symbols resets draft fields and discards old price picks. Backend execution membership and every financial handler remain guarded.
- CFD conditional price fields use the instrument quote currency (JPY for USDJPY), independently of USDT collateral. Additional order families remain presentation-only as requested.
- Failed/unloaded Spot balances and order counts show unknown rather than zero. Markets uses actual freshness metadata instead of unconditional just-updated copy.
- Profile retains approved Arctic content with shared exchange navigation. Five conditional order tabs fit the compact ticket without wrapping at 1440 px.
- Local QA public-route allowlist now includes parameterized mark/funding and CFD candle reads. Private reads and all writes remain blocked.

## Validation

- Frontend TypeScript and production build: PASS.
- Full frontend candidate: 80 suites, 1305 tests; **1234 passed, 71 failed**.
- Pristine exact-main frontend baseline: 77 suites, 1259 tests; **1182 passed, 71 failed, 6 pending**.
- Exact new failure names versus main: **none**. Candidate suite startup errors: none. Known baseline failures remain; this is not an all-green suite. Backend/collector full suites were not run for these frontend changes.
- Added 14 exact-contract quote tests and 12 depth protocol/lifecycle tests. Updated existing component-loader dependencies and intentional markup expectations while retaining financial/no-write assertions.
- Browser: BTC to ETH clears price/quantity; no horizontal overflow at 1440; all five form tabs fit. Live BTC and 1000PEPE perpetual depth rendered, including sub-cent precision. Native TradingView retained and rendered.
- CFD USDJPY OCO shows JPY on all three price inputs; 1440 layout has no horizontal overflow. Profile shared navigation verified.
- Registration form rendered at 1440 and 390; mobile form width 348 px and no horizontal overflow. No account was created, no terms accepted and no end-to-end registration success is claimed.
- Futures at 390: native chart and all five form tabs render, no horizontal page overflow.

## Evidence and review limits

Screenshots alongside this file: investor-futures-1440.png, investor-futures-390.png, investor-cfd-1440.png, investor-settings-1440.png, investor-registration-1440.png, investor-registration-390.png.

Local preview: `http://127.0.0.1:4210/__qa/start?market=futures`. This machine-only review deliberately blocks private account reads and financial writes; account unavailable states and the account WebSocket reconnect banner in these captures are expected. Production account functionality cannot be inferred from this harness.

This audit does **not** certify a fully operational exchange. Existing unresolved items include illustrative Copy Trading performance, marketing/product claims needing substantiation, some remaining English/implementation copy outside the terminals, profile activity failure displayed as an empty history, and unverified long-tail Spot zero quotes. Existing CFD local-paper behavior, read-only Options, execution-listed Futures subset and presentation-only Stop/TP/OCO remain. Do not represent these as completed real-money features to investors. All sections remain accessible; none was hidden to mask incomplete functionality.

Full audit inventory and raw test comparison remain in workspace `outputs/exchange-audit/REPORT.md` and `outputs/investor-journey-comparison.json`. Review actual registration, authenticated balances, deposits and intended execution flows in a controlled authorized environment before making an operational-readiness claim.
