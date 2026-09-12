# VOLTEX inverse, options and CFD market-data expansion

Base source of truth when this branch was created: `main` at `ab564ae46dcbad3b2e6f4ea8bed874eb4115961b`.

## Non-negotiable safety rules

- This work is market-data/read-only infrastructure first. Do not change balances, matching, mark price, margin, funding settlement, liquidation, PnL, Copy Trading economics, or executable-market permissions unless a separate explicit task says so.
- Do not fabricate prices, spreads, OI, IV, Greeks, funding, timestamps, or zero values. Missing stays `null`/unavailable.
- Do not bypass provider geo/rate restrictions. Bybit access must continue through the Frankfurt collector where required.
- Do not merge or deploy production automatically. Build/test on the branch, then open a PR for owner review.

## A. Bybit inverse

Goal: add Bybit inverse contracts as a complete read-only live reference market.

- Extend the Bybit adapter/collector from `spot | linear` to support `inverse`.
- Use the official public inverse WS: `wss://stream.bybit.com/v5/public/inverse`.
- Fully paginate `/v5/market/instruments-info?category=inverse&limit=1000`.
- Bootstrap category tickers with `/v5/market/tickers?category=inverse`.
- Preserve contract semantics. Do not collapse dated inverse futures into inverse perpetuals. Add explicit normalized market types if needed (`inverse_perpetual`, `inverse_futures`) instead of inferring by symbol text.
- Include Trading inverse instruments in the Frankfurt collector's live reference feed and public SSE, with the same rollback/reconnect/staleness guarantees already used by spot/linear.
- Do not make inverse executable on VOLTEX in this task.

## B. Bybit options

Goal: expose the complete options universe and trustworthy quotes without flooding the global ticker feed.

Official API constraints:
- Instruments endpoint supports `category=option`; `baseCoin=All` returns all option symbols; paginate with `limit=1000` + cursor.
- Tickers endpoint requires `symbol` or `baseCoin` for options.
- Option public WS is `wss://stream.bybit.com/v5/public/option`; option ticker messages are snapshot-only and may push at high frequency.

Architecture:
- Keep options separate from the global spot/linear/inverse SSE. Do NOT subscribe thousands of option symbols globally just because they exist.
- Add option-specific normalized types carrying provider metadata explicitly: provider symbol, base/quote/settle, status, expiry/delivery time, option type (Call/Put), tick/qty constraints, and quote fields available from Bybit. If strike must be derived from the documented provider symbol because the endpoint provides no separate strike field, isolate that parser, validate the exact documented format, and never silently guess.
- Frankfurt collector owns all upstream option REST calls so Oregon never needs direct Bybit access.
- Add authenticated internal collector endpoints for option universe/chain/ticker retrieval with bounded caching and pagination. Suggested surface:
  - `/internal/v1/options/instruments?baseCoin=...&cursor=...`
  - `/internal/v1/options/tickers?baseCoin=...&expDate=...`
- Add public read-only backend routes under `/api/v1/market/options/...` that proxy normalized data from the collector. Do not expose collector auth/token to browsers.
- If live option streaming is added now, subscribe only to requested/visible contracts with bounded fan-out, ref-count subscriptions, idle expiry and hard caps. Otherwise deliver reliable short-TTL snapshots first and leave global option streaming for a later measured phase.
- Do not make options executable on VOLTEX in this task.

## C. CFD / commodities / forex

Current code uses `CfdMarketDataService` + Twelve Data and a fixed six-symbol set. That feed is used by CFD open/close/liquidation paths, so data freshness is trading-critical, not decorative.

Provider facts to design around:
- Twelve Data Basic has 8 API credits/minute and 800/day; current code intentionally stays at six symbols / 60s.
- Twelve Data's commodity reference list is available from `/commodities`.
- Real-time commodity market data (gold, silver, WTI, Brent, etc.) is a paid commodity-market feature; do not pretend Basic can provide a broad reliable real-time CFD universe.
- Bybit V5 covers spot/linear/inverse/options, but Bybit's separate CFD product is MT5-based and is not the same data surface. Do not label Bybit TradFi perpetual prices as CFD spot prices.

Required CFD refactor:
- Keep a provider-neutral CFD market-data interface so execution/liquidation code is not coupled to a single vendor.
- Do not simply expand `CFD_INSTRUMENTS` and keep 60-second polling while leveraged CFD execution remains enabled. A 60-second quote is too stale for safe dealer fills/liquidation.
- Every CFD quote used for execution must carry `fetchedAt`/provider timestamp and a strict max-age check. Opening/closing/liquidation must fail closed when the quote is too old or provider status is unavailable.
- Add explicit bid/ask when the provider supplies them; never invent a spread from a single close price.
- Build a verified instrument catalog from provider reference data instead of guessing symbols. Target initial asset classes:
  - precious metals: gold, silver, platinum, palladium where real-time data is available;
  - energy: WTI crude, Brent crude, and optionally natural gas only if verified live;
  - major FX pairs already supported;
  - indices/stocks only after the exact data entitlement and symbol mapping are verified.
- Add a startup/admin diagnostic showing which CFD instruments are configured, live, stale, unavailable, and the provider timestamp. No secret values in diagnostics.
- Preserve the current CFD financial model; this task changes data correctness and coverage, not accounting rules.

## CFD data-plan gate

Before enabling new oil/metals symbols for real leveraged trading, verify the actual provider entitlement in the deployed account. If Twelve Data remains Basic, restrict executable CFD instruments to symbols proven real-time under that plan and keep the rest unavailable. If the account is upgraded to a plan with real-time commodities, enable only after live verification of each symbol and quote freshness.

## Tests / QA required

- Focused unit tests for inverse normalization, pagination, subscription packing, reconnect and stale-last-good behavior.
- Option parser/normalizer tests for calls/puts, expiry, pagination, malformed symbols/rows, null preservation and baseCoin filtering.
- Collector auth tests for all new internal endpoints.
- No new provider request-per-symbol fan-out where a category/baseCoin batch exists.
- CFD quote-age tests: fresh quote accepted; stale/unavailable quote rejects open/close/liquidation-safe action rather than trading on old data.
- Exact failure baseline comparison against pristine current `main`; zero new unrelated failures.
- Build backend/frontend/collector.
- Staging/branch runtime verification before any production merge.

## Deliverable

One PR from `codex/inverse-options-cfd-data` with a clear file manifest, request-rate model, measured instrument counts, test results, and explicit statement of what is and is not production-ready. Do not merge automatically.
