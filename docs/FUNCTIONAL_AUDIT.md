# VOLTEX — functional audit

Route-by-route status of the shipped product, from an end-to-end pass over
every user-facing route and its meaningful interactive controls: UI → handler
→ API → backend service → response → visible result. A control is only
recorded as **working** if that whole chain was followed, not because an
`onClick` exists.

Audited on branch `integration/claude-codex`. Environment: local backend +
Vite dev server, Postgres, a local stand-in for Kraken's public REST API, and
a local SMTP sink. The sandbox's egress proxy blocks CoinGecko,
alternative.me, `ws.kraken.com`, TradingView and Google Fonts; failures
against those hosts are environment, not application, defects and are marked
**test-environment blocked** rather than counted as bugs.

## Status matrix

| Route | Status | Notes |
|---|---|---|
| `/` Homepage | **FIXED** | CFD tab, All-vs-Spot, Futures data + routing, favourites sync, secondary card panel, table width, footer links. Detail below. |
| `/markets` | **WORKING** | Real data, search, category/quote/kind filters, favourites, sort, pagination, sparklines, Spot→`/trade`, Futures→`/futures`. |
| `/trade` Spot | **WORKING** | Deep links, pair search, order book → form, all five order families, real placement/cancel, honest errors. |
| `/futures` | **WORKING** | Real 40-contract universe, mark/index/funding/next-funding/open-interest, new-account leverage cap, isolated/cross, transfer, positions. |
| `/wallet` | **WORKING** | Portfolio, balances, hide balance / hide zero, search, sort, deposit / transfer / withdraw modals, history, activity. Not redesigned (separate task). |
| `/copy-trading` | **WORKING** | Marketplace, tabs, profiles, 7D/30D/90D/ALL, full metric set, $20,000 copy gate. |
| `/arbitrage` | **WORKING** | Real spread endpoint, refresh, honest unavailable state, monitor-only framing. |
| `/card` | **WORKING** | Real route, artwork intact, no broken images, every CTA resolves. |
| `/otc` | **PARTIAL — by design** | Informational shell. No desk, no quote engine; states the eligibility bar and points at support. No dead controls. |
| `/analytics` | **PARTIAL — by design** | Admin-gated, no sections yet. The data foundation exists (`GET /api/v1/analytics/overview`); the UI is a later task. |
| `/admin/*` | **WORKING** | All seven pages load for an ADMIN; non-admins are bounced. Server re-checks the role on every request. |
| Auth / registration / account | **FIXED** | Email → password → confirm → terms → six-digit email code → session. Signed-out visitors now reach the login screen instead of being bounced to the homepage. |

## Homepage repair

The Markets block carried five real defects; all are fixed.

| # | Defect | Fix |
|---|---|---|
| 1 | **CFD tab returned a hardcoded empty list** (`case 'cfd': return []`) while `useHomeMarket` was already fetching `/cfd/tickers` and throwing the result away. | The tab renders the real CFD instruments when a price provider is configured. When it is not, the backend answers `200 {configured:false}` and the tab says so — a configuration state, distinct from an outage, and distinct from "coming soon". No fabricated quotes. Rows link to `/trade?market=cfd&symbol=…`, which the Trade page now honours. |
| 2 | **"Все активы" and "Спот" rendered identical rows** — both fell through to the same `default:` branch. | "Спот" is spot markets. "Все активы" is the union of every product the exchange lists, each asset appearing once and tagged with what it actually trades on (`Спот`, `Спот · Фьючерсы`, `CFD`). No duplicate rows, no tab that exists only to fill the strip. |
| 3 | **"Фьючерсы" filtered spot tickers against a hardcoded `['BTC/USDT','ETH/USDT','SOL/USDT']`.** | The tab reads the real contract list from `GET /futures/config` (`FuturesMarketRegistry`) — 40 contracts in this environment — exactly as the futures terminal and the Markets page do. A listed contract with no live quote is skipped, never shown blank. |
| 4 | **Futures rows linked to `/trade?pair=…`**, a terminal that cannot open a perpetual. | Futures rows link to `/futures?pair=…`. |
| 5 | Spot rows linked to `/trade?pair=…`. | Unchanged — verified still correct. |
| 6 | **Favourites were read once at mount** (`useMemo(loadFavorites, [])`) and never updated. | `lib/pairList` now notifies on write and on another tab's `storage` event; `lib/useFavorites` is the shared hook. The spot pair list, the futures pair list, Markets and this table all read one live set. Starring a pair anywhere is visible everywhere without a reload. |
| 7 | Secondary Crypto Card panel beside the Markets table (small card, Apple Pay, NFC, Получить карту). | Removed. The main Crypto Card section higher on the page is untouched, including the approved artwork. |
| 8 | Table constrained to `1fr + 340px` by that panel. | The table card now spans the section: 1392px of a 1440px viewport. |
| 9 | Footer: "Центр помощи" and "Связаться с нами" both pointed at `/settings`. | Help centre → `/legal/support` (a real document). Contact opens the support chat, which is mounted globally and works signed-out — a button, because there is no page to link to. "О нас" → `/legal/about` added to the Company column. |

Header, hero, ticker, market overview and the main card section were audited
and left as they were: every link resolves, the ticker is real and static, and
the FAQ's six accordions all open and close (`aria-expanded` flips on each).

## The largest defect found: signed-out navigation

`RequireAuth` redirected to `"/"`. For a signed-out visitor that *is* the
homepage, so clicking **Рынки, Торговля, Фьючерсы, Копитрейдинг, Арбитраж,
Crypto Card, OTC**, the hero's **Начать торговлю** and **Получить карту**, any
ticker symbol, any market row's **Торговать**, and every footer product link
put them back exactly where they started — with no sign-in prompt and no
indication why. Verified by clicking all seven header links: every one landed
on `/`.

The guard now sends them to `/login?next=<path>`, and the login screen,
the 2FA step and the registration success screen all return them to that path
once they are in. Only same-origin paths are accepted, so the parameter cannot
be used as an open redirect; `frontend/src/lib/__tests__/returnTo.test.ts`
covers that.

## Interaction inventory

Classification: **working** (chain verified) · **fixed** · **intentionally
unavailable** (honest, no misleading control) · **removed as misleading** ·
**test-environment blocked**.

### Homepage
| Control | Status |
|---|---|
| Logo, 7 header nav links, login, registration CTA | **fixed** (were dead for signed-out visitors) |
| Authenticated header (balance, deposit, language, profile) | working |
| Hero primary/secondary CTA | **fixed** (same redirect defect) |
| Top market ticker (real, static, symbol links) | working |
| Market overview (real metrics, honest missing states) | working |
| Markets tabs — Favourites / All / Spot / Futures / CFD | **fixed** |
| Market row action buttons | **fixed** (futures routing) |
| Crypto Card main section CTAs → `/card` | working |
| Secondary Crypto Card panel | **removed as misleading** |
| FAQ — 6 accordions | working |
| Footer product/legal links | working |
| Footer help centre / contact | **fixed** |

### Trade (spot)
| Control | Status |
|---|---|
| Direct load, `?pair=` deep link, invalid-pair fallback to BTC/USDT | working |
| Pair search (real filter, "Ничего не найдено." on no match) | working |
| Pair sort — volume / price / 24h % / A–Z | working |
| Favourites star | working (now live-synced) |
| Chart intervals 5m/15m/1h/4h/1d/1w, type switcher, indicators, drawing tools | working |
| Order book — live depth, click a price to fill the form | working |
| Buy/Sell, Limit, Market, Stop, Take-profit, OCO | working (all five reach the backend) |
| Order submit → `Ордер размещён`, open-orders badge increments | working |
| Order rejected → visible error banner + toast | working |
| Cancel order | working |
| Open Orders / Order History / Assets tabs | working |
| CFD market (`?market=cfd`, now `&symbol=`) | working |
| Kraken WebSocket book/trades | **test-environment blocked** (REST fallback engages) |

### Futures
| Control | Status |
|---|---|
| Real 40-contract universe from `/futures/config` | working |
| Pair search, sort, favourites, favourites-only | working |
| Last / Mark / Index / 24h / volume / **open interest** / funding / next funding | working (open interest is this venue's own book) |
| `?pair=` deep link, invalid symbol falls back | working |
| Long/Short, Limit/Market, leverage slider + presets | working |
| New-account leverage cap (2x/5x/10x shown, notice rendered) | working |
| Isolated / Cross | working |
| Spot↔Futures transfer modal | working |
| Positions / history / assets, position count badge | working |
| Liquidation volume, long/short ratio, market-wide OI | **intentionally unavailable** — nothing records them |

### Wallet
| Control | Status |
|---|---|
| Portfolio value, spot + futures balances, per-asset available/locked | working |
| Hide balance, hide zero balances, asset search, column sort | working |
| Portfolio chart 7d/30d/90d | working |
| Deposit modal — real chains (Bitcoin, USDT TRC-20, Ethereum ERC20), real address, network warning | working |
| Transfer modal — Spot↔Futures with real balances | working |
| Withdraw modal — appears only on funded rows; required fields, manual-processing disclosure | working |
| Transaction / deposit history, activity feed, explorer links | working |
| Admin demo top-up / balance adjustment | working (admin only, audit-logged) |

### Copy Trading / Arbitrage / Card / OTC / Analytics / Admin
| Control | Status |
|---|---|
| Copy Trading: leaderboard, All traders, Favourites, Following, profiles, 7D/30D/90D/ALL, full metric set | working |
| Copy button gated at a $20,000 deposit | working |
| Arbitrage: real spread endpoint, refresh, honest failure text | working (upstream **test-environment blocked** here) |
| Card: CTAs, artwork, no broken images | working |
| OTC: informational only | **intentionally unavailable** |
| Analytics: admin gate (401 anonymous, 403 non-admin, 200 admin) | working |
| Analytics UI sections | **intentionally unavailable** — data foundation only |
| Admin: 7 pages, role gate, server-side re-check | working |

## Network and console

* `502` on `/market/external/rankings` and `/market/global` — CoinGecko is
  blocked by the sandbox proxy. **Test-environment blocked**; each page shows
  its own honest unavailable state rather than a blank panel.
* `wss://ws.kraken.com/v2` refused — sandbox proxy. The terminal falls back to
  the REST book after 4s, as designed.
* `cdn.jsdelivr.net` coin icons refused — sandbox proxy. `CryptoIcon` renders
  its lettermark fallback.
* Google Fonts blocked — system font stack renders.
* `429` seen only while sweeping many routes from one IP faster than the
  global 120 req/min limiter allows. Not reproducible at human pace.
* `net::ERR_ABORTED` on our own endpoints appears only at page teardown
  (in-flight requests cancelled).
* **Zero uncaught page errors and zero unhandled rejections on every route
  audited**, signed in and signed out.

## Responsive

Homepage, Markets, Trade, Futures and Wallet at 1920, 1440, 1366, 1280, 1024,
768, 390 and 375: no page-level horizontal overflow and no controls clipped
outside the viewport. Secondary pages checked at 1440 and 390.

## Known limitations left in place

* **CFD has no dedicated terminal route.** It is a market mode of `/trade`
  (`?market=cfd`). Homepage CFD rows deep-link into that mode.
* **`/legal/support` copy is stale**: it says the platform has no live support
  channel, while the support chat widget is mounted on every page. Copy only,
  in seven languages — flagged, not rewritten here.
* **OTC is a shell.** No desk, no quote engine, no submission. Stated honestly
  on the page.
* **Analytics has no UI sections.** The endpoint exists and marks unsupported
  metrics as unsupported; the page is a later task.
* **Arbitrage, rankings, global market and Fear & Greed cannot be exercised
  end-to-end here** — their upstreams are blocked by the sandbox.
* `EMAIL_VERIFICATION_SECRET` remains a **production deployment prerequisite**:
  the backend refuses to boot without it.
