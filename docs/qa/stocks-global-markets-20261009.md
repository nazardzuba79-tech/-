# Connected markets: observed local API results

Probe: 2026-10-09T18:28:49.423Z. Availability is a snapshot, not a promise of execution. Native quote currency remains distinct from settlement currency. US API PASS includes real 15m candles; all seven intervals were additionally checked for both Apple tokens. MOEX intervals are adapter capabilities, NOT a successful live verification.

| Company ticker / instrument | Provider | API | Declared delay | Native intervals | Quote | Paper USDT / USDC |
|---|---|---|---|---|---|---|
| AAPL / AAPLX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| AAPL / AAPLB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| NVDA / NVDAX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| NVDA / NVDAB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| TSLA / TSLAX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| TSLA / TSLAB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| MSFT / MSFTB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| AMZN / AMZNX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| AMZN / AMZNB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| GOOGL / GOOGLX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| GOOGL / GOOGLB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | QUOTE_STALE / QUOTE_STALE |
| META / METAX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| META / METAB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| NFLX / NFLXB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | QUOTE_STALE / QUOTE_STALE |
| AVGO / AVGOB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | QUOTE_STALE / QUOTE_STALE |
| COIN / COINX | bybit | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| COIN / COINB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | QUOTE_STALE / QUOTE_STALE |
| MSTR / MSTRB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| AMD / AMDB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| INTC / INTCB | binance | PASS | No imposed delay; event age checked | 1m, 5m, 15m, 30m, 1h, 4h, 1D | USDT | READY / READY |
| SBER / SBER | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| GAZP / GAZP | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| LKOH / LKOH | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| ROSN / ROSN | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| NVTK / NVTK | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| TATN / TATN | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| GMKN / GMKN | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| PLZL / PLZL | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| YDEX / YDEX | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| OZON / OZON | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| MOEX / MOEX | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| SNGS / SNGS | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| SNGSP / SNGSP | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| VTBR / VTBR | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| AFLT / AFLT | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| MTSS / MTSS | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| MGNT / MGNT | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| CHMF / CHMF | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| NLMK / NLMK | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |
| PHOR / PHOR | moex | SOURCE_DNS_UNAVAILABLE (SOURCE_DNS_UNAVAILABLE) | 900 s | 1m, 1h, 1D | RUB | BLOCKED / BLOCKED |

20 US token markets verified, 20 Russia candidates blocked by source connectivity. AAPLX and AAPLB are not interchangeable. Binance multiplier unavailable: native token accounting only. No production or external orders were created.
