# Stocks US/RU local review — 2026-10-09

## Status and Git boundary

US token trading is implemented and exercised against real public prices. Russia is **blocked**, not completed: MOEX DNS resolution failed (`EAI_AGAIN` / `ENOTFOUND`, independently reproduced in Node and PowerShell), and the CBR daily reference request timed out. The SBER UI honestly shows unavailable data and disables Market execution. No real-data SBER cycle or working Russian feed is claimed.

Fresh GitHub fetch before implementation: main `cb5559db24c7c8ba4cae75997a1c9145a193151f`. PR #471 remained draft/open/unmerged at `13fe4a8f9aad5d873612fdb0be57c027767336c6`; PR #481 remained draft/open/unmerged at `1cc0e7a5a5c3f7a56c26cc7d0ebbbf913588cfe6` (GitHub connector verified). Local branch `codex/stocks-us-ru-simulator-20261009` preserves prior V1 commit `b2c057a5a5d21a9ad450aab36d79f4fd3170e2ef`. No merge, push, deployment, production migration or production runtime operation was performed.

## Twelve-exchange investigation

Finite unauthenticated read-only catalogue probes, 2026-10-09. Catalogue success alone does not establish candle availability, token equivalence, redistribution rights or execution freshness. Raw responses and timestamps remain in the local evidence directory.

| Exchange | Public API result | Observed exact examples | Decision |
|---|---|---|---|
| Binance | HTTP 200, exchangeInfo | AAPLBUSDT, NVDABUSDT, TSLABUSDT; all 13 requested companies | Selected. Real trades, USDC/USDT FX and candles verified. Public multiplier endpoint requires credentials. |
| Bybit | HTTP 200, V5 spot instruments | AAPLXUSDT, NVDAXUSDT, TSLAXUSDT; seven requested companies | Selected. Real timestamped book, multiplier and candles verified. |
| OKX | HTTP 200, public SPOT instruments | XAAPL-USDT, XAAPL-USDC, XNVDA-USDT, XTSLA-USDT | Catalogue candidate; not wired. Prefix/identity mapping and permissions need validation. |
| Bitget | HTTP 200, spot public symbols | RAAPLUSDT, RNVDAUSDT, RTSLAUSDT (base rAAPL etc.) | Different token family; no substitution into AAPLX positions. |
| KuCoin | HTTP 200, symbols | AAPLX-USDT, TSLAX-USDT, MSTRX-USDT | Candidate, not an automatic failover. |
| Gate | Fetch failed; no verified catalogue | None asserted | Not integrated. |
| MEXC | HTTP 200, exchangeInfo | AAPLXUSDT, AAPLONUSDT, NVDAXUSDT, NVDAONUSDT | Multiple token brands; no silent merging. |
| Kraken | HTTP 200, tokenized asset pairs | AAPLxUSD, NVDAxUSD, TSLAxUSD | Real tokenized OHLC verified after supplying `asset_class=tokenized_asset`; 720-bar cap and USD conversion make it a secondary candidate. USDT/USD read endpoint used for the planned RUB FX chain. |
| BingX | HTTP 200, spot symbols | AAPLX-USDT, AAPLON-USDT, NVDAX-USDT | Candidate only. |
| Phemex | HTTP 200, products | sAAPLXUSDT, sAAPLONUSDT, sNVDAXUSDT | Candidate only; product prefixes matter. |
| LBank | Fetch failed | None asserted | Not integrated. |
| BitMart | Fetch failed, DNS failure observed | None asserted | Not integrated. |

Bybit's published IP ceiling is 600 requests/5 seconds. Binance's observed exchangeInfo limit was 6,000 request-weight/minute. Local code conservatively limits each provider to 100 requests/minute, caches/coalesces, bounds responses, and has no perpetual twelve-provider collection. These are distinct request versus weight units. Unselected providers' limits/rights have not been certified for integration.

The API-access and market-data-rights findings, official references, timestamp policy, identity policy and exact conversion formulas are in [`services/stocks-global/README.md`](../../services/stocks-global/README.md). Public commercial redistribution rights remain unresolved. No subscription was bought or contract accepted.

## Connected market matrix

[`stocks-global-markets-20261009.md`](stocks-global-markets-20261009.md) contains all 40 exact instruments, API results, declared delay, native intervals, quote currency and USDT/USDC admission at probe time. The finite probe made 78 GET requests, received 1,667,029 bytes and recorded 19 cache hits. Twenty US pairs returned real 15m candles. All seven Apple intervals were verified separately for both source tokens (300 bars each except 73 Binance daily bars). Twenty MOEX candidates remain unverified.

## Real browser cycles

All following transactions are exclusively in the V2 local paper ledger, fee 0. Source quotes were fetched through allowlisted public GET endpoints; no order was sent to a venue.

1. AAPLX/USDT Market buy 0.6 at 337.28. Average entry 337.28; cash 9,797.632. The real bid moved from 337.19 to 337.17 and displayed unrealized PnL moved from -0.054 to -0.066.
2. Sell 0.3 at 337.17, realized -0.033. Sell remaining 0.3 at 337.17; position zero, cash 9,999.934, realized -0.066.
3. Limit buy 0.2 at 100 reserved 20 USDT; cancellation released all 20 without a fill.
4. Limit buy 1.2 at 340 filled in **two distinct provider observations after submission**, 1 and 0.2 at 337.27. Fill timestamps: 1791570148221 and 1791570151242; provider timestamps: 1791570145432 and 1791570149290. The UI screenshot captured the completed result, not the transient partial-limit state.
5. Market sell 1.2 filled 1 at 337.20 under the documented IOC capacity model and cancelled its remainder. Sell the remaining position 0.2 at 337.17. Final Apple realized PnL -0.156 USDT.
6. NVDAX/USDC buy 0.1 and sell 0.1 through the browser. Observed USDC/USDT rates were 1.00075–1.00076, not an assumed 1 USD. Final realized PnL -0.00299777 USDC.
7. Restarted the local service and reloaded the browser: **9 orders, 9 fills**, no open positions/reservations. USDT cash **9,999.84400000**, USDC cash **9,999.99700223**. No ledger reset.

8. A final network-isolation check placed and cancelled another AAPLX Limit (0.1 at 1 USDT). It added one cancelled order and no fills: final ledger has **10 orders / 9 fills**, with the same cash and PnL. A complete, untruncated capture shows exactly two POST requests, both to loopback `/__stocks_global/orders` and `/__stocks_global/cancel`, no external requests and no failures in this action window.

SBER Market remained disabled with quantity 1 because neither a verified quote nor conversion was available. RUB→USDT/USDC arithmetic and delayed-limit no-look-ahead are fixture-tested, but cannot replace the missing real SBER cycle.

## Validation

- 51 Node tests PASS: 20 V2 and 31 preserved V1 tests. Fractional/weighted cost, partial/IOC/GTC, reserve release, overspend/oversell, duplicate requests and observations, stale/future/closed/unverified data, token identity, FX staleness, post-submission timestamps, writer locks, atomic failure, restart and refusal to alter a V1 ledger.
- 24 existing frontend tests PASS (4 suites): stock order panel, widget lifecycle, presentation and navigation.
- TypeScript PASS; enabled V2 build PASS; default-off build PASS, with **zero `/__stocks_global/` strings** in its output assets after correcting unconditional lazy-chunk emission. Existing >500 kB chunk warnings remain; no new dependency was added.
- Browser desktop 1440×1000: native candles, volume, MA/RSI/MACD, interval switching, actual buy/sell/limit/cancel, state recovery. Chart ends at x=1112, ticket starts x=1116: no overlap. No widget iframe exists in V2.
- Mobile 320/360/390/430×844: chart/trade/positions tabs work. Document scrollWidth equals clientWidth at every size for chart and form. Ticket is hidden in chart mode; chart is hidden in trade mode. 390px history screen verified.
- No production DB/accounting, API deployment, cloud worker, AITH/NRX configuration or real wallet table was read or modified by this task. Isolation is supported by separate local storage, route/HTTP tests and outbound provider allowlisting; this is not a production database before/after audit.

- Runtime resource sample: approximately 80 MB RSS. With no terminal client, the 12-second lease expired; a subsequent **30.681-second** observation had zero additional source requests and zero measured process CPU microseconds. This is a small local observation, not a production load benchmark. The in-app browser kept `document.hidden=false` when another tab opened, so real hidden-tab browser emulation was not claimed; frontend hidden checks were inspected, and the server lease was verified by leaving the terminal.
- No JavaScript console warnings/errors observed in the final capture. Three company favicon requests were blocked by browser ORB and correctly fell back to initials. The earlier rolling network buffer was truncated, so it is not evidence for the entire session; the final order/cancel window is complete.

## Local artifacts

Evidence directory (outside Git):

`C:/Users/nazar/Documents/Codex/2026-10-06/admin-listings-aith-usdt-0-80/output/stocks-us-ru-20261009`

- `desktop-apple-1440.jpg`, `mobile-apple-chart-390.jpg`, `mobile-apple-trade-390.jpg`, `mobile-history-390.jpg`.
- `desktop-sber-blocked-1440.jpg`, `mobile-sber-blocked-390.jpg`.
- `apple-paper-cycle.mp4`: approximately 28 seconds assembled from eleven genuine timestamped browser captures. This is an accelerated sequence of actual steps, **not a continuous screen recording**. No candles or trade outcomes were generated for the video.
- `connected-markets.json`, `connected-markets.md`, catalogue/quote/candle response files; test/build logs; `responsive.json`, `responsive-chart.json`.
- `ledger-v2.json`: local test history only; excluded from Git. Keep it to reproduce the displayed accounting.

Preview: `http://127.0.0.1:4437/stocks/BYBIT%3AAAPLXUSDT` and `http://127.0.0.1:4437/stocks/MOEX%3ATQBR%3ASBER`. The process must remain running. Existing V1 preview/build/history remain separate.
