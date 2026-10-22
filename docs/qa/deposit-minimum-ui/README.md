# Deposit minimum UI — draft review only

Base: `188b24542c20b65b0aaaa85df1d6f5a9a2a02209` (`origin/main`, freshly fetched).
Reconciled with newer main `9df0f4711c9eb41e7e8435718857387bdb89698e`
after its external merge of PR #415; no terminal changes added by this PR.
Branch: `codex/deposit-minimum-ui`. No merge or production deployment.

## Scope

The existing DepositCatalogueDialog now presents the minimum as a neutral
label/value row. The accumulation explanation is no longer rendered. Seven
locale dictionaries gain the two presentation strings; the old keys remain
for compatibility. This is not a new minimum rule.

The network cards, selection, address, QR, copy feedback, safety warning and
both Header/Wallet entrypoints remain unchanged. Below 308px available grid
width the network cards retain their existing adaptive stacking.

No backend, API, database, watcher, accumulation, attribution, confirmation,
credit, balance or trading changes. The minimum helper, existing page-price
read, expiry timer and formatting remain unchanged: 500 for server-defined
USD-pegged assets; equivalent rule for other assets, with an estimate only
while an already-held live quote is current. No new requests or polling.

## Local validation

- Frontend TypeScript and production Vite build: PASS. Existing large-chunk
  warning and isolated-fixture catalogue-URL warning remain.
- Deposit/localization Jest suites: 104 tests / 8 suites PASS.
- A broad Windows frontend run hit its 240-second process limit before a
  final summary. Five unrelated CRLF/raw-SVG-sensitive suites failed
  (chartDrawings, priceChartMarketOrders, cryptoCardVisualConsistency,
  cryptoCardProductionPromotion, spotOrderEntry); those sources/assets are
  untouched. This is not a full-suite PASS; use fresh Linux CI on this head.
- Mounted fixture browser regression: 707 checks PASS, zero errors or
  external requests. Both entrypoints: one initial catalogue fixture read,
  zero reads during interactions, zero reads during 60 seconds idle.
- Responsive: 1920x1080, 1440x900, 1366x768, 430x932, 390x844, 360x800,
  plus the existing 1440x1000, 320x568 and 1440x480 cases.
- USDT and BTC (unpriced/priced), no clipping, network layout, clipboard
  success/failure/races, independent QR decoding, keyboard/focus, stale
  quotes and expiry without a parent render remain covered.
- The optional unchanged deposit-packages PostgreSQL harness could not
  start locally because its embedded PostgreSQL dependency was unavailable;
  no database was contacted. Do not describe it as a local PASS.

Run the existing `scripts/qa-deposit-ui.cjs` against the loopback
`frontend/qa/deposit-preview.html` with `VITE_MANUAL_DEPOSIT_CATALOGUE=true`
and `VITE_API_URL=/api/v1`. All addresses are synthetic. The fixture blocks
unexpected API calls, and the runner blocks external requests. Browser
evidence is generated in ignored `output/deposit-minimum-ui/`; CI retains
its own artifact via the existing deposit-catalogue workflow.

Representative images: `header-1440x900.png`, `header-390x844.png`,
`header-btc-estimate-390x844.png`. Exact-head CI is reported on the Draft PR;
local results or a branch preview are not production publication.
