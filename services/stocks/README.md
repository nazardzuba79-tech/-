# Stocks V1 — review only, NOT ready for production

No crypto API route, financial PostgreSQL connection, wallet/order service or market-edge worker is changed. Stock reads and collection run in a separate Node process and separate SQLite file. Shared host CPU/disk remain contention paths. Production flag and every instrument are OFF.

## Local operation

Node 24.21.0 (verified local SQLite 3.53.4). No additional npm dependencies.

```
node --test services/stocks/core.test.mjs
```

Set `STOCKS_DATA_DIR` to a dedicated empty local directory; explicitly run `node services/stocks/runtime.mjs init` once. With `STOCKS_ENABLED=true`, `node services/stocks/runtime.mjs` serves the separate read API on loopback port 8091. It will show metadata and no prices with the checked-in entitlement settings. It refuses `DATABASE_URL`. Do not attach the financial database volume or Docker socket.

For local UI review only, use `VITE_STOCKS_ENABLED=true` and `VITE_STOCKS_ORIGIN=http://127.0.0.1:8091`. The stock service needs `STOCKS_FRONTEND_ORIGIN` matching the local frontend. Default builds do not expose stock routes/navigation. There is no implicit `/api` fallback.

Browser test: set `QA_PLAYWRIGHT_MODULE` to Playwright, start Vite at `127.0.0.1:4422` with stock origin `http://127.0.0.1:4422/stock-fixture`, then `node scripts/qa-stocks.cjs`. Quotes are intercepted fixtures, never production. API writes and outside WebSockets are denied. Real screenshots are under `output/stocks-qa/`.

## Activation gates — deliberately not satisfied

1. Confirm per-instrument commercial public-display, storage and cache entitlements, 15-minute coverage, publication lag, currency and adjustment contract. A public metadata listing is not this proof.
2. Review catalogue liquidity/issuer/share-class associations; this is a provisional candidate universe, **not a verified current top-250 ranking**. Index objects are distinct; no ETF substitution. Company IDs/approved logos need a separate reviewed source.
3. Supply a verified exchange calendar in the private stock data directory: `{verified,sourceUrl,validUntil,publicationDelayMs,sessions:[{instrumentId,open,close}]}`. All times are epoch milliseconds; sessions may be split around breaks and move across DST. No calendar means no collection. Holiday/short-session provenance remains unverified.
4. Manual activation stages: 10 → 25 → 50 → 100 → 250. Explicitly review `enabled`/`dataRightsStatus` and set `STOCKS_ACTIVE_STAGE` to the approved ceiling. No automatic escalation or production enabling is included.
5. Re-run comparable crypto A/B/C/D/E/F tests under the **aggregate** hard quota before any rollout. The isolated CI includes the original real Spot/Futures service workload, three repeats of A/B/C/D10/D50/D100/E/F, raw timings, and actual cgroups. Service-call checks are not HTTP/E2E or production acceptance; inspect exact-head artifacts and variance.

## Limits and storage

`limits.json` is the single validated budget. Gateway concurrency 1, start gap ≥2 seconds, at most 500 candles/response, at most 250/transaction, writer 1. Responses are bounded while reading decoded bytes before JSON parsing (1 MiB). No upstream request queue. Bounded retry (at most 2 retries), Retry-After/circuit pause, timeout and abort. No provider fallback.

Read API: 300 default/500 hard limit; canonical IDs, bounded cursor, parameter SQL. Two admitted reads, eight waiting with a 2-second deadline; overflow 503/Retry-After. Byte-bounded 16 MiB cache and singleflight. Read transactions finish before socket transfer. 32 connections and bounded slow-client timeouts. GET cannot initialize storage, write, fetch provider data, import logos or trigger history.

SQLite uses **DELETE/FULL**, one process/writer, busy timeout 200 ms. WAL is deliberately not enabled. Runtime tested separately from crypto; no common Node/SQLite upgrade. Strings retain decimal prices. Unique instrument/interval/time/adjustment key; corrected provider values update, identical values do not. Null index volume stays null. No fabricated gap candles or FX conversion.

Stock-only quota 1 GiB (all files below its dedicated directory), free space floor 10 GiB; 19 MiB reserved below the quota for rotated logs and bounded transaction growth; imports stop on shortage. Additional physical WAL guard is present even though this version uses DELETE. No global cleanup, VACUUM in requests or system modifications. Retention is bounded initial 30-day history; automatic expiry/longer history is not enabled.

Backfill supports one resumable instrument checkpoint and one ≤500-candle step, maximum reserved 1000 candles/minute and 30 days. Explicit local commands: `node services/stocks/control.mjs backfill-start MIC:SYMBOL`, `backfill-pause`, `backfill-resume` with the same private `STOCKS_DATA_DIR`. The single runtime checks this operator file, runs current collection first, then at most one backfill page per 30-second turn. No control file means no backfill. Cursor survives process restarts. Production provider/calendar backfill validation is still blocked by missing entitlements. No history archive is materialized in RAM.

## Provider evidence, checked 2026-10-07

| Source | Verified | Not verified / activation blocker |
|---|---|---|
| [Twelve Data reference](https://support.twelvedata.com/en/articles/5179026-symbol-is-missing) | Public metadata downloaded; source time/hash in `catalogue-sources.json`; 245 stocks + 5 actual indices | Metadata does not establish liquidity ranking, issuer linkage or per-account candle access |
| [Historical candles](https://support.twelvedata.com/en/articles/5656039-how-to-get-historical-prices) | 15-minute endpoint and bounded output parameters documented; adapter prepared | No entitled live response/30-day depth/lag/calendar verified for any of the seven countries |
| [Commercial use](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage), [business plans](https://twelvedata.com/pricing-business) | External display depends on business/exchange terms | No VOLTEX external-display/cache/storage license supplied; all regions disabled; no plan purchased |
| [MOEX ISS](https://www.moex.com/a2920), [information use](https://www.moex.com/s3503) | ISS access and separate information-use rules exist | Free URL is not a public-display permission; no MOEX adapter activated |
| [SQLite WAL](https://www.sqlite.org/wal.html), [release history](https://sqlite.org/changes.html) | WAL-reset fix is documented; local SQLite version inspected | No WAL assumption; DELETE journal selected and asserted |

At 250 active symbols, a single poll uses ≥250 requests/credits (not one batch credit) and ≥500 seconds of request spacing. With every request needing both retries: up to 750 requests and ≥1500 seconds, beyond a 15-minute cycle. Thus 250 simultaneous collection is **not approved**. Initial 30-calendar-day continuous-session upper bound is 720,000 candles/250 symbols, ≥1440 response pages, ≥720 minutes at 1000 candles/minute before provider/exchange restrictions. Actual licensed limits can only reduce throughput. Credits for retries count too. There is no automatic backfill or hidden quota increase.

## Logos

0 imported; 250 safe symbol/index fallbacks. `import-logo.mjs` is a one-off operator importer for an explicitly approved issuer/source/license record; allowlisted HTTPS host, redirects rejected, 10-second timeout, streaming 20 KiB maximum, PNG only with bounded dimensions, local content hash and provenance. No request-time import/hotlink/SVG HTML. Actual issuer asset rights are still missing.

## Resource evidence and stop

`compose.review.yaml` is isolated review configuration only, not production configuration. `.github/workflows/stocks-review.yml` checks real cgroup CPU/memory/swap values, three stock-only samples and ENOSPC on a separate 8 MiB tmpfs. This is not an I/O throttle or Crypto A/B test. No host block device is guessed. Local Windows has neither Docker nor installed WSL; CI supplies Linux cgroups and a disposable PostgreSQL comparison. **Hard I/O throttling and production-comparable capacity acceptance remain blockers**. The fixture workload uses 500 candles/symbol; a separate 720,000-candle storage proof measures a conservative 30-day continuous-session upper bound, not licensed history.

SIGINT/SIGTERM stop the collector, abort provider requests, clear timers, close sockets/storage and remove the singleton lock. A crash leaves a lock and fails closed: verify no stock PID is running before removing that file. Stopping the stocks process/container does not restart any crypto service. Disable `VITE_STOCKS_ENABLED` and stop only the stock process to remove the review surface. No production infrastructure was configured.

Metadata preparation shares the serial 1 MiB gateway; oversized country metadata fails closed and needs a provider-supported bounded export, never a raised runtime limit. Existing source snapshots retain their original hashes.
