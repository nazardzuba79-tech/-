# VOLTEX Admin Listings — historical movement continuation (REVIEW, 2026-10-14)

## Status

**Implemented in Draft source, not deployed, not published.** Current production NRX/AITH/VTA and ordinary Spot are unchanged. This feature is for a **non-tradable, isolated simulated listing** only, not real-money trading. No 24-hour Hetzner monitoring, data purchases or external provider API calls were started by this branch.

## What the admin can do

Admin → Listings → create or edit an UNPUBLISHED listing → enable “Настроить движение в демонстрационном режиме” → “Поведение после всех этапов” → **“Исторический ритм BTC / ETH / SOL (после падения)”**.

When the selection is enabled on a typical new listing, the editor appends a 24-hour **−55% pullback** after its existing growth stages if no final pullback exists. Existing user-defined final pullback is kept. For programs at the 720-hour stage limit, the admin must shorten an existing stage before adding a pullback.

The admin chooses which asset's hourly MOVEMENTS to import and uploads an **operator-supplied CSV**. Expected normalized rows (without a header, Kraken-style, or with the exact header):

```text
timestamp,open,high,low,close[,volume,trades]
```

- Timestamp: UTC hour (UNIX seconds, UNIX milliseconds or ISO UTC `Z`), strictly hourly without missing or duplicate timestamps.
- Choose a **start date UTC** and a 1 / 7 / 30 / 90-day window directly in the Admin UI. The file can cover up to **12000 consecutive 1h bars / 3 MiB**, but only the chosen 24–2400-hour excerpt is stored. Blank date starts at the file's first candle.
- 24–2400 bars per selected source clip; up to 3 clips and 4800 hours combined; compact draft replay metadata capped independently, whole config max 80 KiB for the existing 100KB API size budget.
- Hourly **relative high/open, low/open and close/open movement**, rounded to signed PPM, is stored. Original source prices, real source volumes and historical timestamps (other than first-source UTC date) are not re-used in public candles.
- The source string BTC/ETH/SOL is an **admin claim**, not verified against a venue. It is never evidence of source authenticity or redistribution rights.

After a successful save of the draft, “Предпросмотр” → “Поведение после роста” uses the **same backend simulation** that computes candles, book, simulated tape and ticker. The first hour starts at the programmed final fall price. One real UTC hour uses exactly one uploaded historical hour (no speed multiplier). A following ETH clip joins seamlessly to the final BTC simulated price; source absolute quotes never appear. No future candles are shown on normal real-time reads.

Within each source hour, actual source OHLC does **not** reveal whether the high or low happened first or what the 10-second/5-minute path was. The deterministic renderer reaches the imported relative OHLC levels at model-chosen times and produces model-only volumes. Label it *model*, not authentic 10-second historical market data. After the final available clip, bounded neutral model motion replaces historical replay; no source data is invented.

## Security and licensing

**PUBLICATION IS BLOCKED IN BOTH UI AND SHARED BACKEND `checkPublishable`** (code `HISTORICAL_RIGHTS_UNVERIFIED`). A successful admin draft save is not a production listing. The old “range” selection and existing published versions remain unchanged.

No offline CSV automatically grants permission for use. Binance Vision dataset terms (26 August 2026) explicitly impose non-commercial use restrictions, including derived data: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md . Kraken publishes CSV OHLCVT but publication alone is not permission to redistribute/monetize-derived movement data: https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data .

Before considering any public release: obtain independently documented suitable permissions for every dataset and derived use, verify ingestion provenance/hash, confirm legal presentation of simulations and isolate all simulation pricing/ledger effects from executable Spot balances and real financial operations. Do NOT set an override or allow unverified data to publish.

## Review acceptance

- Client and server CSV converters produce identical signed PPM bars on the same fixture.
- Reject missing hours, invalid OHLC, bad timestamps, unknown symbols, overflow, excessive data, replay without final fall.
- Scripted growth and prior candles do not change when the continuation selection is enabled.
- Source hours run in real time and successive clips join without price gaps.
- 1m/5m/1h canonical server pipeline keeps ticker, candles and modeled volumes consistent; baseline NRX/AITH/VTA golden histories unchanged.
- No remote data fetch, no orders/deposits/withdrawals, no on-chain reads, no billing, no production changes.
- Exact PR-head CI, independent TS build and backend/frontend tests must pass before any merge.

This branch is deliberately **draft-only**. Neither merging unrelated PRs nor deploying old candidate branches is authorized by the presence of these files.

## 2026-10-14 — Local reusable historical period library (follow-up)

**Implemented only in Draft PR #518.** The Admin now offers the offline **«Библиотека исторических сценариев»** in `ListingHistoricalEditor`, without changing the shared DTO, backend order routes or publication gate:

- Suggested selections: BTC January/April/October 2018, ETH January/April/October 2021, SOL January/April 2022, each exactly 90 × 24 = **2160 distinct source hours**. These entries have dates and labels ONLY: they do **not** contain imaginary or bundled market candles. An entry is disabled until a corresponding continuous CSV covering its full window is present in the local library.
- One-time **operator CSV import** validates all 24–12000 source hours using the existing strict client importer (timestamps, OHLC, continuity), computes SHA-256 of raw source bytes, then **discards all absolute OHLC prices and volumes**. Only relative signed PPM movement triples survive in a separate v2 IndexedDB database (maximum 8 archives / 12 MiB total, 3 MiB per source upload). The raw CSV hash stays as an unverified historical fingerprint; a second SHA-256 covers the saved relative movement bytes and is rechecked before reuse. Neither hash proves exchange provenance or rights. Device/browser deletion loses the library; no cloud sync.
- Users can click **«Добавить»** on an available preset or choose a previously saved source archive plus date/duration. The selected `HistoricalClip` still contains only signed relative PPM movements and `USER_SUPPLIED_UNVERIFIED`; its original CSV is never sent to backend.
- One existing function checks the same limits for both direct CSV imports and library excerpts: at most 3 clips / 4800 replay hours / 65 KiB serialized draft program, with exact 1 source hour = 1 simulated hour. Existing growth/fall and published history are unchanged.
- Both client and server **continue rejecting PUBLICATION** for this mode with `HISTORICAL_RIGHTS_UNVERIFIED`. No toggle to assert that a CSV is licensed, no false claim of validated BTC/ETH source identity and no route around ledger isolation.
- The `scripts/qa-listing-controls.cjs` browser regression covers library import → removal of current clip → reuse without CSV; it separately tests that an ETH 2021 90-day preset is disabled until its matching real fixture is imported, then enabled, and public publish remains disabled. Unit tests check 2300-hour integrity, date coverage, digest tampering, and exact 2160-hour clipping. CI runs these tests on PR HEAD.

**External licensing review (2026-10-14):**
- Binance Vision terms: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md — publicly downloadable OHLC and derived models are subject to non-commercial limitations; there is no blanket production redistribution permission.
- Kraken historic OHLCVT: https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data — download availability does not itself establish publishing rights.
- CryptoDataDownload: https://www.cryptodatadownload.com/terms-of-use/ — free samples expressly limit commercial uses.

**Unresolved for public enablement** (must be demonstrated, not silently bypassed): documented suitable rights per archival data source, credible source provenance for each uploaded CSV (a digest alone is not enough), explicit simulation disclosure and separation from ordinary executable Spot balances/orders; end-to-end resource regression on actual target infrastructure. Until then **Draft/review, non-tradable only**.

## 2026-10-14 — privacy improvement: movement-only local library

The original Draft implementation cached raw CSV prices in browser IndexedDB even though the saved listing used PPM movements. The follow-up refactor now parses and validates the complete CSV in memory, then **persists only relative movement triples**, period metadata and two separate SHA-256 digests; source prices and source volumes are discarded after the import operation completes. A new local database name `voltex.admin.historical-movements.v2` prevents compatibility ambiguity with the experimental (never released) raw-CSV schema. Imported clips and public DTOs have not changed. This does **not** grant publication rights or turn a simulated asset into a real token.

## 2026-10-17 — completion on current main: demo contour, scenario management

**Base:** `main` `db844642` merged into this branch (merge commit `a1cd0218`). Three conflicts were reconciled by intent:
- `AdminListingsPage.tsx`: main's action dock from #500 is kept, and the historical publish note and the disabled «Опубликовать» moved into it.
- `ListingMovementEditor.tsx`: the historical editor and main's `listing-section-stages` anchor are both kept.
- `adminListings.css`: both blocks are kept.

NRX, AITH and VTA keep their histories. The NRX legacy identity and source projection, AITH replacement, capped demo listings, and VTA demo and coexistence tests all pass on the merged tree.

### How managed listings touch money today (research, `origin/main`)

- Managed listings are restricted test assets for deposits, withdrawals, balance adjustments, futures collateral and demo orders (`isTestAssetPairOrSymbol`).
- Spot accepts orders only for a published, `tradable`, started listing. Any listing with a movement program is non-tradable (`DEMO_ONLY`).
- The published-listing price feeds:
  - wallet valuation (`WalletPortfolioService.pricesFor`);
  - conditional-order triggers (`spotPriceSource`);
  - card eligibility.
- Owner allocation writes real `Balance` inventory, with no USDT.
- Drafts live only in the Durable Object. Preview is pure computation.
- No simulation state is stored in PostgreSQL, so there is no table of model events to duplicate.

A historical draft never reaches Render's catalogue because publication is refused. Before this change, nothing else stopped the model price from flowing into those paths if that one gate were ever lifted.

### Historical demo contour (`src/services/listings/simulationContour.ts`)

A historical simulation (`scenario-controls-v2`, `afterGrowth: 'historical'`) has **no identity in the real ledger**. The refusals below hold even if it ever reached the published catalogue:

- It stays a restricted test asset everywhere, as every managed listing.
- The Spot gate refuses it outright, before the owner's simulation sale.
- Its model price never triggers a conditional order and never values a wallet. It gets no price at all, not even a colliding venue ticker.
- It holds no inventory:
  - `ownerAllocation` must be `0` (`HISTORICAL_DEMO_NO_LEDGER`);
  - `allocateListingOwner` refuses it before any database call.

Existing listings are untouched: no stored record changes, and NRX, AITH, VTA and other managed listings behave as before. Public trading of simulated assets stays off.

### Scenario management in Admin → Listings (no global design change)

- **Choosing the model.**
  - The historical continuation can be chosen after the stages.
  - Fragments come from the 8 dated presets (BTC 2018, ETH 2021, SOL 2022). A preset activates only after an operator CSV import.
  - The admin can also import their own CSV, or reuse a locally saved archive.
- **Active model.** It is spelled out as stages → fall → each fragment → neutral motion. The list shows which listings carry a historical model.
- **Future movement before saving.**
  - For each fragment: start and end price on this listing, change, high and low.
  - The whole replay is drawn as daily candles from its relative moves. This needs no server work and adds no model wicks.
- **Server preview.** A new «Исторический отрезок» horizon is bounded like the growth horizon: the first 30 days, at most 720 simulated hours per request. Computing the maximum 4800-hour replay whole took about 11 s of CPU here (synthetic movements), so it is not offered.
- **Reuse.** A saved model of another listing (its draft or published version) can be applied without a CSV or a local archive. It is stored on the server with the listing.
- **Safe return to the ordinary scenario.** The fragments are removed, and so is the default −55 % fall the editor added. A fall the admin edited stays. The editor says what it removed. The listing can be published again after the draft is saved.

### Verification added

- `historicalDemoContour.test.ts`:
  - ledger refusals;
  - phases run in order;
  - no price jump at the stage → BTC → ETH → neutral seams;
  - every ten-second model event is unique and identical when recomputed;
  - a restart (fresh modules, configuration re-read) continues the same market;
  - the history preview.
- `historicalDemoContour.pg.test.ts`: nine real-money entry points refuse the asset on disposable PostgreSQL, and no row of any other module changes. The tables checked are balances, Spot and demo orders and trades, deposits, withdrawals, futures balances, snapshots and the audit log.
- `listingMovementHistorical.test.ts`: switching in and out, the plan, plan candles and the label.
- `qa-listing-controls.cjs`: active model, plan, first-30-days preview, list badge, reuse, safe return, and layout at 1440, 390 and 320 px.

### Still blocked (unchanged, deliberately)

`HISTORICAL_RIGHTS_UNVERIFIED` stays fail-closed in the UI and on the server. Publication needs:
- documented rights for each dataset and its derived use;
- credible provenance for each uploaded CSV (a hash is not provenance);
- an explicit legal presentation of the simulation.

No merge, deploy, production migration, paid resource or real balance change was made.
