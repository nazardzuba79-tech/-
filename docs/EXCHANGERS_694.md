# «Обменники» (/exchangers) — BestChange integration (Issue #694)

Status: code candidate; no BestChange API key exists yet, so only the links mode (below) can work in production. Production needs (1) a BestChange API key set on the Hetzner API runtime env by the
operator, (2) a narrow API release that mounts the router, (3) a Pages release of the frontend. Nothing here
moves money, touches VOLTEX balances, deposits, withdrawals, Copy Trading, Spot, Futures, Wallet, listings or timers.

## Verified facts (2026-11-08)

- Official API: OpenAPI at `https://bestchange.app/en/openapi.yaml` (and `/ru/openapi.yaml`). Every data path is
  `/v2/{apiKey}/…`; the key is a **path segment** (no header auth is documented). Servers: `bestchange.app`,
  `mirror1..4.bestchange.app`. Limits: 30 requests/second, up to 500 pairs per batched `rates` request
  (`/rates/1-2+3-4+…`), same pair more than once per second is pointless (server cache). Use gzip + keep-alive.
- Key: issued in the BestChange partner (referral programme) cabinet. A non-issued 32-hex key returns
  **HTTP 200 `{"error":"Invalid API key"}`**; a malformed key returns HTTP 404 (nginx HTML). Undocumented otherwise.
- `GET /v2/{key}/currencies/{lang}` → `{ currencies: [{ id, name, urlname, viewname, code, crypto, cash, ps, group }] }`.
  It is the **only** source of numeric currency ids. We never hard-code ids; we resolve them at runtime by
  `urlname`/`code` and check `crypto`/`cash`.
- `GET /v2/{key}/changers/{lang}` → `{ changers: [{ id, name, langs, urls: {lang: url}, pages: {lang: url}, reserve,
  reviews, rating, active }] }`. `urls` is documented as "List of exchanger home urls by language" with example
  `https://www.bestchange.ru/click.php?id=1163` — a BestChange-hosted redirect to **that exchanger's own website
  (home page)**. `pages` are BestChange's info pages about the exchanger.
- `GET /v2/{key}/rates/{from}-{to}[+…]` → `{ rates: { <pair>: [{ changer, rate, rankrate, reserve, inmin, inmax,
  marks[] }] } }`. `rate` = "Main exchange rate"; `rankrate` = rate including additional commissions for a $300
  exchange (BestChange's own ranking); `reserve` = max amount of the *receive* currency; `inmin`/`inmax` = limits in
  the *give* currency. No per-row link and no timestamp. Pair key format and `rate` orientation are not documented.
- No documented deep link into an exchanger's order form for a direction exists. BestChange direction pages:
  `https://www.bestchange.ru/{fromUrlname}-to-{toUrlname}.html`; a partner id is appended as `?p={id}` (partner FAQ).
- Scraping BestChange pages is prohibited (FAQ); only the official API is used.

## Decisions

- **Outbound links.** Primary CTA per offer «Перейти к обменнику» opens that exchanger's `urls.ru` (fallback `urls.en`)
  only after strict validation: `https:`, host ∈ {`www.bestchange.ru`, `bestchange.ru`, `www.bestchange.com`,
  `bestchange.com`}, path exactly `/click.php`, query exactly `id=<changer id>`, no fragment/userinfo/port. It is
  captioned that the exchanger's site opens via BestChange and the direction is chosen there. If the link is missing
  or fails validation the offer shows «Выбрать на BestChange» to the direction page instead. A section-level
  «Выбрать на BestChange» direction link is always offered for the selected pair. Links open with
  `target="_blank" rel="noopener nofollow sponsored"` and `referrerPolicy="origin"` (only `https://voltextech.net`
  is sent, never a path or token). The partner id (`BESTCHANGE_PARTNER_ID`, digits) is appended only to direction
  pages, as documented. No VOLTEX token, user data or deposit address is ever added to any link (#693).
- **RUB methods.** Shown from the live `currencies` directory only: the fixed set below if the API returns that
  `urlname` as a non-crypto, non-cash currency, plus any other non-crypto, non-cash currency whose `code` ends in
  `RUB`, labelled with the API's own `name`. A method is available only if at least one rate row exists for it
  towards a supported asset/network. Cash is excluded (needs a city id).

  | id | urlname | label | kind |
  |---|---|---|---|
  | sbp | sbp | Карта и СБП без P2P | payment_system |
  | sberbank | sberbank | Сбербанк | bank |
  | tbank | tinkoff | Т-Банк | bank |
  | alfabank | alfaclick | Альфа-Банк | bank |
  | vtb | vtb | ВТБ | bank |
  | card | visa-mastercard-rub | Карта банка и СБП | card |
  | mir | mir | Карта Мир | card |

  Dynamic extras get id `bc-<urlname>` and kind `bank` unless the name says otherwise.
- **Receive assets** (v0 catalogue, 12 asset:network pairs: USDT on TRON/Ethereum/BSC/TON, USDC on Ethereum/Solana, BTC, ETH, TRX, TON, LTC, SOL). Matched against `currencies` with `crypto === true` by
  `code` (primary) or `urlname`; unmatched pairs are hidden. `TRX:tron` (native TRX) and `USDT:tron` (TRC-20 token)
  are separate entries and can never share a currency id.
- **Rate orientation.** Every supported asset is worth more than 1 RUB, so for RUB→crypto a value < 1 is
  "crypto per RUB" and > 1 is "RUB per crypto". Both `rate` and `rankrate` are normalised to RUB per 1 unit; a row
  with a non-finite or non-positive value is dropped. Default order is BestChange's `rankrate`, with the offers that can
  serve the entered amount (same rule as the crown below) first, so the first row is the crowned one; the other sorts
  are plain one-column orders.
- **Server.** Express router on the Hetzner API (`/api/v1/exchangers/*`), no auth and never a 401. One batched
  `rates` call for all give×receive pairs per snapshot (TTL `BESTCHANGE_CACHE_TTL_SECONDS`, default 45, range
  30–300), stale snapshots served up to 5 minutes with `stale: true`; currencies cached 1 h, changers 10 min;
  in-flight requests coalesced. Route limiter 60 req/min per client (plus the app-wide API limiter); no process-wide constant-key ceiling, since
  client volume never reaches BestChange and a shared counter would let a few clients lock everyone out. Errors are fixed
  strings; the key, the upstream URL and upstream bodies never reach logs or responses.

## Two modes of the page (decided 2026-11-11)

The page never claims more than it can show.

- **live** — the server answered with BestChange data. The page lists real
  exchangers, rates, reserves, limits and reviews, and the visitor picks one.
  This needs `BESTCHANGE_API_KEY` on the API host.
- **links** — there is no rate source: the directory answers
  `{status:"not_configured"}`, or the API release does not carry the route at
  all (HTTP 404 is read as the same state). The page shows **no exchanger, no
  rate, no reserve and no review**. It is not worded as a comparison or a
  catalogue of exchangers: the visitor picks a payment method, a coin and a
  network, and «Выбрать на BestChange» opens that direction on BestChange,
  where the exchanger is chosen.
- In links mode only directions that were checked to exist are offered
  (`src/shared/exchangers/verifiedDirections.ts`): a HEAD request to
  `https://www.bestchange.ru/{from}-to-{to}.html` answered 200 (an unknown
  direction answers 301 to the home page). Status only; no page content is
  read. Checked 2026-11-11: 66 directions = Карта и СБП без P2P, Сбербанк,
  Т-Банк, Альфа-Банк, ВТБ, Карта банка и СБП × USDT (TRC-20, ERC-20, BEP-20, TON), BTC, ETH,
  TRX, TON, USDC (Solana), LTC, SOL. Not confirmed and therefore not offered:
  «Карта Мир» (candidate urlname `mir`) and USDC ERC-20 (candidate
  `usd-coin-erc20`). Re-check by hand with `node scripts/qa-exchangers-links.cjs`.
- What each link opens was confirmed once from the page titles of 16
  directions (every payment-method urlname and every receive urlname at least
  once; titles only, no rates read). The two generic methods carry BestChange's
  own names: urlname `sbp` is «Карта и СБП без P2P», `visa-mastercard-rub` is
  «Карта банка и СБП». A 200 answer proves the direction page exists; it says
  nothing about how many exchangers currently offer it.
- **The main scenario of #694 — choosing a specific exchanger on VOLTEX — works
  only in live mode.** Without a key the feature is not complete, and the links
  mode must not be presented as the finished exchanger catalogue.

## API contract

`GET /api/v1/exchangers/directory`

```json
{ "status": "ok" | "not_configured" | "unavailable",
  "asOf": "2026-11-08T08:00:00.000Z" | null,
  "methods": [{ "id": "sbp", "label": "Карта и СБП без P2P", "kind": "payment_system", "available": true }],
  "assets":  [{ "assetId": "USDT", "networkId": "tron", "available": true }] }
```

`GET /api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=10000`

```json
{ "status": "ok", "asOf": "…", "stale": false,
  "query": { "method": "sbp", "asset": "USDT", "network": "tron", "amount": 10000 },
  "directionLink": { "url": "https://www.bestchange.ru/sbp-to-tether-trc20.html" } | null,
  "offers": [{
    "id": "1163", "exchanger": { "id": 1163, "name": "…", "rating": 0 | null,
      "reviews": { "positive": 0, "neutral": 0, "claim": 0, "closed": 0 } | null },
    "rubPerUnit": 95.12, "rankRubPerUnit": 95.40 | null,
    "receiveAmount": 105.13 | null,
    "minRub": 1000 | null, "maxRub": 500000 | null, "reserve": 12345.6 | null,
    "marks": ["manual", "verifying"],
    "fitsAmount": true | false | null,
    "link": { "kind": "exchanger", "url": "https://www.bestchange.ru/click.php?id=1163" } | null }] }
```

`receiveAmount` is `amount / rubPerUnit` (the main `rate`), floored to the asset's display decimals: it does not
include the exchanger's extra commissions (those are only in `rankRubPerUnit`) or the network fee, and the page says
so («по основному курсу, без доп. комиссий»). The «Лучший курс с учётом комиссий» crown and the calculator estimate
come from the best `rankRubPerUnit` among offers whose receive amount is known, whose limits do not exclude the amount
and whose reserve is not known to be short of the receive amount.

Other answers: `200 {status:"not_configured"}`, `503 {status:"unavailable", retryAfter}`, `400 {status:"invalid"}`,
`429 {status:"rate_limited", retryAfter}`. Amount is RUB, accepted with `.` or `,`, 1 ≤ amount ≤ 100 000 000.

## Environment (server only)

- `BESTCHANGE_API_KEY` — from the partner cabinet. Unset ⇒ `not_configured`, the page says so honestly.
- `BESTCHANGE_PARTNER_ID` — optional digits, appended as `?p=` to BestChange direction links.
- `BESTCHANGE_CACHE_TTL_SECONDS` — optional, 30–300, default 45.

## Operator check after the key is set

`BESTCHANGE_API_KEY=… node scripts/bestchange-key-check.cjs 10000` on the API host prints a non-secret summary:
which RUB methods and asset/network pairs were matched in the live directory (BestChange's own names), and for
СБП/Сбербанк → USDT TRC-20 the number of real offers, the best RUB per USDT and how many exchanger links passed
validation. Without a key it prints `not_configured` (exit 2); with a non-issued key the official API answers
`{"error":"Invalid API key"}` and the script prints `not_configured` — verified 2026-11-08 against bestchange.app.
