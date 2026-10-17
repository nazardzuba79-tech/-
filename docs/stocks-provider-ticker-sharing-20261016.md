# Stocks-only ticker-sharing candidate

Status: explicit local candidate, not enabled by the default server/CLI. No production/provider trading request, load replay, CI dispatch, push or deployment. Correctness fixes reviewed at797e718d are preserved. The unsuccessful seven-line JOIN experiment was withdrawn separately at eaecfda0f7fb2588c9fa45f61caf4a2f6f056d55; its A/B remains FAIL evidence, not a performance fix.

## Verified official API contract

Bybit spot `/v5/market/tickers` accepts omitted symbol for a multi-symbol list. Its orderbook endpoint requires one symbol and exposes native book timestamp/update information. [Ticker](https://bybit-exchange.github.io/docs/v5/market/tickers), [orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook).

Binance24hr ticker accepts a symbols array; its closeTime is the end of a statistical interval. The recent-trades endpoint requires one symbol and returns native trade time/id. Multi-symbol bookTicker returns prices/quantities without a corresponding trade-time field. These responses cannot establish the existing execution-observation timestamp by substituting response/interval time. [Official REST market data](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market).

Combined public trade streams supply trade price/id/time in p/t/T. This could preserve the existing Binance last-trade-as-bid/ask model; it does not provide actual best bid/ask in that same trade event. [Official trade streams](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-streams/~).

## Minimal implemented scope

- `services/stocks-global/shared-ticker-market.mjs`: explicit subclass of the existing Stocks MarketHub. It intercepts only existing canonical Stocks per-symbol ticker requests with their exact15000ms TTL and query shape, sharing the same supported batch URL/cache used by catalogue. Unknown symbols, another query type/TTL, native books/trades, history and FX pass through unchanged.
- `services/stocks-global/shared-ticker-market.test.mjs`: actual inherited quote parser, native transport cache, response bounds and100/host/rolling60000ms guard with a synthetic fetch only. No fake quote()/catalogue()/history() replacement.

No existing market/server/crypto module was modified or wired to this subclass. The parent request() still owns HTTP starts, errors, cache age, coalescing and byte limits. No independent budget, extra retry, stale fallback, timestamp rewrite or increased TTL. Native quote.timestamp/eventId/capacity/bid/ask are unchanged. Catalogue can use its existing60s metadata view; native ticker requests still require at most15s-old metadata from the shared cache.

## Executed tests and exact accounting

Negative20!=0 single-symbol ticker requests retained in shared-ticker-negative.tap. Final10PASS/0FAIL/0SKIP in235.0306ms; this is a deterministic virtual-time transport regression, not CPU/HTTP/CX23 capacity evidence. Shared20-symbol demand reused the2already-fresh catalogue batches instead of20extra per-symbol ticker calls while still making20native execution reads and1sharedFX read.

Coverage: exact15s expiry; new native event per read; fresh batch time does not freshen stale native/FX; missing/duplicate selected rows fail closed but other symbols/venue work; expired batch503 has no stale fallback/retry; default/non-Stock/type/TTL routing unchanged;100-request rolling boundary; history competes for the same budget.

| Synthetic quote-only cell | Outcome |
|---|---|
|7Bybit symbols,5s cadence,120virtual seconds|168successful native observations;168native+8batch ticker+1metadata starts on Bybit; maximum rolling60s starts89 (cold), not full chart/navigation acceptance|
|13Binance symbols,5s cadence,60virtual seconds|156attempts;93successful quote/63RATE_LIMIT;93native+3batch ticker+3FX+1metadata=100starts; budget NOT_CLEARED|

With no quota refusal the nominal Binance minimum remains156native+4batch ticker+4FX+1metadata=165cold starts/minute. Bybit nominal cold quote-only count is84native+4batch ticker+1metadata=89. History/catalogue/error recovery can add demand; the11Bybit-start headroom is not a capacity guarantee. Raw timestamps/category counts are retained in shared-ticker-rolling-results.json. No limit was disabled to produce the failed Binance cell.

## Risks before activation

Bybit's supported batch contains all spot tickers, unlike the prior small per-symbol response. Reusing it may increase download/JSON parsing/GC work. The existing8MiB response bound and one cached batch remain, but actual payload/CPU/coexistence have not been measured. This candidate reduces request count; it does not fix the unresolved crypto p95 degradation or prove <=5%. It remains explicitly injected until risk review. Default runtime and all previous failed gates are unchanged.

## Additional scope needed to close Binance

REST metadata sharing alone cannot remove the156native-trade-reads/minute lower bound while preserving5s demand and native timestamps. A potential next scope is a Stocks-only combined public trade feed, not implemented here:

1. New `services/stocks-global/binance-trade-feed.mjs`: one bounded, public, exact-symbol connection; retain native T/t/p and actual arrival time. Track demanded verified Stocks symbols only, no private endpoints/orders; bounded frame/storage/reconnect, explicit generation invalidation, no retiming a cached event.
2. A narrow optional native-source seam in `services/stocks-global/market.mjs`, preserving existing parsing and financial guards; response receivedAt must remain the event's original arrival time. Do not silently present a recent interval timestamp as native trade freshness.
3. `services/stocks-global/server.mjs` owns opt-in start/stop/demand release, not a global crypto feed. All existing2-flight/queue/deadline/demand fences remain. Missing/stale/disconnected feed fails closed without an automatic REST retry storm.
4. Focused protocol/lifecycle tests: multiple symbols, wrong symbol, malformed/future/nonfinite data, duplicate/out-of-order IDs, reconnect generation, idle/disconnect, old receive/native times, pre-demand rejection, exact occurrence/capacity preservation, shared rate limits and isolation from crypto/financial endpoints.

Nominal HTTP demand could then be4ticker+4FX+1metadata=9cold starts/minute on api.binance.com, with public WebSocket connection/reconnection starts separately and explicitly budgeted on stream.binance.com. History adds its own real HTTP demand. This is a proposed accounting model, not measured acceptance. Exact subscription/reconnect/idle policy and its risk need review before implementation.

If actual best bid/ask rather than the existing last-trade proxy is required, that introduces another source/quote contract and synchronization problem; it is not included in metadata sharing or assumed authorized. No WebSocket code or real provider connection was added.

## Remaining gates

Crypto cause UNRESOLVED; original+14.35% and matched B worsening retained. No new load run. Final-source50+2/CX23/rights/live-provider/private owner-Xenia binding remain open. Publication remains blocked by unavailable freshCF/NF receipts; no retry of the failing browser or CI scheduling bypass. Render13services were read-only verified to exclude this branch and disable PR previews.
