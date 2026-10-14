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
- One-time **operator CSV import** validates all 24–12000 source hours using the existing strict client importer (timestamps, OHLC, continuity), computes SHA-256 of raw bytes, and retains the CSV in **this browser's IndexedDB only**; maximum 8 archives and 12 MiB total, 3 MiB per source file. Browser storage deletion or another device loses this library, so it is not a cloud sync. The hash detects local corruption and is verified again before reuse; it is **not proof of exchange provenance or usage rights**.
- Users can click **«Добавить»** on an available preset or choose a previously saved source archive plus date/duration. The selected `HistoricalClip` still contains only signed relative PPM movements and `USER_SUPPLIED_UNVERIFIED`; its original CSV is never sent to backend.
- One existing function checks the same limits for both direct CSV imports and library excerpts: at most 3 clips / 4800 replay hours / 65 KiB serialized draft program, with exact 1 source hour = 1 simulated hour. Existing growth/fall and published history are unchanged.
- Both client and server **continue rejecting PUBLICATION** for this mode with `HISTORICAL_RIGHTS_UNVERIFIED`. No toggle to assert that a CSV is licensed, no false claim of validated BTC/ETH source identity and no route around ledger isolation.
- The `scripts/qa-listing-controls.cjs` browser regression covers library import → removal of current clip → reuse without CSV; it separately tests that an ETH 2021 90-day preset is disabled until its matching real fixture is imported, then enabled, and public publish remains disabled. Unit tests check 2300-hour integrity, date coverage, digest tampering, and exact 2160-hour clipping. CI runs these tests on PR HEAD.

**External licensing review (2026-10-14):**
- Binance Vision terms: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md — publicly downloadable OHLC and derived models are subject to non-commercial limitations; there is no blanket production redistribution permission.
- Kraken historic OHLCVT: https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data — download availability does not itself establish publishing rights.
- CryptoDataDownload: https://www.cryptodatadownload.com/terms-of-use/ — free samples expressly limit commercial uses.

**Unresolved for public enablement** (must be demonstrated, not silently bypassed): documented suitable rights per archival data source, credible source provenance for each uploaded CSV (a digest alone is not enough), explicit simulation disclosure and separation from ordinary executable Spot balances/orders; end-to-end resource regression on actual target infrastructure. Until then **Draft/review, non-tradable only**.
