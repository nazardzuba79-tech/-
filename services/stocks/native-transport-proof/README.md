# Offline native transport contract proof

This directory is an **offline prototype**, excluded from the Stocks runtime. It has no built-in socket implementation, credentials, live connection, provider subscription, candle generation or automatic order matching. The caller supplies an explicitly marked fixture transport. That marker is a contract, not an operating-system egress barrier; the supplied tests contain no network transport, and container network controls provide separate isolation. Synthetic messages are test fixtures, never public market data.

Official generic Binance Spot [raw trade stream documentation](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#trade-streams), read 2026-10-13, describes `t` as trade identity, `T` as trade time and `p` as price. Those correspond to the existing REST `/api/v3/trades` adapter's `id`, `time`, `price`. `aggTrade` identity is aggregated and cannot replace this contract. This documentation **does not establish availability for the specific bStocks symbols**, public redistribution rights, or regional product eligibility.

The ten tests compare a fixture raw trade against the actual `MarketHub.quote` REST adapter and apply the result to the unchanged engine. They cover duplicate event capacity, native time/price identity and formatting boundaries, freshness, symbol/provider validation, bounded demand, shared subscription ownership, generation fencing, cancellation, limited reconnect attempts, synchronous open failure/disconnect and zero-demand cleanup attempts. A failed fixture close is recorded as unresolved; retiring references is not proof that a failed underlying connection closed. Receipt stores an observation; it does not invoke an order matcher. A repeated event cannot reset reception freshness within an active demand generation. Quote read/financial admission remains an explicit action.

The reconnect model is deliberately finite: at most three fixture connection attempts per demand lifetime, no timers or infinite background loop. It is not a production reconnect implementation. HTTP history pagination, ticker metadata and FX are outside this prototype. No request-budget or throughput improvement is claimed from these contract tests.

Bybit is unsupported here. Its existing adapter consumes order-book identity and prices; public trade IDs cannot replace them. Official [REST order book](https://bybit-exchange.github.io/docs/v5/market/orderbook) and [WebSocket order book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook) contracts require separate depth/update identity analysis. MOEX remains blocked.

Run only the isolated proof:

```sh
node --test services/stocks/native-transport-proof/binance-offline.test.mjs
```

Open gates before any runtime proposal: actual instrument/endpoint availability; documented rights; equivalent event/capacity behavior across reconnect and transport switching; bounded lifecycle and resource measurements; unchanged original acceptance tests. This proof authorizes none of those claims and changes no runtime choice.
