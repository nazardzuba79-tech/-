# Native MARKET command incident — acceptance evidence

Date: 2026-09-19. This is a targeted correctness fix, not a terminal redesign or engine rewrite. No production mutation, merge, or deployment was performed.

## Versions and evidence limits

- Incident deployment: `52dce28e597120c1295800f24073837bff8b7da9` (merged #149).
- Current main and Render backend: `78a5a04fa532c3612020e15964c38649416174cc` (includes visual #150).
- Core fix commit: `ff447d449cc3831961943934199eedfbbe9d7746`; follow-up receipt-timeout protections are in this branch.
- Read-only production account inspection: revision 71, last updated `2026-09-19T14:56:42.924Z`; zero open positions/orders. The production account was NOT repaired manually.
- Historical logs do not contain a correlation ID for the original click. They cannot establish whether that specific POST reached the server or waited behind REFRESH in the browser. Do not claim otherwise.
- Production execution of the fix is NOT verified: the candidate has not been deployed. SQL/API/browser results below use disposable local fixtures.

## Reproduced root defect

A flat historical account advances its replay checkpoint to the current minute. `applyLatestQuotes` returns early with no symbols and used to leave `snapshot.time` at the last historical instruction. The service then appended an empty OBSERVE at that older time, inside the already sealed checkpoint prefix. This invalidated the checkpoint it had just created.

Exact stored production evidence (redacted account copy inspected locally, not committed):

- checkpoint.time = `1789829520000`;
- checkpoint.state.time = snapshot.time = last empty OBSERVE.at = `1789829460000`;
- stored checkpoint digest = `39bd4437d3a9213f2ccd22b165663ee81909c8bb2647ac4af731e78ee4591d36`;
- digest including all 12 journal instructions = `03b5f2e82b1bb63361a82f8ee243e095de67aacc188bcd162744a87bc9e632f1`;
- excluding only the final empty OBSERVE reproduces the stored digest exactly.

Actual replay of that copied row throws CHECKPOINT_MISMATCH. The fallback's first history request is ZECUSDT, `start=1785542400000`, `end=1785888000000`, `intervalMs=3600000` — historical work starting August 1, despite no live exposure. Corrected recovery of the same row completes with **zero history requests** and unchanged financial state.

The old native command/client lanes and fetch/body path had no total deadline. Repeated full-history pagination could block REFRESH and subsequent commands far beyond each individual fetch's timeout. The ordinary `MarkPriceService` BTC timeout at 14:58:09 belongs to the separate legacy Kraken Futures path; native commands use the Bybit collector. That log is not proof of the native request's root cause.

## Fix and request lifecycle

`FuturesOrderForm → NativeCommandLane → nativeDemoApi → /private-trading/native/commands → NativeDemoService.command → repository/market/replay → transactional CAS → response`.

- Observation timestamps now advance to the actual observation time even with no symbols; a new empty OBSERVE cannot invalidate the sealed prefix.
- Legacy recovery is narrowly verified: empty final OBSERVE, flat checkpoint, matching original prefix digest, no execution context, and full canonical state equality after replaying the suffix. Altered fills, journal prefix, or financial snapshot fail recovery. No balance rewrite or bypass of replay validation.
- MARKET still reads a fresh server-side book on demand. It never executes against browser depth. Freshness is rechecked before the final transaction writes, and expiry after writes rolls back the transaction.
- Server pre-commit wall-clock budget: **30s**, including queue wait, instrument/book/mark/history reads, collateral and replay. Read cancellation propagates; late read results cannot write. The financial transaction is never abandoned by Promise.race.
- Existing Prisma transaction has **2s max wait + 10s timeout**; checks before and after writes preserve rollback/CAS. Commit success is returned only after confirmation.
- Browser queue wait: **10s**; an expired queued command never starts later. Network headers AND body: **45s**. Lost response is explicitly unknown, never a fake refusal or permission for automatic resubmission.
- If an idempotency receipt lookup times out, or a known committed receipt cannot refresh collateral, the response is `native_confirmation_unknown`, not “operation not executed.” No duplicate execution.
- Correlation: server-generated `X-Native-Request-Id`, hashed idempotency key, stage/duration, checkpoint recovery/fallback, CAS conflict, confirmation/refusal and HTTP finish/disconnect. Logs exclude credentials, full payloads, account identities and balances.

## Independent arithmetic and E2E

The HTTP acceptance suite uses the real Express route, market-data adapter, Prisma repository, committed migrations and PostgreSQL. Only the market transport is a deterministic local fixture. A fresh service per request exercises persisted state/restart. HTTP actor injection is local test setup; it is not a production login test.

The oracle separately computes weighted entry, entry notional, remaining quantity, leverage, Cross/Isolated margin, taker/maker fees, realized and unrealized P&L, wallet and collateral from actual fills. It does not call the engine's account/P&L calculation helpers. Isolated liquidation is independently computed and rounded to the instrument tick (0.1); Cross position liquidation is undefined here and remains null/`—`, not zero.

For example, LONG `0.002 BTC @ 50000.1`, 3x: notional `100.0002`; opening fee `0.05500011`; mark `50000` gives unrealized P&L `-0.0002`. Cross account initial margin includes the existing close-fee reserve: `100/3 + 0.055 = 33.388333…`. SHORT isolated entry `49999.9`, quantity `0.002`, 3x: posted margin `33.333266…`, liquidation reference `66298.5` after tick rounding. The first oracle pass omitted this rounding and failed; the oracle was corrected to the published instrument tick, not the engine output.

Full numeric server/expected values are in [acceptance.json](acceptance.json). Fees and realized P&L columns there are cumulative; cashflow is realized gross minus the close fee, and wallet starts at 1000 USDT.

| TEST | INPUT | SERVER RESULT | INDEPENDENT EXPECTED | PASS/FAIL |
|---|---|---|---|---|
| Wallet collateral OFF | `{"asset":"ETH","quantity":"0.01","mark":"2000"}` | collateral 1000 | collateral 1000 | PASS |
| Wallet collateral ON | `{"asset":"ETH","quantity":"0.01","mark":"2000"}` | collateral 1020 | collateral 1020 | PASS |
| MARKET LONG Cross | `{"kind":"OPEN","symbol":"BTCUSDT","side":"LONG","type":"MARKET","quantity":"0.002","leverage":"3","marginType":"CROSS"}` | wallet 999.94499989; positions 1 | wallet 999.94499989; positions 1 | PASS |
| MARKET SHORT Isolated | `{"kind":"OPEN","symbol":"BTCUSDT","side":"SHORT","type":"MARKET","quantity":"0.002","leverage":"3","marginType":"ISOLATED"}` | wallet 999.89; positions 2 | wallet 999.89; positions 2 | PASS |
| reload/server restart | `reload` | {"revision":5,"positions":2} | {"revision":5,"positions":2} | PASS |
| partial MARKET close | `{"kind":"CLOSE","quantity":"0.001"}` | wallet 999.962245055; positions 2 | wallet 999.962245055; positions 2 | PASS |
| full MARKET close | `{"kind":"CLOSE"}` | wallet 1000.03449011; positions 1 | wallet 1000.03449011; positions 1 | PASS |
| close isolated SHORT | `{"kind":"CLOSE"}` | wallet 999.77898; positions 0 | wallet 999.77898; positions 0 | PASS |
| LIMIT rests | `{"kind":"OPEN","symbol":"BTCUSDT","side":"LONG","type":"LIMIT","quantity":"0.002","leverage":"3","marginType":"CROSS","price":"49000"}` | wallet 999.77898; positions 0 | wallet 999.77898; positions 0 | PASS |
| LIMIT cancel | `{"kind":"CANCEL"}` | wallet 999.77898; positions 0 | wallet 999.77898; positions 0 | PASS |
| target position | `{"kind":"OPEN","symbol":"BTCUSDT","side":"LONG","type":"MARKET","quantity":"0.002","leverage":"3","marginType":"CROSS"}` | wallet 999.72386989; positions 1 | wallet 999.72386989; positions 1 | PASS |
| reduce-only LIMIT rests | `{"kind":"OPEN","symbol":"BTCUSDT","side":"SHORT","type":"LIMIT","quantity":"0.001","leverage":"3","marginType":"CROSS","price":"50200","reduceOnly":true}` | wallet 999.72386989; positions 1 | wallet 999.72386989; positions 1 | PASS |
| reduce-only maker fill | `{"kind":"REFRESH"}` | wallet 999.81372989; positions 1 | wallet 999.81372989; positions 1 | PASS |
| close remainder | `{"kind":"CLOSE"}` | wallet 999.886919395; positions 0 | wallet 999.886919395; positions 0 | PASS |
| LONG with TP | `{"kind":"OPEN","symbol":"BTCUSDT","side":"LONG","type":"MARKET","quantity":"0.002","leverage":"3","marginType":"CROSS","protection":{"takeProfit":"50100","triggerBy":"MARK"}}` | wallet 999.831919285; positions 1 | wallet 999.831919285; positions 1 | PASS |
| TP trigger and observed book fill | `{"kind":"REFRESH"}` | wallet 999.978408295; positions 0 | wallet 999.978408295; positions 0 | PASS |
| SHORT with SL | `{"kind":"OPEN","symbol":"BTCUSDT","side":"SHORT","type":"MARKET","quantity":"0.002","leverage":"3","marginType":"ISOLATED","protection":{"stopLoss":"50100","triggerBy":"MARK"}}` | wallet 999.923408405; positions 1 | wallet 999.923408405; positions 1 | PASS |
| SL trigger and observed book fill | `{"kind":"REFRESH"}` | wallet 999.665897195; positions 0 | wallet 999.665897195; positions 0 | PASS |
| insufficient funds | `{"kind":"OPEN","symbol":"BTCUSDT","side":"LONG","type":"MARKET","quantity":"1","leverage":"3","marginType":"CROSS"}` | HTTP 409; no stored change | HTTP 409; no stored change | PASS |
| cleanup | `{"startBalance":"1000"}` | {"endBalance":"999.665897195","openPositions":0,"openOrders":0} | {"endBalance":"999.665897195","openPositions":0,"openOrders":0} | PASS |

Local cleanup: **0 open positions, 0 open orders**. Balance **1000 → 999.665897195 USDT**, explained exactly by realized gross `+0.1991` minus fees `0.533202805`. The 0.01 ETH collateral asset remains unchanged. No other position closes during the partial close of the named LONG. PostgreSQL is stopped after the harness.

No real production positions were created in this task. Read-only production balance remained **11045208.67351093 USDT → 11045208.67351093 USDT**, revision 71, zero open positions/orders.

## Validation

- Focused native/client regressions: **30 suites, 470 tests PASS**; 2 DB-only suites/11 tests skipped in that invocation and run separately below.
- Disposable PostgreSQL: **2 suites / 11 tests PASS**, including the 20-operation HTTP acceptance and rollback/CAS checks.
- Actual browser: **30/30 checks PASS**, 0 page errors, desktop 1440×1000 and mobile 390×844. Includes new server-refusal and lost-response cases: pending clears, exactly one submit, no retry, persisted state unchanged. See [browser-checks.json](browser-checks.json).
- Backend TypeScript, collector TypeScript, frontend TypeScript/production build: PASS.
- Full-suite exact-name comparison against pristine main: final rerun in progress; this paragraph is updated before review handoff.

These results establish **production-like acceptance**, not successful production execution. After review and an explicitly authorized deployment, repeat the small production/native-account acceptance with the new correlation IDs. No merge/deploy was performed here.
