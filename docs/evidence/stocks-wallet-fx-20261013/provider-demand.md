# Provider demand diagnostic — PR512

All new observations are disposable offline fixtures. The real Stocks HTTP and native adapters run unchanged in the baseline; crypto control requests are no-ops. No CPU, RAM, latency or coexistence acceptance is inferred from these diagnostics. External market endpoints were not contacted.

Source baseline: `cbd08c8f4a7de2ed0987a48d0ad1f84563d6c0f1`. Original Bv2 artifact11830376374 / run38424465702 is read-only and separately retained. Initial incomplete snapshot import failure is retained; successful diagnostics use baseline-cbd-complete.

| Offline run | Bybit book/ticker/kline | Binance trade/ticker/kline/FX | HTTP errors | Embedded source errors | Result |
|---|---|---|---:|---:|---|
| baseline-cbd-complete-20-r0 | 49/14/28 | 60/13/26/1 | 39 | 31 | FAIL |
| baseline-cbd-complete-50-r0 | 49/14/28 | 58/13/28/1 | 78 | 77 | FAIL |
| prototype-ticker-immediate-20-r0 | 48/14/28 | 63/10/26/1 | 39 | 29 | FAIL |
| prototype-ticker-immediate-50-r0 | 49/14/28 | 58/9/32/1 | 63 | 85 | FAIL |

The setImmediate prototype batches only demanded Binance24h ticker misses, at most20 symbols, with the same15s per-symbol TTL. Observed starts fall13→10 (20viewers) and13→9 (50viewers), not13→1: HTTP and SQLite response admissions span multiple event-loop turns. Both still exhaust100 Binance starts. More delivered histories consume the saved starts; error counts depend on scheduling and are not a throughput guarantee. Two prototype unit cases pass (bounded demand/TTL/coalescing and malformed symbol set failure). The prototype is outside Git and is not an approved production change.

All native candle calls have limit600 and are latest windows; every successful older300-row page uses the existing shared range. No native cursor pagination occurs.20/50viewers share20actual IDs (7Bybit,13Binance); the250 metadata rows do not create250active instruments. Existing cache resident5.10–5.42MB in the original six failed cases, with0evictions, rules out the8MiB cap as their cause. Mutable15m refresh repeats fixture payloads; skipping that refresh based on unchanged fixture data would not prove real-provider correction safety.

Conditional demand floor:13Binance symbols ×7fresh quote waves =91 single-symbol trade reads, plus13×3first requested history timeframes =39 native history reads.130 starts already exceeds100 in60s even with zero ticker, FX, repeated15m refresh or retry requests. This describes the current REST adapter and workload; it is not a universal impossibility or grounds to increase limits. Extra RAM cannot change this request-count bound.

Safe next hypotheses: demand-only ticker batching can reduce display-data overhead but cannot alone satisfy this scenario; optional Wallet USDT FX projection is separately being tested and should preserve dual-currency chart observations. After quota exhaustion, repeated failed reads could share bounded error state and Retry-After to avoid local CPU churn without disguising failures, but this would not restore successful required reads. Incremental candle tail refresh can reduce bytes only after historical-correction semantics are defined; it cannot reduce the number of latest observations. A native trade stream or another proven multi-symbol price source could change the request bound but requires a separate reconnect/gap/timestamp/event-id/freshness proof; it is not implemented here.

Binance official documentation supports explicit symbols arrays for24h ticker and describes trades and klines with one required symbol. The24h ticker is display statistics, not a drop-in replacement for the current timestamped last-trade execution source. These technical endpoints do not establish commercial redistribution rights. [Official API documentation](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market).

Suggested validation sequence: (1) narrow offline quote/currency and ticker malformed-response regressions; (2) same20/50distinct diagnostic on a frozen candidate with request hashes; (3) only after errors actually disappear, rerun the original six20/50distinct B loaded cases ×3 with unchanged limits and idle/dispatch proof, plus matched crypto controls if claiming+5% coexistence; (4) original strictA5/20/50×3 and50/100reader gates remain mandatory and unchanged. Current results do not justify an unchanged heavy matrix rerun.

Exact original failure rows, native endpoint calls/cache hits/inflight counts, history ranges and request/candle hashes are in `summary.json` and the retained NDJSON files. HTTP failures and embedded source observations are distinct and must not be summed.
