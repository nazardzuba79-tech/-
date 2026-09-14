# Private trading: activation and review

This feature is a private simulator, initially restricted to one existing owner.
Its tables and actions are separate from real orders, balances, settlement,
withdrawals, public P&L and follower execution. Historical results never become
live demo profits by changing a mode flag.

## Server configuration

`PRIVATE_TRADING_ENABLED` defaults to false. Only the exact string `true` enables
the service. `PRIVATE_TRADING_OWNER_ID` must be the existing user ID resolved by
an operator from `voltex.crypto@gmail.com`; a request or browser-provided email
is never authorization. The user must also currently have ADMIN and an active,
unrevoked session with an unexpired bearer token. Another administrator has no
access. Disabling the flag, revoking the session or removing the role stops
new actions and result/card retrieval, including in-flight historical jobs.

The existing `MARKET_DATA_COLLECTOR_URL` and `MARKET_DATA_COLLECTOR_TOKEN` must
point to the updated collector containing the private market-data routes.
The collector transports public instrument, book, trade/mark candle and funding
data; it receives no private account information. No browser calls Bybit for
private execution. A missing collector or invalid/stale data fails closed.

Apply the additive `20260914093000_private_trading_replay` migration to a test
branch first. The five private tables do not alter production money schemas.
Production migrations and enabling the feature require the normal release
workflow; this change is initially delivered as a review branch, not deployed.

## Owner workflow

1. Sign in to the permitted account. The Futures page shows a small private-mode
   entry only after server authorization. The route is
   `/futures?privateTrading=1`; the URL alone does not grant access.
2. Expand **Выделить демо-капитал**. The displayed source is the actual existing
   `DemoBalance` USDT row. Allocation atomically subtracts that demo balance
   and adds private principal once. It does not create arbitrary capital.
3. In **Сейчас**, select a linear USDT perpetual, Long/Short, isolated leverage
   and quantity or margin budget. Market and Limit have working private
   execution. Preview the server calculation before confirming.
   A live review lasts 60 seconds and freezes quantity, maximum required funds,
   minimum reviewed fill and the displayed 0.05% execution-price bound.
   Confirmation fetches a new eligible quote; it cannot silently increase the
   budget, reduce the reviewed fill or use an expired quote.
4. Positions and orders appear below the native chart. Use the private actions
   for partial/full close, TP/SL, margin edits, cancellation and result cards.
5. Use the compact chart-entry action, select a completed candle and set
   Long/Short, leverage and margin in the nearby form. The candle supplies its
   timestamp and default Close price; no manual date/time or price entry is
   needed. Open pricing and TP/SL belong to the expanded settings. The server
   returns position size, scenario capital, used collateral and free remainder
   before confirmation. Selecting another candle does not allocate a deposit.
   The result defaults to the latest available completed-history boundary and
   retains its visible `asOf`. **Показать вход** focuses its marker, while
   **Закрыть на графике** selects an exit and requires a reviewed close preview.
   Open results advance from their persisted checkpoint, including the bounded
   visible-page refresh; closed results retain their exit snapshot.
6. Open the result-card button beside a position's P&L and choose **Сохранить**.
   The same canvas supplies the preview and PNG. The server supplies every
   financial value; the export retains **Симуляция** or **Исторический тест**.

Historical capital remains in that scenario's escrow, including after closing.
Scenario equity and its isolated profit/loss are shown separately. Version 1
does not return historical escrow to the live demo wallet; there is no silent
capital return and no credit of hypothetical gains. Advancing replaces one
scenario version with an immutable-journal extension, rather than adding an
alternative run's profit a second time. Historical experiments are excluded
from the live wallet's P&L totals and all public performance.

A chart-close revision may choose an exit earlier than the last valuation.
It reuses that scenario's held capital, preserves the previous full result in
an immutable revision audit and keeps the entry, pricing/risk profile and
actual creation timestamp unchanged. It does not reserve another deposit,
release hypothetical gains or update public Copy Trading. Concurrent changes
invalidate the preview through its saved scenario version. Legacy next-open V1
scenarios continue with their original model; the new selected-point V2 entry
is explicit rather than a reinterpretation of an old requested timestamp.

Private chart history is served by the owner-protected `/private-trading/candles`
endpoint with `source=BYBIT_LINEAR` and bounded pages. Its access check requires
the same current owner ID, ADMIN role, feature flag and session as financial
actions. Cancellation propagates to the provider when the client disconnects.
Entry/exit selection is resolved again on the server, and the replay's finer
trade/mark history must match that same linear perpetual contract. Exact OHLC
pricing is not an assertion of historical order-book availability. Missing or
ambiguous paths stay unconfirmed; no validation gate is relaxed for chart entry.

## Explicit limits

- Linear USDT perpetuals, isolated margin, Market/Limit only in this private
  execution engine. Existing public terminal forms are retained unchanged.
- At most four concurrently active contracts and 20 combined live positions
  and entry orders. Multiple positions may use the same contract. This pilot
  bound lets one risk cycle refresh all active contracts together. A failed
  source is skipped individually; invalid entry orders cannot undo another
  position's valid risk update. Every committed batch rechecks freshness.
- Data range at most 90 days and 50,000 candles. The service uses 1-minute bars
  up to 30 days and 5-minute bars beyond that; UTC event alignment matters.
- One heavy history job per owner; bounded provider pagination and caches.
  Pending jobs are persisted and can resume after process restart. The initial
  operator service is intended for one backend instance; it is not a
  distributed task queue.
- The entry-fixed risk/fee model and historical assumptions are documented in
  [private-trading-model.md](private-trading-model.md). Incomplete or ambiguous
  history is a draft, never a verified profitable outcome.
- A quote older than five seconds cannot execute or liquidate. Missing live
  valuations display a dash. A loss during a gap is isolated from real funds.
- Without a verified USDT/USD conversion snapshot, the USD equivalent is a
  dash; USDT is not silently declared to be exactly USD.

## Isolated review environment

The current local QA script is **intentionally pinned** to the dedicated Neon
test branch `codex-private-trading-replay-20260914` / `br-spring-salad-ax6wgel4`.
It rejects every other database host. Do not change that guard to production.
It binds only to `127.0.0.1`, checks Host/Origin, exposes the private routes only,
and proxies a small allowlist of public GETs without forwarding credentials.

After building backend/frontend and configuring the ignored test `.env`, run:

```powershell
node scripts/qa-private-trading.cjs
```

Open `http://127.0.0.1:4220/__qa/start` on the same computer. This creates a
test-branch session for the pinned owner, stored only in an ignored local
runtime file. It is not a production login link or a public preview token.

The PostgreSQL integration suite requires `PRIVATE_TRADING_DB_TESTS=1` and the
exact allowlisted test host. Ordinary full-suite runs skip these remote writes.
Tests create uniquely identified fixtures on the isolated branch and do not
delete or overwrite existing users or real financial records.
