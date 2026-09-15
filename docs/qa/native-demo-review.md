# Native owner-only Cross demo — review notes (PR #83)

Isolated review only. Not merged, not deployed to production.

## What the owner gets inside the existing `/futures`
- `Real | Demo` switch at the top of the trading panel (owner + current ADMIN + live session + server flag only).
- Demo keeps the same VOLTEX chart, market list, reference book, ticker and layout; only the account source changes.
- Market / Limit, Long / Short, leverage, TP/SL (add, change, remove, partial quantity, Mark or Last trigger),
  add-to-position with weighted entry (live positions), partial fills from observed depth, cancel,
  partial/full manual close, fees (taker 0.055 %, maker 0.02 %), custom funding, account-level Cross liquidation,
  positions / orders / position history / executions+funding tables, frozen P&L card.
- Historical trades: pick a candle on our chart → Long/Short, margin, leverage, Market/Limit, optional TP/SL →
  position, entry marker and P&L appear immediately → close now (current depth) or on a later candle.

## Model (server-authoritative, BigNumber; every figure comes from one persisted revision)
- **Cross**: equity = wallet + unrealized P&L of all positions; liquidation when equity ≤ total maintenance
  margin (tiered MMR at Mark + closing fee), all positions closed together. Per-position liquidation price is an
  estimate for that contract's Mark with other contracts frozen; `—` = unreachable with current collateral
  (e.g. 5–10k margin at 10–20x on a multi-million demo deposit), or contract fully hedged.
- **Funding (custom demo model, not Bybit history)**: Long `-0.001`, Short `+0.004` = signed fraction of position
  value per 8h UTC settlement (−0.1 % / +0.4 %). Values unchanged from the owner's latest numbers.
- **Historical path**: every candle is the assumed path Open → Low → High → Close (simulation, never a claim of
  real past fills). Resolution by age at calculation time: ≤ 7 days 1m, ≤ 45 days 15m, older 1h.
- **Historical Limit on the selected candle**: Buy fills if Low ≤ limit, Sell if High ≥ limit. Already marketable
  at the candle open → filled at the open as taker. Otherwise filled at the limit (maker) at the moment the
  assumed path reaches it. Not reached → the order rests from the candle close and can fill later.
- Historical entries are separate positions (own marker, P&L, card); they never merge into a live position.
- Limit of 6 contracts with simultaneous exposure.

## Persistence and consistency
- `NativeDemoAccount` (live row, optimistic revision) + append-only `NativeDemoRevision` (DB trigger forbids
  UPDATE/DELETE). Idempotency key + request hash per command; same key never executes twice.
- A canonical checkpoint (all complete bars before the last closed minute) is stored with the live row. Live
  commands and refreshes continue from it, so already-shown outcomes are never recomputed away. A backdated
  (historical) command re-simulates the whole scenario from its time.
- A TP/SL/liquidation triggered by a live quote is journaled as an `OBSERVE` instruction, so a later replay
  cannot reopen it.
- Only consumed order-book levels are stored with a live command (no 1000-level snapshots per revision).
- Plain 30-second refreshes are not persisted unless something happened or the checkpoint is ≥ 15 min old.
  Opening a P&L card for an open position first persists a fresh revision; the card is reloaded by revision.
- Demo funds come once from the existing `DemoBalance` USDT. No real Wallet / Futures / Banking / Card / order
  book / matching table is read or written by this module (verified in the real-PostgreSQL test).

## Verification in this branch
- `src/private-trading/__tests__/nativeDemoEngine|nativeDemoReplay|nativeDemoService.test.ts`,
  `nativeDemo.integration.test.ts` (real PostgreSQL, migrations applied), `src/api/routes/__tests__/nativeDemoAccess.test.ts`,
  `frontend/src/lib/__tests__/nativeDemoFrontend.test.ts`.
- `scripts/qa-native-demo-browser.cjs`: real `/futures` page + real service, fixture market, desktop 1440 and mobile 390.
- `scripts/check-native-demo-preview.cjs`: end-to-end API check of the deployed isolated preview (waits for the
  pushed commit, requires actual public mainnet market data).

## Known limits
- Liquidation executes at the modeled Last price at the boundary crossing (no insurance fund / ADL model).
- Funding uses the Mark at each 8h boundary of the assumed path.
- Replays of very old scenarios are slower (history is fetched window by window from the collector).
