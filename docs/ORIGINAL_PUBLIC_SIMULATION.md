# Original models for future public simulated listings

## Data rights decision

The historical20 candidate remains private. Binance's official Public Data Terms and Conditions, version 1.0 updated 26 August 2026, license the dataset under CC BY-NC-SA 4.0. Sections 2.4, 3.1, 3.4, 4.3 and 4.4 cover derived charts/models and require a separate written enterprise agreement for commercial use. The repository's MIT code licence does not establish commercial dataset permission. No applicable VOLTEX enterprise agreement has been verified. The existing `HISTORICAL_RIGHTS_UNVERIFIED` gate stays in force.

Source checked 11 November 2026 — https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md

Commercial display licences are available from providers such as MarketData, subject to their plan, dataset and redistribution terms. No purchase or applicable agreement was verified for this task. Such a licence would require a separate dataset-specific review before using historical observations in a public listing.

Provider policy — https://www.marketdata.app/docs/account/data-policies/data-redistribution/

## Original candidate

`voltex-original-regimes-v1` uses hand-authored abstract phase levels, unequal seeded phase durations, bounded drift, correlated shocks, activity clusters, pauses, sampled intratick excursions and modelled volume. It imports no historical observations, historical replay pack or fitted market statistics. The implementation and parameter table are committed for review. No source dataset is copied, transformed or replayed by this model. This provenance finding is the basis for the original candidate.

Twenty selectable regimes cover trend pauses, false breakouts, compression, impulse/retest, stair-step movement, declining bounces, capitulation, recovery, distribution, double support, expanding/damping ranges, acceleration, selloff/buyback, extended consolidation, short spikes, growing waves, failed breakouts, volatility transitions and alternating impulses.

An explicit `originalRegime` opt-in applies only when creating a new draft. AUTO rotates through 20 assignments using the store's existing creation ordinal. Saved assignments and model versions are immutable. Existing drafts and published listings cannot acquire this mode. No current config file, listing, clock or price is updated. Unresolved AUTO cannot be published.

Each model has a version, seed and mandatory `SIMULATED_ORIGINAL_MODEL` disclosure. The catalogue, candles, book, tape and ticker carry `ORIGINAL_GENERATIVE`, `historicalDataUsed=false`, `priceAndVolume=SIMULATED` and `withdrawable=false`. The existing terminal and catalogue display `DEMO · SIMULATED · NO REAL TRADING`.

All public model data uses the existing canonical simulation tick path. The same minute observations aggregate to the other intervals. Ten-second updates reveal only completed ticks. An open candle can change as ticks arrive. Completed candles reproduce after reload, reverse-order access, cache eviction and restart. Preserve the v1 algorithm and parameters for stored v1 records. Future algorithm changes require a new version and dispatch path.

The new mode requires zero owner allocation, disabled execution and no private funding. It participates in the existing restricted-asset/no-ledger protections for Spot, conditional price triggers, collateral, wallet valuation and funding. Existing trading rules for other modes remain intact. A modelled book is display data and supplies no execution liquidity.

New original listings use UTC five-minute boundaries, matching the existing canonical five-minute aggregation. Hour-aligned and non-hour starts are tested. Admin preview supports 1m, 5m, 15m, 1h, 4h and 1d. Before saving an automatic-seed draft, the preview uses an explicitly stated preview seed. After saving, both preview and public data use the stored seed.

## Verification

- `originalRegimes.test.ts` exercises every regime's positive OHLCV, body/tail diversity, direction changes, seed differences, continuity, cache eviction and deterministic restart. It also covers canonical aggregation, completed history, 20 AUTO assignments, future/publication guards, historical rights refusal, financial exclusions and provenance.
- `qa-listing-history20.cjs` with `QA_ORIGINAL_REGIMES=1` uses the built frontend, real authenticated admin router and persisted SQLite Durable Object. It creates 20 isolated drafts, tests publication/start boundaries, restarts the Worker, advances only the isolated Worker clock and compares public candles with saved preview.
- Browser checks cover 20 modes × 6 intervals × 2 widths, yielding 240 screenshots. Public terminal checks at 1440/390 include visible provenance, canvas, reload and zero financial requests. Fixture identities and loopback services are used throughout.
- `scripts/history20/legacy-parity.cjs` compares seven unchanged listing configurations and 252 interval/time snapshots with the pinned pre-candidate baseline. It covers VTA, NRX, ECLV, QVTR, AITH, NRYIA and AELRI.

## Integration boundary

This PR is a source candidate. Production installation requires separate owner approval and an API/Worker/frontend release from the then-current production base. The API needs original config validation, immutable assignment, preview and canonical simulation modules. The Worker needs the same validator, assignment, generator and public provenance. The frontend needs the new admin selection/preview and shared definitions. Existing public disclosure rendering is reused.

The older sealed `ai-listing-runtime` artifact targets a different release and does not install original regimes. It must not be presented as this candidate's release artifact. No database migration, ledger write or activation of an existing listing is part of this candidate.

Before first publication, retain the previous API image, Worker version and Pages deployment. A rollback before original-mode publication restores those components. After any original listing has been published, an older engine cannot reproduce that mode. Retain its versioned generator and stored configuration, and use a compatible rollback or forward fix. Never silently fall back to a legacy generator, erase candles or change a timer to hide an incompatibility.
