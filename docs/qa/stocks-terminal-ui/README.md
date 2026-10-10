# Stocks terminal — isolated UI review

Separate branch `codex/stocks-terminal-ui-20261008`, based on PR #471 exact
`13fe4a8f9aad5d873612fdb0be57c027767336c6`, with current main
`b607fd68d997ecdda00217215c704c7a9dd72848` integrated. PR #471 is preserved.
No production deployment, feature activation, financial write, Worker or VPS change.

## Result and boundaries

- Reuses Futures/Spot `OrderFamilyTabs`; the new optional family subset leaves existing callers' five/default and four/archive families unchanged.
- Native terminal colors, tabs, field captions, trailing currency/ticker units, pill button, spacing and surfaces are scoped to Stocks. No Futures financial form or account hooks are mounted.
- Buy/Sell, Limit/Market, editable price/quantity drafts, read-only unknown Total and balance. Placement is disabled and submission is prevented, including Enter/programmatic form submission. A short message states that stock trading is unavailable. Switching instruments resets the ticket.
- Existing list, search, regions, favorites, panel/overview, routes and official chart retained. Technical footer/provider heading and empty session field removed. Known metadata retained, no invented facts.
- Official chart branding/attribution retained, along with the localized delayed-data disclosure. Provider data is neither extracted nor used in the ticket.
- Production defaults remain OFF. Widget preview is explicitly enabled only for this isolated build.

## Verification

- TypeScript: passed. Both default OFF build and widget preview production build: passed. Existing large-chunk warnings remain; no warning threshold was raised.
- Full frontend regression: run for all 240 suites / 4078 tests. Windows checkout line-ending conversion caused a legacy byte-digest failure; restoring exact existing Git asset bytes makes the unchanged 10-test integrity suite pass. Full exact-head Linux CI is the authoritative final result; see the Draft PR checks.
- `stockOrderPanel.test.ts`: network dependencies forbidden, unknown balance/Total, disabled submit, usable tabs, keyed ticket reset, and unchanged shared tab defaults. Widget lifecycle and all seven dictionary guards pass.
- Fixture browser: **691 assertions**, seven languages × 1920/1440/1366/430/390/360/320, no horizontal overflow, usable ticket, disabled submission, draft reset, search/favorites, back/forward, blocked script/retry, visibility and route disposal.
- Live official embed: **76 assertions**, visually verified candles for NASDAQ:AAPL/NVDA/MSFT/AMZN/GOOGL/META/TSLA/AVGO/COST/NFLX. Screenshots inspect only visible rendered pixels, not provider DOM/data APIs.
- Navigation: 49 locale/width views; Spot → Futures → CFD → Stocks → Spot, direct detail reload and back/forward at desktop and four mobile widths. Crypto terminal classes/tokens/chart styles/route state unchanged. Zero attempted writes and zero Stocks API reads. External crypto traffic stays on read-only loopback fixtures.
- Fixture and live runs: zero financial requests, zero Stocks backend reads, zero application page errors. No real balances, accounts or orders used.
- Host replacement p95: fixture **82 ms**, live **111 ms**; cold host p95 **294/254 ms**. These measure the VOLTEX host, not quote readiness, and are not financial API load measurements.
- Fixture GC memory: 3 documents / 767 nodes / 277 listeners before, 3 / 751 / 277 after 30 switches; after exit 1 / 77 / 174. Heap 5.97 → 6.67 → 3.69 MB. Live 12 switches: 4 documents / 1601 nodes remain constant, heap 26.15 → 27.96 MB. No growing iframe/DOM accumulation observed; no long-duration or mobile-hardware claim.

## Screenshots and recording

[Desktop 1920](desktop-1920.png), [1440](desktop-1440.png), [1366](desktop-1366.png).
[Mobile graph + ticket](mobile-390.png), [mobile ticket](mobile-ticket-390.png).
Other mobile screenshots explicitly use an empty lifecycle fixture, not market prices:
[430](layout-fixture-430.png), [360](layout-fixture-360.png), [320](layout-fixture-320.png).
[24-second switching recording](instrument-switching.webm) shows the same UI implementation before the additive current-main integration; Stocks code is unchanged by that integration.

JSON reports retain measurements and error/request counters. Full frontend results and browser evidence are also uploaded by CI; resource, disk-I/O and backend comparison gates inherited from #471 are retained. Their legacy collector artifacts do not authorize a production launch. This task only prepares the official-widget UI.

## Isolated preview

Running locally: <http://127.0.0.1:4435/stocks/XNGS%3AAAPL>.
This loopback URL requires this computer to stay on; it is not the production site.

To reproduce from this branch on Windows:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix frontend --ignore-scripts --no-audit --no-fund
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
npm.cmd run build --prefix frontend
npm.cmd run preview --prefix frontend -- --host 127.0.0.1 --port 4435 --strictPort
```

The preview has no API server and uses a relative financial API path; there is no connected stock execution. Automated crypto-page checks use only existing loopback fixtures. The ordinary Cloudflare Pages branch build keeps Stocks OFF; do not confuse that build with this explicitly enabled widget preview.

No merge, production publish or automatic merge is authorized. Stop after exact-head CI and await owner review.
