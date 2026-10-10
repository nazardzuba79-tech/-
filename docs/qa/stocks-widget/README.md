# Stocks V1: $0 official widget preview — 2026-10-08

Owner decision supersedes the earlier paid-feed recommendation: no subscription,
no provider purchase, no production activation. This increment continues PR #471.
Fresh remote main: `824a91327a885e765656d87d01aeb593f2226741`; previous PR head:
`2b4e897a47de569aab30fac55e6f0afce3fb9127`. Both verified again before publishing.

## Free public display, not a market-data API

[TradingView's widget product page](https://www.tradingview.com/widget/)
offers Advanced Chart free for embedding on websites, with default branding,
and lists business users including Coinbase and OKX. The
[official integration example](https://www.tradingview.com/widget-docs/tutorials/build-page/widget-integration/)
provides the exact script used here. No key, account or paid plan is required.
This is the official display-only product, not a right to redistribute its feeds.

[Data FAQ](https://www.tradingview.com/widget-docs/faq/data/): exchange permissions
determine availability; paid personal plans do not unlock widget feeds;
export/download is unavailable; there is no market-data API for this purpose.
[Terms](https://www.tradingview.com/policies/), sections 3–4, restrict redistribution
and non-display use and require original widget attribution. The product-specific
free website-embed offer is the basis for this POC; it is not a separate negotiated
commercial feed licence or an unlimited-use legal guarantee. Preserve branding
and use only the official embed as offered. No chart data enters VOLTEX trading,
accounting, risk, own history, JSON API, collector or SQLite.

## Preview and design

Dark panel, light Overview, header/navigation, search, region filters, favourites,
mobile drawer and existing `/stocks/:canonicalInstrumentId` remain. No trading
buttons. Static reference catalogue contains ten company names/tickers and null
quotes/session changes. Existing table price columns show `—`; prices/history
exist only inside the official chart. Overview subtitle and facts explain this
instead of claiming VOLTEX stores 15-minute candles.

Local preview: `http://127.0.0.1:4433/stocks/XNGS%3AAAPL` (built preview; keep the
local terminal running). Switch AAPL/NVDA using the existing list or mobile drawer.

Reproduce from repository root (no stock-service origin):

```powershell
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
npm.cmd run build --prefix frontend
node frontend/node_modules/vite/bin/vite.js preview frontend --host 127.0.0.1 --port 4433 --strictPort
```

Both flags are build-time and default OFF. Query parameters cannot enable them.
No production environment, Pages config, DNS, backend, balance or order changed.
The old collector/reader experiments remain separately gated historical work;
they are not launched by this preview and are not the proposed $0 data path.

## Real instruments: visual embed evidence

All ten live US screenshots showed real candles/volume and TradingView branding:

| Company | Exact TradingView symbol |
|---|---|
| Apple | `NASDAQ:AAPL` |
| NVIDIA | `NASDAQ:NVDA` |
| Microsoft | `NASDAQ:MSFT` |
| Amazon | `NASDAQ:AMZN` |
| Alphabet Class A | `NASDAQ:GOOGL` |
| Meta | `NASDAQ:META` |
| Tesla | `NASDAQ:TSLA` |
| Broadcom | `NASDAQ:AVGO` |
| Costco | `NASDAQ:COST` |
| Netflix | `NASDAQ:NFLX` |

Configured interval `15`; the chart showed 15-minute candles. Official
[North America matrix](https://www.tradingview.com/widget-docs/markets/north-america/)
identifies Cboe One **Delayed Stocks** for NASDAQ/NYSE/Arca. Do not label these as
real-time consolidated NASDAQ quotes or full consolidated volume. No numerical
delay is promised: the matrix says delayed, without publishing minutes.

Regional research uses one official daily chart at a time outside the product's
ten-US-stock allowlist. Screenshots were assessed visually, never by extracting
provider DOM, prices, responses or sockets. Existing on-site symbol pages alone
were not treated as proof of embed permission.

| Region/example | Exact symbol tested | Actual result | Delay evidence |
|---|---|---|---|
| Russia, Sberbank | `RUS:SBER` | Daily candles rendered; **not added** to POC | Provider displayed `D` (delayed). Minutes unconfirmed; RUS is absent from the official Europe matrix |
| Japan, Toyota | `TSE:7203` | Provider: “This symbol is only available on TradingView” | Unavailable in embed; no delay claim |
| Hong Kong, Tencent | `HKEX:700` | Same provider restriction | Unavailable in embed; no delay claim |
| China, Kweichow Moutai | `SSE:600519` | Daily candles rendered | EOD (`E` badge and official matrix) |
| China, Ping An Bank | `SZSE:000001` | Daily candles rendered | EOD (`E` badge and official matrix) |
| Shanghai Composite | `SSE:000001` | Daily index rendered | EOD (`E` badge and official matrix) |
| Hang Seng | `HSI:HSI` | Daily index rendered | EOD (`E` badge and official matrix) |
| S&P 500 cash index | `SP:SPX` | Provider-only restriction | Unavailable; no proxy substituted |
| Nasdaq 100 cash index | `NASDAQ:NDX` | Provider-only restriction | Unavailable; no proxy substituted |
| Dow Jones | `TVC:DJI` | Provider-only restriction | Unavailable; no proxy substituted |

The [Asia-Pacific matrix](https://www.tradingview.com/widget-docs/markets/asia-pacific/)
confirms SSE/SZSE EOD stocks/indices and HSI EOD indices. It does not list Tokyo
equities or HKEX equities. TOCOM futures/indices are not Toyota stocks. The
[Europe matrix](https://www.tradingview.com/widget-docs/markets/europe/) does not
confirm MOEX/RUS. SBER observed availability is a narrower finding, not a claim
that all Russian exchanges/instruments work. No regional availability guarantee
for Russia/VPN: the test used this computer's current network, not Russian VPNs.

## Lifetime, errors, performance and load

Only selected symbol mounts. One VOLTEX disposable `srcdoc` browsing context
contains one official provider frame. Removing that outer frame destroys its
script environment on selection, locale, retry, route exit or hidden-tab change.
Branding/link remain visible and provider controls are not modified. This wrapper
is a **lifetime boundary**, not an untrusted-script security sandbox.

Invalid canonical IDs cannot inject/embed arbitrary symbols. A blocked script or
20-second script-bootstrap timeout shows translated failure + retry. Loading the
script is not interpreted as successfully loading quote data. Cross-origin
provider errors are left to the provider's own message, with an always-visible
localized network/availability explanation and retry. No provider DOM inspection
is used to detect symbol errors. Lack of provider error callbacks is a limitation.

Recorded on Windows Chromium, built Vite preview, anonymous isolated context:

| Check | Result |
|---|---|
| Live US embed/browser assertions | 41 passed; all ten charts visually rendered; mobile NVDA rendered |
| Fixture browser assertions | 253 passed; 7 languages × 1920/1440/1366/430/390/360/320; 30 SPA switches; favourites/filter/search; back/forward; 4 mobile drawer sizes; retry/unknown/exit |
| New financial API / stock-reader requests | **0 / 0** in both runs |
| Browser app errors | 0 in both successful runs |
| Live cold navigation → VOLTEX widget host | 72–242 ms, median 214 ms (13 navigations; not quote readiness) |
| Live SPA host replacement | 61–153 ms, median 74 ms (12 switches; not quote readiness) |
| Live post-GC JS heap | 26.67 → 28.39 MB after 12 switches; document/node counts stable at 4 / 1594 |
| Fixture post-GC JS heap | Approximately 5–7 MB while mounted; approximately 3.5 MB after exit; 3 → 1 documents |

Live screenshots settle for 8 seconds before capture; this is an observation
window, **not** a measured eight-second chart-ready time/SLA. CDP heap/document
metrics are not total browser RSS and do not prove a long-duration absence of
leaks. Provider bundles run on clients and add memory/network cost. Twelve live
switches showed bounded document count; longer soak and actual Russian VPN,
Firefox/Safari/real-device mobile remain unverified.

Hetzner gains **zero new quote polling, collectors, database writes or financial
API reads** from this mode, only normal frontend/static delivery. No service or
resource ceiling is increased. Historical p95/disk-I/O findings for the separate
SQLite reader are not claimed fixed or accepted by this frontend-only switch.
The widget mode bypasses that runtime; its earlier CI/evidence gates stay intact.

## Localisation and repeatable validation

Own UI/translations preserved in ru/en/zh/es/hi/ja/ko. Official provider locale is
ru/en/zh_CN/es/en/ja/ko respectively. **Hindi falls back to English inside the
widget only** because Hindi is absent from the official
[supported-language list](https://www.tradingview.com/widget-docs/faq/languages/).
The surrounding VOLTEX UI remains Hindi; this fallback is explicitly tested.

Focused frontend regression: **78 tests / 6 suites passed** (including frozen translation integrity). Default-OFF build
and widget build pass (existing >500 kB chunk warning retained). The attempted
full local frontend run exceeded its 240-second bound and also exposed existing
Windows CRLF-sensitive source assertions; no full local pass is claimed. Exact
Linux CI runs the complete frontend regression and existing repository gates.
CI result must be read from the final exact PR head, not this pre-publication doc.

`scripts/qa-stocks-widget.cjs` fixture mode blocks external hosts and uses an
empty lifecycle double, explicitly **not fake market data**. `--live` permits
only official TradingView domains; reads no provider content. CI adds fixture
widget QA after the existing Stocks UI/navigation checks. Regional research is
`scripts/qa-stocks-widget-regions.cjs` and deliberately not a flaky CI live feed.

Evidence: [desktop](evidence/desktop-aapl.png), [mobile](evidence/mobile-nvda.png),
[Overview](evidence/overview.png), [blocked scripts](evidence/blocked-script.png),
[live metadata/metrics](evidence/live-report.json),
[fixture metadata/metrics](evidence/browser-report.json),
[region embedding metadata](evidence/regions-report.json). All individual live
and region screenshots remain in the local `output/stocks-widget*` directories.

No merge, deployment, API purchase, financial mutation or Stocks activation.
Publication requires the owner's separate decision after reviewing this preview.
