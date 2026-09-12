# CFD reference coverage

Base: current main `cd1d646bd0dbe9b42d6cb21e4445430ce43934a1` (fetched 2026-09-12).

The terminal displays all 13 verified catalog identities before its first API
response, including when no provider key is configured. Unknown prices are null
and render as `—`. Provider support, reference availability, live entitlement and
permission to open positions remain distinct.

## Refresh and quota

The existing backend service owns a demand-driven round-robin queue. The first
reference request fetches up to eight symbols, and the first consumer at least
60 seconds later fetches the next eight, wrapping around the 13-symbol catalog.
All 13 are attempted in the first two cycles. Under regular minute polling, each
symbol is refreshed every one or two minutes. Requests are deduplicated, and
failed batches advance the cursor so they cannot starve later symbols.

Every actual HTTP attempt, including retries and separate single-symbol execution
refreshes, consumes its symbol count before HTTP. Limits are capped at eight
credits per rolling 60 seconds and 800 per rolling 24 hours; configuration can
lower these limits but cannot raise them. If fewer credits remain, the reference
batch shrinks. Exhaustion prevents HTTP. Execution requests do not reset or speed
up the reference rotation; its frontend poll remains 60 seconds.

Twelve Data documents [per-symbol credits and the Basic daily limit](https://support.twelvedata.com/en/articles/5615854-credits).
The rolling daily window is conservative compared with the provider's UTC reset.
Eight credits/minute consumes 800 credits after 100 active batches; this free
plan cannot provide that cadence continuously all day. Last-good prices remain
visible after exhaustion with their original timestamps and stale state.

**Scope:** the existing quota owner is one backend service instance/process. The
current entry point constructs one instance. This patch does not add durable or
cross-process quota storage. A shared key across replicas, other applications,
or overlapping restarts requires a shared persistent limiter before claiming an
account-wide quota guarantee. No production configuration was changed.

## Availability and execution

Each symbol independently retains its last positive finite provider price and
original provider/fetch timestamps. Null, zero, negative, malformed and provider
error responses cannot manufacture a price. A failed symbol keeps its last-good
price marked stale; a symbol with no good observation is unavailable.

`referenceStatus` distinguishes available, stale, unavailable and market_closed.
Reference observations expire after 120 seconds using fetch/provider timestamps;
a failed refresh is stale immediately. The existing stricter execution status,
age limit, entitlement and new-position approval remain enforced separately.
OPEN, CLOSE and liquidation gate implementations and financial arithmetic are
unchanged. Newly displayed symbols do not acquire execution approval.

## TradingView mappings

Official TradingView symbol pages checked 2026-09-12. These are independent chart
feeds, not claims that TradingView and Twelve Data publish identical prices or
that an account has execution entitlement. Oil charts are the named OANDA CFD
feeds, not invented aliases for exchange futures. Runtime script/widget failures
and unmapped symbols show the existing honest chart-unavailable fallback.

| CFD | TradingView mapping | Display decimals | Evidence |
| --- | --- | ---: | --- |
| XAUUSD | OANDA:XAUUSD | 2 | [Gold](https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA) |
| XAGUSD | OANDA:XAGUSD | 3 | [Silver](https://www.tradingview.com/symbols/XAGUSD/?exchange=OANDA) |
| XPTUSD | OANDA:XPTUSD | 2 | [Platinum](https://www.tradingview.com/symbols/XPTUSD/) |
| XPDUSD | OANDA:XPDUSD | 2 | [Palladium](https://es.tradingview.com/symbols/XPDUSD/) |
| WTIUSD | OANDA:WTICOUSD | 2 | [West Texas Oil](https://www.tradingview.com/symbols/WTICOUSD/?exchange=OANDA) |
| XBRUSD | OANDA:BCOUSD | 2 | [Brent](https://www.tradingview.com/symbols/BCOUSD/) |
| EURUSD | FX:EURUSD | 5 | [EURUSD](https://www.tradingview.com/symbols/EURUSD/?exchange=FX) |
| GBPUSD | FX:GBPUSD | 5 | [GBPUSD](https://www.tradingview.com/symbols/GBPUSD/?exchange=FX) |
| USDJPY | FX:USDJPY | 3 | [USDJPY](https://www.tradingview.com/symbols/USDJPY/?exchange=FX) |
| AUDUSD | FX:AUDUSD | 5 | [AUDUSD](https://www.tradingview.com/symbols/AUDUSD/?exchange=FX) |
| USDCAD | FX:USDCAD | 5 | [USDCAD](https://www.tradingview.com/symbols/USDCAD/?exchange=FX) |
| USDCHF | FX:USDCHF | 5 | [USDCHF](https://www.tradingview.com/symbols/USDCHF/?exchange=FX) |
| NZDUSD | FX:NZDUSD | 5 | [NZDUSD](https://www.tradingview.com/symbols/NZDUSD/?exchange=FX) |

## Validation

Deterministic tests cover catalog parity, first render, every symbol selection,
all mappings, one active widget, script retry/fallback, concurrent callers,
minute/day limits, retries, independent execution refresh, partial failures,
last-good retention, malformed values, secret-free errors and unchanged money
operation gates. Focused and baseline/full-suite comparison results are in
`docs/qa/cfd-reference-coverage/validation.json`.

`scripts/qa-cfd-reference-coverage.cjs` exercises the built application in local
headless Edge. It uses explicit synthetic API and TradingView test doubles and
blocks remote traffic and non-GET API calls. It verifies 13 visible rows before
API hydration, all 13 symbol switches, one chart iframe, unavailable price `—`,
disabled order submission and no page errors. Its report is
`docs/qa/cfd-reference-coverage/browser.json`. It is not a live provider soak or
proof of account quote availability. No secrets or private APIs were used.

Reproduce builds with `npm run build` at the root and in `frontend`. Run Jest
with `--runTestsByPath` for the CFD suites (a bare `cfd` path pattern also matches
the worktree directory and accidentally selects unrelated suites). Build the
frontend, set `PLAYWRIGHT_MODULE` to an installed Playwright module if necessary,
then run `node scripts/qa-cfd-reference-coverage.cjs` for browser QA.
