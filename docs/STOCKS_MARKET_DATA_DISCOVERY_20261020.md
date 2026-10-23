# Stocks market data: nine-venue discovery and the first adapter slice (2026-10-20)

**Status: review branch only.** Base: application commit `98c577d4241ce527f7bfca3b78dd7bb78255e300` (Draft #559, `codex/stocks-build-only-f97b7f9c-20261020`). Branch `claude/peaceful-volta-h5zw7g-stocks-feeds`. PR #560 and its `review/` files are untouched. No change to PostgreSQL, DemoBalance, authorisation, the gateway, Docker/TLS or any Codex branch. Nothing is enabled, merged or deployed; no provider was activated and nothing was bought.

Answers CTO Issue #561 and its correction comment: real quotes of tokenised stocks from crypto venues; demo trading stays internal (DemoBalance USDT) and is not part of this slice.

## 1. Verdict

| Question | Answer |
|---|---|
| Technically reachable from the review container | 8 of 9 venues answered HTTP 200 to every public read. **Bybit answered HTTP 403** (CloudFront country block) on `api.bybit.com` three times and on `api.bytick.com` once: `NOT_VERIFIED`, not "down". `api.binance.com` answered **HTTP 451**; Binance's documented public-market-data host `data-api.binance.vision` answered 200 with the same paths and payloads. |
| Terms permit display or redistribution | **No venue.** The readable terms of all seven newly researched venues restrict resale, commercial use, redistribution or automated collection; none grants display rights (section 5). Bybit and Binance were already assessed as not cleared in `services/stocks-global/DATA-RIGHTS.md`. Every adapter therefore carries `DATA_RIGHTS_UNVERIFIED` and is **off** unless the operator enables it and records the rights confirmation. |
| Real candles, volumes, books, trades | Captured for the first-slice symbols on all eight reachable venues (section 3); every value in the fixtures is a venue body, byte for byte (`services/stocks-global/testing/fixtures/venues/FIXTURES.md`). No synthetic price, candle or chart exists in this slice. |
| Best 2–3 feeds for a first launch | **Binance bStocks** (via `data-api.binance.vision`), **Gate xStocks**, **MEXC xStocks**. OKX and Kraken are documented reserves with named blockers; Bitget, KuCoin, BingX are not recommended (section 6). |
| Architecture for adding venues | One adapter object per venue (`services/stocks-global/venues.mjs`), a read-only discovery registry (`venue-discovery.mjs`), canonical identity and source priority in `catalog.mjs`, and a four-line seam in `MarketHub` (section 7). The trading engine, ledger, account worker and authority code are not touched. |

## 2. Identity rules applied

Canonical identity = **issuer family + token + venue + quote currency**. The same underlying is a different instrument on every venue, and tokens of different issuers are never the same instrument.

| Issuer family | Evidence in the venue's own API | Venues and symbols (watch list) |
|---|---|---|
| **xStocks** (Backed) | Gate `base_name` "Apple xStock"; MEXC `fullName` "Apple xStock" plus Solana `contractAddress` (`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` for AAPLX); Kraken `aclass_base` `tokenized_asset`, base `AAPLx`; Bybit `xstockMultiplier` (existing adapter, not verifiable from here) | Gate `AAPLX_USDT`, MEXC `AAPLXUSDT`, Kraken `AAPLxUSD` (USD, not USDT), KuCoin `AAPLX-USDT` and BingX `AAPLX-USDT` (symbol family only: the API exposes no issuer) |
| **bStocks** (Binance) | `B` suffix; the issuer name is not in the API | Binance `AAPLBUSDT` … `QQQBUSDT`; BingX `TSLAB-USDT`, `QQQB-USDT` (symbol family only) |
| **OKX X-tokens** | `instCategory` "3" (Stocks), `X` prefix, `openType` "pre_quote"; **issuer not exposed** | OKX `XAAPL-USDT` … `XQQQ-USDT` |
| **Bitget rToken** ("Reality") | `r` prefix; Bitget's rToken guide describes a UTA product | Bitget `RAAPLUSDT` … `RQQQUSDT`: classified `unified-share-equivalent`, not a spot token |
| **MOEX equity** | existing `MOEX:TQBR:*` rows | unchanged; not wired to any new source |

Consequences: `AAPLB` ≠ `AAPLX` ≠ `XAAPL` ≠ `rAAPL` ≠ `AAPLx`; BingX's `TSLAB-USDT` is reported as bStocks family and never mixed with its `TSLAX-USDT`; a BingX perpetual contract is not a stock source and no swap endpoint was read. `SOURCE_PRIORITY` ranks venue instruments per underlying for display and selection only: a lower-ranked source is never served under a higher-ranked id, and a failed source is `SOURCE_HTTP_*` / `SOURCE_UNAVAILABLE`, never a substitute (test `identity and priority` in `venues.test.mjs`).

**MSFT.** No xStocks/USDT pair for MSFT exists on Gate, MEXC, BingX or KuCoin (`MSFTX` → Gate `INVALID_CURRENCY`, MEXC empty list). MSFT is available as Binance `MSFTBUSDT` (TRADING), Kraken `MSFTxUSD` (USD quote, thin), OKX `XMSFT-USDT` (issuer unverified) and Bitget `RMSFTUSDT` (not an open spot book). The slice therefore serves MSFT from Binance only.

**SPY / QQQ.** Confirmed as spot tokens with candle APIs on Gate (`SPYX_USDT`, `QQQX_USDT`), MEXC (`SPYXUSDT`; no QQQX), Binance (`SPYBUSDT`, `QQQBUSDT`), OKX, Kraken, BingX (`SPYX`, `QQQB`). The two Binance ETF tokens are **not** added to the existing 13-symbol Binance list; that list is Codex's verified set and widening it is the CTO's call (one line in `catalog.mjs`).

## 3. Discovery table (watch list, live run 2026-10-20T17:54Z)

Full table with tick/lot/min-notional, timeframes, last/bid/ask, spread, base and quote volume, candle check, HTTP code and UTC per row: `docs/evidence/stocks-venues-20261020/discovery.md` (89 requests, one metadata read per venue plus one ticker and one candle read per listed symbol; request log with bytes in `discovery.json`; the three probe stages with every URL and HTTP code in `requests.log`). Generated by `node services/stocks-global/discover-venues.mjs <dir>`.

Cells: venue symbol (24h quote volume in the quote currency, best bid/ask spread). Kraken reports base volume only; Bitget volumes are the venue's own figures (see caveat).

| Venue | AAPL | NVDA | TSLA | MSFT | SPY | QQQ |
|---|---|---|---|---|---|---|
| Binance (`data-api.binance.vision`) | AAPLBUSDT (510 529 USDT, 0.0029%) | NVDABUSDT (9 060 858, 0.0046%) | TSLABUSDT (11 446 991, 0.008%) | MSFTBUSDT (170 894, 0.0319%) | SPYBUSDT (371 469, 0.0013%) | QQQBUSDT (4 167 572, 0.0014%) |
| Gate | AAPLX_USDT (23 883, 0.0147%) | NVDAX_USDT (147 368, 0.023%) | TSLAX_USDT (177 543, 0.0027%) | UNAVAILABLE | SPYX_USDT (159 368, 0.0246%) | QQQX_USDT (180 793, 0.0291%) |
| MEXC | AAPLXUSDT (71 912, 0.0293%) | NVDAXUSDT (63 881, 0.0367%) | TSLAXUSDT (132 993, 0.0293%) | UNAVAILABLE | SPYXUSDT (80 288, 0.1149%) | UNAVAILABLE |
| BingX | AAPLX-USDT (40 777, 0.0264%) | NVDAX-USDT (62 289, 0.0551%) | TSLAX-USDT (87 445, 0.0506%) | UNAVAILABLE | SPYX-USDT (59 582, 0.0298%) | QQQB-USDT (220 229, 0.0222%; bStocks family) |
| OKX | XAAPL-USDT (582 037, 0.0176%) | XNVDA-USDT (739 296, 0.0184%) | XTSLA-USDT (1 511 825, 0.0187%) | XMSFT-USDT (59 505, 0.045%) | XSPY-USDT (584 950, 0.0013%) | XQQQ-USDT (855 186, 0.0014%) |
| KuCoin | AAPLX-USDT (62 225, 0.0029%) | UNAVAILABLE | TSLAX-USDT (716 482, 0.0107%) | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| Kraken (USD) | AAPLxUSD (600.6 units, 0.0029%) | NVDAxUSD (1 471 units, 0.0046%) | TSLAxUSD (2 426 units, 0.0053%) | MSFTxUSD (34.8 units, 0.0544%) | SPYxUSD (474 units, 0.0013%) | QQQxUSD (192.6 units, 0.0042%) |
| Bitget (rToken) | RAAPLUSDT (1.69 bn, 0.0088%) | RNVDAUSDT (2.04 bn, 0.0138%) | RTSLAUSDT (1.50 bn, 0.0107%) | RMSFTUSDT (1.12 bn, 0.0225%) | RSPYUSDT (3.62 bn, 0.0026%) | RQQQUSDT (2.40 bn, 0.0028%) |
| Bybit | NOT_VERIFIED (403) | NOT_VERIFIED (403) | NOT_VERIFIED (403) | NOT_VERIFIED (403) | NOT_VERIFIED (403) | NOT_VERIFIED (403) |

Every TRADING cell also passed the candle check (ascending or descending native order detected, newest 15-minute candle opening 17:30Z at 17:54Z).

## 4. Per-venue evidence and API semantics

"Documented" = read in the venue's official documentation on 2026-10-20; "observed" = the captured response. Several documentation pages are client-rendered or served a different page, so the adapters are written against observed bodies and the observed facts are what the fixtures pin.

| Venue | Metadata read (stage 1, HTTP, UTC) | Stage-2 reads (all 200 unless noted) | Status semantics | Candle format and order | Caveats |
|---|---|---|---|---|---|
| **Bybit** | `v5/market/instruments-info?category=spot` → **403** 17:25:35Z; retry 403 17:26:30Z; `api.bytick.com` 403 17:26:31Z; browser UA 403 | none possible | documented `Trading` (existing adapter) | existing adapter: descending | Body is a CloudFront "configured to block access from your country" page. Must be re-run from the production region. |
| **Binance** | `api.binance.com/api/v3/exchangeInfo` → **451** 17:25:35Z; `data-api.binance.vision/api/v3/exchangeInfo` → 200 (17.8 MB) | time, ticker/24hr (batch of 6), depth, trades, klines 15m and 1d, bookTicker | documented `TRADING` | `[openTime, o, h, l, c, vol, closeTime, quoteVol, …]`, ascending (observed, same as existing adapter) | Documented: "For APIs that only send public market data, please use the base endpoint https://data-api.binance.vision". Weight limit 6000/min in `rateLimits`. |
| **Gate** | `api/v4/spot/currency_pairs` → 200 (1.1 MB) | time, tickers ×5, order_book (`id`, `update` ms), trades (`create_time_ms`), candlesticks 15m/1d (limit 5 and 600), `currency_pairs/MSFTX_USDT` → **400** `INVALID_CURRENCY` | observed `trade_status` "tradable"; documentation page does not expose the enum (changelog only); the official Markdown bundle answered 403 | `[t s, quote volume, close, high, low, open, base amount, closed]`, ascending (observed); the last row is the open window (`"false"`) | `base_name` names the issuer family. Last AAPLX trade was 16 minutes old at 17:34Z while the book was live: thin at times. |
| **MEXC** | `api/v3/exchangeInfo` → 200 (1.5 MB); `?symbols=AAPLXUSDT,…` → 200; `?symbol=MSFTXUSDT` → 200 with empty `symbols` | time, ticker/24hr ×4, depth (`lastUpdateId`, `timestamp`), trades, klines 15m/1d (limit 5 and 500), bookTicker | documented `status` "1" online, "2" pause, "3" offline; `isSpotTradingAllowed` | `[openTime, o, h, l, c, vol, closeTime, quoteVol]`, ascending (observed); documented max 500 rows; intervals documented 1m 5m 15m 30m 60m 4h 1d 1W 1M | `priceChangePercent` is a fraction (observed -0.0039 = -0.39%); public trades carry `id: null`; one daily-klines request timed out at 20 s and succeeded on the single retry. `contractAddress` is the Solana mint of the xStocks token. |
| **BingX** | `openApi/spot/v1/common/symbols` → 200 | server time, ticker/24hr (AAPLX, TSLAB), depth, trades, kline v2 and v1 (identical) | observed `status` 1 with `apiStateBuy/Sell`; documentation is client-rendered and the GitHub repo holds only a pointer | `[openTime, o, h, l, c, vol, closeTime, quoteVol]` as JSON **numbers**, descending (observed) | Numeric JSON loses the venue's digit string; depth asks are listed best-last. Not documented anywhere readable. |
| **OKX** | `api/v5/public/instruments?instType=SPOT` → 200 (168 `instCategory` "3" rows) | time, ticker (XAAPL, XMSFT), books (`seqId`), trades, candles 15m/1D | documented on the account-instruments page: `state` live/suspend/preopen/test/…; `instCategory` 3 = Stocks; `openType` "pre_quote" | `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]`, descending (observed) | Issuer not in the public API. OKX API Agreement §9.4 (US text) bars display and redistribution of Market Data. |
| **Bitget** | `api/v2/spot/public/symbols` → 200 | time, tickers (RAAPL, RMSFT), fills, candles 15min/1day; **orderbook → code 40502 "Please upgrade to access the V3 API"** | observed `status` "online"; v1 docs list offline/gray/online; UTA enum adds listed/limit_open/restrictedAPI | `[ts, o, h, l, c, baseVol, quoteVol, usdtVol]`, ascending (observed) | Last public fill for RAAPLUSDT was 8 days old (2026-10-12) while 15-minute candles show hundreds of thousands of units: the figures do not describe an open spot book. Classified `unified-share-equivalent`; discovery only, no adapter. |
| **KuCoin** | `api/v2/symbols` → 200 | timestamp, stats, level1, level2_20, histories (100 trades, ns time), candles 15min (window) | observed `enableTrading` true, `market` "Stocks"; field meanings not documented on the served pages | `[time s, open, close, high, low, volume, turnover]`, descending (observed; sample in docs matches); documented max 1500 rows | Only AAPLX and TSLAX of the watch list. |
| **Kraken** | `0/public/AssetPairs` → 200 (no tokenised pairs); `?aclass_base=tokenized_asset` → 200 (354 keys, 177 pairs) | Ticker/Depth/Trades/OHLC **fail without** `asset_class=tokenized_asset` (`EQuery:Unknown asset pair`, `EGeneral:Invalid arguments`) and succeed with it; OHLC 15 → 721 rows | documented `status` online/cancel_only/post_only/limit_only/reduce_only; `asset_class` documented as required for xStocks | `[time s, o, h, l, c, vwap, volume, count]`, ascending, max 720 rows (documented) | Quote is **USD** (ZUSD) only, so a USD→USDT leg would be needed. Support article (2026-06-18): xStocks not for US, UK, Canada, Australia; not via API for EEA clients. |

## 5. Data-use terms: reachable is not permitted

Read on 2026-10-20 from each venue's own legal pages (verbatim clauses and URLs are recorded in `services/stocks-global/DATA-RIGHTS.md`, section "2026-10-20"). "RESTRICTS" means an explicit restriction on resale, commercial use, redistribution or automated collection was found and no grant of display rights was found.

| Venue | Assessment | Basis |
|---|---|---|
| Gate | RESTRICTS | User Agreement §2.2 (no resale or third-party use), §2.11 (unauthorised API use, scraping), §10.1(d), §16.2 (non-commercial licence) |
| MEXC | RESTRICTS | User Agreement (2026-10-13) §17(d)(iii): websites/apps that profit from market data obtained from MEXC are prohibited without written consent; §17(e), §39 |
| BingX | RESTRICTS | Customer Agreement (2026-09-02) §6.2(2)–(3): data-feed services and monetised sites using BingX market data prohibited without written consent |
| OKX | RESTRICTS | API Agreement (US text, updated 2026-07-28) §3.2(a), §9.4: "You may not: (a) resell, redistribute, publish, display … Market Data"; public accessibility grants no right |
| Bitget | RESTRICTS | Terms of Use (2026-10-20) §10.1 non-commercial licence, §11.1(ii) resale/commercial use, §11.1(ix)(a) bots, §11.1(xii) copying/redistribution |
| KuCoin | RESTRICTS | Terms of Use (2026-09-29) Art. 90–92: no commercial use, no systematic extraction, no collection of prices |
| Kraken | RESTRICTS | Global Terms (2026-10-19) §8–§9: Our Content only for your own benefit; no distribution, scraping, bots or third-party apps without consent (EEA §11 not read verbatim) |
| Binance, Bybit | NOT CLEARED | unchanged assessment of 2026-10-10 in `DATA-RIGHTS.md` |

Operational rule implemented: `venuesFromEnv()` refuses a venue listed in `STOCKS_VENUES_ENABLED` unless the same id is in `STOCKS_VENUE_RIGHTS_CONFIRMED`; a `MarketHub` without `venues` lists no venue row and answers `DATA_RIGHTS_UNVERIFIED` to venue reads without touching the network. This is not legal advice; it records what the published text says.

## 6. Recommendation for the first launch

1. **Binance bStocks through `data-api.binance.vision`** (host option on the existing adapter). Covers all six symbols including MSFT; the deepest books and tightest spreads of the set; the documented public-market-data host answered from a region where `api.binance.com` is 451. Blockers: rights (non-commercial licence), the production region must be checked for both hosts.
2. **Gate xStocks** (new adapter `gate`). Issuer evident in the API, explicit `trade_status`, candles with a closed-window flag, 1000-row pages, five of six symbols (no MSFT). Blockers: rights; thin at times (stale last trade while the book is live, see §4).
3. **MEXC xStocks** (new adapter `mexc`). Same issuer family as Gate with the strongest identity evidence (Solana mint), four of six symbols (no MSFT, no QQQ). Blockers: rights; thinner than Gate; `id: null` on public trades (the adapter keys quotes on the depth `lastUpdateId`); one timeout observed.

Reserves, not wired: **OKX** (six of six, good depth, clean API; blocked on issuer identification, which the public API does not provide, and on §9.4 of its API Agreement) and **Kraken** (six of six including MSFTx, documented xStocks; blocked on USD quote, regional availability and rights). Not recommended: **Bitget** rToken (not an open spot book; v2 order book refused; fills stale), **KuCoin** (two symbols), **BingX** (numeric JSON, unreadable documentation, thin). **Bybit** stays as the existing adapter and must be verified from the production region.

Source order per underlying is recorded in `SOURCE_PRIORITY` (`catalog.mjs`): Binance, Gate, MEXC, Bybit for AAPL/NVDA/TSLA; Binance only for MSFT; Gate then MEXC for SPY; Gate for QQQ.

## 7. Architecture

- **`services/stocks-global/venues.mjs`**: `VENUES` registry. An adapter is a plain object with `hosts`, `rights`, `intervals`, `maxRows`, `instrumentUrl`/`parseInstrument`, `tickerUrl`/`parseTicker`, `quoteUrls`/`parseQuote`, `historyUrl`/`parseHistory`. It maps the venue's shapes to the hub's native quote fields and to ascending `[openTimeMs, open, high, low, close, volume]` rows, the shape the existing Binance path already feeds into `parseCandles`/`nativeOrder`. A missing field is `INVALID_DATA`/`INVALID_CANDLES`; a failed request is the hub's `SOURCE_HTTP_*`; no adapter answers for another. `venuesFromEnv()` is the opt-in.
- **`services/stocks-global/market.mjs`** (minimal seam, Codex logic preserved): constructor options `venues` (default `[]`) and `binanceHost` (default `api.binance.com`; only `BINANCE_HOSTS` allowed); the host allowlist admits an adapter's hosts only when that venue is enabled; `catalogue()` adds one bounded metadata and ticker read per enabled venue instrument and lists enabled venue rows after the existing catalogue; `quote()` and `history()` gain one `else if (VENUES[i.provider])` branch each and refuse disabled venues with `DATA_RIGHTS_UNVERIFIED`. Bybit, Binance and MOEX branches, caches, budgets, history window, freshness and FX code are unchanged; the six Binance URL literals now use the configured host.
- **`services/stocks-global/catalog.mjs`**: `issuer` on every row (`xstocks`, `bstocks`, `moex`); `VENUE_CATALOG` (Gate ×5, MEXC ×4) listed only when enabled; `SOURCE_PRIORITY` and `rankedSources()`; `instrument()` resolves both lists. The existing 40 rows and their ids are unchanged.
- **`services/stocks-global/venue-discovery.mjs`** and **`discover-venues.mjs`**: pure classifiers for the nine venues (source type, issuer evidence, venue status → TRADING/SUSPENDED/DELISTED/UNKNOWN/UNAVAILABLE/NOT_VERIFIED, precision, timeframes, ticker, spread, candle order check) and a bounded read-only runner that writes the evidence directory. Unauthenticated GETs, no redirects, 300 ms spacing, 20 s timeout, no retry.
- **Adding a venue** = one adapter object, catalogue rows with their issuer, captured fixtures and a test. No change to the engine, ledger, account worker, authority, server routes or frontend.
- **Not wired to the runtime**: `release-market.mjs`/`runtime-market.mjs` still construct `new MarketHub()` with no venues, so production and the CLI behave exactly as before. Proposed wiring, for the CTO's decision: `new MarketHub({ venues: venuesFromEnv(env), binanceHost: env.STOCKS_BINANCE_PUBLIC_HOST ?? 'api.binance.com' })` in `createStocksRuntimeMarket`, after rights confirmation.

## 8. Tests and checks

| Check | Result |
|---|---|
| `node --test services/stocks-global/venues.test.mjs` | 5/5 PASS: venues off by default and refused without network; Gate and MEXC catalogue/quote/history from captured bodies with exact URL routing (any other URL is 404); identity/priority with a failing source; Binance host option |
| `node --test services/stocks-global/venue-discovery.test.mjs` | 3/3 PASS: nine-venue classification from captured metadata (Bybit 403 → NOT_VERIFIED), ticker/candle readers and failed-read handling, bounded runner and table |
| Existing `services/stocks-global/*.test.mjs` (non-PG) | **290/303 on the base commit and 290/303 on this branch, the same 13 failures** (`release-startup`, `hosted-pilot` subprocess and PostgreSQL environment not available here; `ws` resolved from a sibling install). No regression attributable to this change. |
| Live discovery run | `discover-venues.mjs`: 89 requests in 7.6 s, Bybit 403, all other reads 200 (`docs/evidence/stocks-venues-20261020/`) |
| Not run | PostgreSQL suites, Docker build, CI workflows, frontend; no full-suite rerun (forbidden by the brief) |

## 9. Integration instruction (for the CTO; nothing here was executed)

1. Verify the bundle: `git bundle verify stocks-feeds-<sha>.bundle`; fetch into a scratch clone of the application base `98c577d4`; confirm the diff touches only `services/stocks-global/{catalog,market,venues,venue-discovery,discover-venues}.mjs`, the two new test files, `testing/fixtures/venues/`, `README.md`, `DATA-RIGHTS.md`, `docs/STOCKS_MARKET_DATA_DISCOVERY_20261020.md`, `docs/evidence/stocks-venues-20261020/` and `docs/AI_HANDOFF.md`.
2. Run the two new suites and, in an environment with `ws` and PostgreSQL, the existing `services/stocks-global` suites.
3. Re-run `node services/stocks-global/discover-venues.mjs <dir>` from the production region to settle Bybit (403 here) and the Binance host question (451 on `api.binance.com` here).
4. Decide the rights path per venue; until a venue is confirmed, keep `STOCKS_VENUES_ENABLED` unset. Nothing in this slice changes production behaviour while it is unset.
5. Decide MSFT (Binance only in this slice), SPYB/QQQB on the Binance list, and whether OKX's issuer can be confirmed in writing.

Forbidden actions, unchanged: no merge, deploy, live trade, real balance, provider activation, production migration, user-account change, paid infrastructure, full-suite rerun or synthetic generator.
