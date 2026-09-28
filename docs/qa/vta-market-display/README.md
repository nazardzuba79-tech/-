# VTA Spot depth, listing transition and percentage controls

Implementation: `42c304d49bce6a756c8d76b7c389a3c438fa313a` on existing PR #316. Current-main timer publication `443ec7ab25872d97b5ccb671acc887f4d3b706bf` incorporated by `f4902e536b98c2f337aa15a1ad6e8af000dba76f`; its only difference from the tested implementation tree is the reconciled AI handoff. No change to the 15:00 UTC listing, seed, simulation price path, trading rules, fee policy or accounting.

## Reproduced defects

1. New API regression failed on the original head: live VTA book expected `available:true`, received `false`; all three routes hardcoded empty depth and tape. TradePage also excluded VTA from book loading.
2. SELL percentage labels inherited `.slider-step.active.sell` red track backgrounds. The more specific shared presentation override now keeps them transparent; all five percentage selections have computed transparent backgrounds, with existing gold text preserved.
3. Visual inspection caught mobile depth clipped after asks: a `display:block` override broke the shared flex book and an old 440px cap hid bids. The existing mobile book now uses its intended flex layout/height. Browser assertions count **unclipped** rows, not just DOM nodes.

## Exact generation rules

- Pure display depth, computed only when requested; no database, financial writes, timers, workers or external venue calls. Three routes share `testMarketDepth`. Before listing (including unarmed assets via effective server time), both sides are empty and unavailable.
- Live book: 25 bids and 25 asks. Best bid is the existing canonical `priceAt(serverTime)` rounded **down to 10 decimal places**, exactly the MARKET SELL price rule. Price step is `max(0.0000000001, ceil10(bestBid * 0.0002))`; best ask is `bestBid + 2 * step`. Each deeper bid subtracts one step; each deeper ask adds one. Approximate spread: 4 basis points.
- Quantity: `(80 + level * 28) * (0.8 + seededRandom(seed, 'display-depth', tickBucket, side, level)() * 0.4) / levelPrice`, rounded down to 8 decimals. This creates bounded variation and generally larger size deeper in the book. Bucket = floor((serverTime - listingAt) / 10 seconds); same seed/bucket returns identical depth and timestamp.
- Tape: newest 100 **completed** canonical 10-second ticks (bounded to 500 internally), reconstructed through the existing candle tick generator. Price uses the existing 8-significant-figure rounding; quantity is the canonical tick base volume at 8 decimals; quote volume is that tick's existing quote volume. BUY/SELL follows price relative to the preceding canonical tick/boundary. Timestamp = listingAt + completedTickIndex * 10 seconds. No future ticks; at the exact listing instant there are zero completed prints, first print after 10 seconds. Existing OHLCV generation is unchanged.
- Ordinary Spot currently has no trade-tape UI. The populated `/market/external/trades/VTA-USDT` API is verified; no new tape panel was invented.

## Browser and accounting evidence

Production frontend bundle, actual test-market router plus actual VTA/native services, disposable **localhost PostgreSQL**. Owner production account is never used. Server clock is controlled only by the isolated QA harness.

| Check | Result / evidence |
|---|---|
| Listing without reload | PASS at 1440 and 390. Document sentinel preserved; timer disappears, chart canvas/ticker appear, book populates, standard SELL/MARKET becomes ready. Existing financial scenarios also execute a partial sale immediately after this no-reload transition. |
| Depth | PASS: at least 10 unclipped asks and bids, positive sizes/depth, bid < ask, visible spread, changed values on next server tick, identical response after reload at frozen tick. |
| Routing | PASS: VTA transport test verifies VOLTEX API URL, prelisting response and error propagation with **zero external fallback calls**. Browser captures zero external VTA requests. Ordinary Kraken/edge path unchanged. |
| Click price / unsupported operation | PASS: standard book row fills LIMIT price; attempting unsupported VTA LIMIT refuses with zero financial POSTs. |
| Percentages | PASS at both widths, 0/25/50/75/100: transparent button backgrounds; existing slider and exact max quantity retained. |
| Standard form parity | PASS at both widths for all 10 side/order-type combinations against ordinary Spot; no VTA-specific design. |
| Accounting / recovery | PASS: exact partial/full debit/USDT proceeds; shared native cash, VTA exclusion, no real-ledger changes; lost response, 429, timeout, reload, late 401/session switch, concurrent tabs, no oversell/dust. |
| Customer copy | PASS: `body.innerText` on trade/markets/wallet before AND after listing, both widths; all forbidden English/Russian terms absent. Captured text files are included. |
| Public listing | PASS at 1440/430/390/360/320, zero writes, page errors and horizontal overflow. |
| Tests | **474 PASS / 0 FAIL / 26 suites**, unique tests; full repository Jest not claimed. Exact per-suite counts in tests.json. |
| Types/build | Backend noEmit, frontend `tsc -b`, production Vite build PASS. Existing >500 kB bundle-size advisory remains. |

One Chromium screenshot protocol failure occurred before product assertions; a clean rerun passed. Two obsolete test contracts were corrected: old 14:00 timer expectation to approved 15:00, and old VTA-book exclusion to gated local depth. No accounting assertions were removed.

Machine evidence: [market-display.json](market-display.json), [vta-browser.json](vta-browser.json), [public-listing.json](public-listing.json), [tests.json](tests.json).

| Width | Before listing | After listing | Percentages |
|---|---|---|---|
| 1440 | [before](before-trade-1440.png) | [after](after-trade-1440.png) | [SELL](percentages-1440.png) |
| 390 | [before](before-trade-390.png) | [after](after-trade-390.png) | [SELL](percentages-390.png) |

Markets/wallet before/after screenshots and exact rendered-text audits are in this directory.

## Files changed

- `src/services/testMarkets/testMarketDepth.ts`, `testMarketSimulation.ts`: pure depth and completed tick reader.
- `src/api/routes/testMarkets.ts`: three shared depth routes, tape, consistent ticker bid/ask.
- `frontend/src/lib/spotPublicMarket.ts`: VTA-only local transport, no external fallback.
- `frontend/src/pages/TradePage.tsx`: listing-gated visible-tab book refresh at 10 seconds for VTA; ordinary 60 seconds preserved.
- `frontend/src/pages/trade-terminal/ProfessionalTerminal.css`, `TerminalMobileParity.css`: percentage fill and mobile clipping fixes.
- `src/services/testMarkets/__tests__/testMarketDepth.test.ts`, `src/api/routes/__tests__/testMarkets.test.ts`, `frontend/src/lib/__tests__/spotPublicMarket.test.ts`, `testMarkets.test.ts`: regression contracts.
- `scripts/qa-vta-demo.cjs`: actual boundary/DOM/routing/copy/regression evidence.
- `.github/workflows/test-markets.yml`, `vta-demo.yml`: run new tests in existing CI.
- `docs/AI_HANDOFF.md`, this evidence directory: factual handoff and review evidence.

Merged (PR): **NO**. Deployed: **NO**. Production data changed: **NO**. Owner VTA allocation changed: **NO**. Owner VTA sale executed: **NO**.
