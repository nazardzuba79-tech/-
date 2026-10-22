# Markets page → CFD: loading is not an outage (2026-10-22)

`CfdMarketsSection` showed «Торговля CFD временно недоступна» whenever its ticker
list was empty, including on every cold open while the first snapshot was in
flight. The quote supply was not at fault.

## Production endpoint, probed 2026-10-22 13:40Z (read-only GET, three requests)

`https://market.voltextech.net/cfd/display/tickers?v=9`

| request | HTTP | `cf-cache-status` / `age` | snapshot `capturedAt` | instruments | quote age at response |
| --- | --- | --- | --- | --- | --- |
| 13:40:24Z | 200 | HIT / 1381 s | 13:17:23Z | 13 | ≈ 1382 s |
| 13:40:29Z | 200 | none (fresh capture) | 13:40:29Z | 13 | 0–2 s |
| 13:40:33Z | 200 | HIT / 4 s | 13:40:29Z | 13 | 4–6 s |

- All 13 configured instruments, each with a price, bid ≤ ask, `status: sampled`,
  `stale: false`, `marketClosed: false`, `provider: biquote`. `sources: ["biquote"]`
  means biquote supplied all 13 (Deriv, EIA and Frankfurter fill only missing ones).
- `_display: { mode: "snapshot", refreshMs: 21600000 }` and
  `cache-control: public, max-age=21600, s-maxage=21600, stale-while-revalidate=300`:
  the established 6-hour display snapshot. Each Cloudflare location keeps its
  own copy, so two requests seconds apart may return snapshots of different age
  (here 23 minutes and fresh). Within a snapshot the per-row `stale: false` /
  `maxQuoteAgeMs: 120000` describe the quote at capture time, not at delivery.
  No HTTP error, CORS or envelope problem: the browser's `readDisplayJson`
  accepts the response as it is.
- The 13:40:29Z body is kept as `production-snapshot-20261022T134029Z.json` and is
  the fixture of the browser QA below (real prices, not invented).

## Fix (frontend only)

- `useCfdTickers` also returns `loaded`: set by the first readable snapshot.
- `CfdMarketsSection`: rows when there are rows; otherwise **unavailable** only
  for no configured source, a failed read with nothing received, or a received
  snapshot without instruments; otherwise **loading** — placeholder rows with
  the real rows' grid (3 in the CFD card, 4 in «Популярные деривативы»),
  `aria-busy` and a screen-reader «Загрузка...».
- Quote supply, the Worker, the 6-hour cache, CFD orders, balances and the
  terminal's own list are unchanged.

## Browser QA — `scripts/qa-cfd-markets-loading.cjs` (1440×900 and 390×844)

| check | `main` 3ea2b407 (`before-main-*`) | this branch (`after-*`) |
| --- | --- | --- |
| cold open, snapshot held in flight: no unavailable message, 7 placeholder rows | **FAIL**: the message twice, no placeholders | PASS |
| then the 13-instrument snapshot: rows, first row XAUUSD 4067.569 | — | PASS |
| HTTP 503 from the ticker route → message | PASS | PASS |
| snapshot with no instruments → message | PASS | PASS |
| `configured: false` → message | PASS | PASS |
