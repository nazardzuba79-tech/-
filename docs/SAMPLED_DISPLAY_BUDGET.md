# Sampled public display budget

Owner request (23 September 2026): keep the terminal looking animated without continuously downloading reference prices; homepage two updates per twelve hours and CFD four per day. This document describes the implementation, not a claim of successful production deployment.

## Customer-visible behaviour

- All catalogue instruments remain present. Public Futures/Spot reference market data and the displayed book use shared 60-second snapshots. Switching instruments requests the selected instrument immediately unless the same observation is still cached.
- The public Futures tape retains actual observed trades, their identities and timestamps. No animation generates executions or changes numerical values.
- The homepage reuses its existing six-hour persistent snapshot. Both terminal renderers have local decorative animation; the previous Kraken live overlay is removed. No animated video/image download is required.
- CFD display tickers and requested symbol/timeframe candles have six-hour caches at both the public HTTP alias and the browser. Existing position engine and data sources are not changed.
- A snapshot label and observation time distinguish sampled data from live depth. CSS only animates decorative highlighting, not prices, quantities, cumulative bar widths, timestamps or directions. Reduced-motion preferences and hidden tabs stop decorative movement.

## Financial isolation

No file under src/private-trading, src/futures, src/cfd, prisma or the account/ledger services changes in this PR. Original financial routes and freshness checks remain. The internal collector still refreshes its source data at the existing cadence; the lower cadence is applied at explicit public display aliases. Local CFD practice continues its existing SIM behaviour and is not promoted to real execution.

## Transport and cache boundaries

Additive GET routes: /market/display; /market/display/futures-book/:symbol; /market/display/futures-trades/:symbol; /market/display/spot-book/:pair; /market/display/spot-snapshot; /cfd/display/tickers; /cfd/display/candles/:symbol.

Public response caches are bounded, coalesce in-flight reads, gzip JSON, preserve provider timestamps, expose remaining cache age and back off after source failures. The browser omits credentials, clones shared data, coalesces and reference-counts requests, aborts unused work and persists only bounded CFD display snapshots. A remount uses the remaining lifetime rather than extending an observation by another six hours.

Cached market observations are not an execution quote. A successful display cache read does not authorize an order. Missing or wrong-contract data is rejected, not replaced by fabricated prices.

## Verification and limits

The dedicated suite covers expiry, gzip equivalence, concurrent readers, failure backoff, all 1450 fixture rows, cross-contract rejection, persistence, cancellation/remount, hidden-page silence and immediate visibility recovery. Existing execution and collector suites stay in CI. Browser fixture tests preserve layout, grouping, calculator, price selection and exact submitted order payload at desktop and mobile widths. CFD browser QA additionally checks real provider-backed OHLC and no display re-download on a cached page reload.

No claim is made that this guarantees 5 GB/month for arbitrary visitors. The initial catalogue snapshot and subsequent minute snapshots still consume bytes, and financial/account/candle paths retain their original behaviour. After deployment compare Render outbound at comparable visitor counts, separating initial downloads, persistent traffic and test traffic. The six-hour policy is per cached public dataset and requested chart identity; failed-provider recovery can retry sooner with backoff. Idle services need no artificial keep-alive.

Temporary branch assembly scripts/workflows are not shipped. The permanent gate is read-only and neither merges nor deploys.
