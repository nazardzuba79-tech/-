# Inverse, options and CFD data — review implementation

Base: GitHub main `1b431c74e1c6d4a371aa5f2c5f198b4ff6974de8`.
Original implementation base: `ab564ae46dcbad3b2e6f4ea8bed874eb4115961b`.
Ordinary main-to-review merge: `ce279dc6997361d96691e0b0b996eed0452cabfe`.
Branch: the existing `codex/inverse-options-cfd-data`.
Review branch only: no PR merge, deployment, production configuration or secret changes.

## Sync with admin PRs #36 and #37

Current main was merged into the existing PR branch without rebase or force push.
Only `docs/AI_HANDOFF.md` conflicted: both complete appended histories were kept.
`frontend/src/lib/api.ts` auto-merged the current-main admin methods with the CFD
ticker response type. The Futures header preservation test auto-merged the
reviewed main API fingerprint with the PR-specific CFD type normalization.
No assertions were removed or relaxed during sync.

Admin pages/styles, App routes and admin backend routes match exact current main.
Overview, grouped compact navigation, full wrapping/copyable deposit addresses,
removed Source column, save/reset confirmation and removed Products admin route
are preserved. Market-data/CFD sources match pre-sync PR head
`384a43a1c7a07d751a9eed098cf872c5f68d49ac`. See
[`main-sync-preservation.json`](qa/inverse-options-cfd/main-sync-preservation.json)
for exact source checks. No live provider counts were re-measured for this sync;
the dated observations below retain their original provenance.

## What changed

The Frankfurt collector now discovers, bootstraps and streams Bybit inverse
instruments alongside spot and linear. `InversePerpetual` and `InverseFutures`
remain separate identities, including when their base/quote pair is identical.
Inverse cannot enter the USDT linear-perpetual execution eligibility predicate.
The existing Oregon execution registry remains unchanged in scope; inverse is
included only in the collector's reference universe. Provider volume units are
explicit: inverse volume is quote currency, turnover is base currency, despite
the historical `quoteVolume24h` field name.

Pagination exhausts provider cursors with a 40-page bound, rejects loops and
empty continuation pages, and does not issue per-symbol requests. REST snapshots
cannot rewind WS prices or reset the sequence high-water mark at an equal event
timestamp. Disconnects retain stale last-good quotes, recover a category snapshot
and resubscribe. Existing framed transport, epoch/revision validation, slow-client
backpressure and frontend read-only reference handling continue to apply.

Options use short-TTL REST snapshots, not thousands of global subscriptions.
The complete universe uses `category=option&baseCoin=All&limit=1000`; the collector
holds one ticker batch per discovered base. Filters and pagination operate on
those shared batches. Exact provider metadata owns currencies, Call/Put and
delivery; the isolated documented-symbol parser supplies strike and cross-checks
base/type/date/settlement. Malformed instruments reject the refresh rather than
silently shrinking a supposedly complete universe. Missing quote fields remain
null; actual zero and negative Greeks are retained.

CFD consumers now depend on `CfdQuoteSource`, not Twelve Data. Every leveraged
open/close/liquidation requires verified provider entitlement, live availability,
and both a fresh provider timestamp and fresh receipt timestamp. Only OPEN also
requires explicit new-position execution approval. The default
maximum age is 5,000 ms; configuration accepts only 250–10,000 ms. Checks repeat
inside the transaction before financial writes and after intervening balance
awaits. Expiry, missing metadata, outages and malformed prices fail closed.
Open/close expose HTTP 503 with `cfd_quote_temporarily_unavailable`; liquidation
skips invalid prices. The provider's exact decimal close survives into BigNumber
accounting. Twelve Data close is a single reference price: bid/ask/mid stay null,
and no spread is manufactured.

`assertCfdFreshQuote` is the shared risk gate: matching instrument identity,
explicit `entitlementVerified: true`, live/not-stale status, both timestamps and
a valid positive provider price. `getFreshQuote` does not consult the opening
whitelist; `assertCfdOpenQuote` adds `executionAllowed: true` only for OPEN,
including increases to an existing position. CLOSE, LIQUIDATION and existing
position mark/PnL use the risk gate alone. Removing a symbol from
`CFD_EXECUTION_SYMBOLS` must not remove it from `CFD_VERIFIED_LIVE_SYMBOLS` if its
verified provider entitlement still exists and open risk needs quotes. Entitled
symbols remain in provider batches and keep the short server cache TTL even
when their new openings are disabled.

If a quote expires after a balance write but before the position write, the
transaction rejects and rolls back. The liquidation loop catches only quote
unavailability outside that transaction and proceeds to the next position;
unrelated database errors still propagate. Stateful transactional test doubles
exercise this rollback signalling; they do not replace PostgreSQL integration QA.

The original CFD margin, leverage, weighted-entry, PnL, negative-balance protection
and liquidation-forfeiture formulas remain. No changes to spot accounting,
futures matching, futures mark prices, funding, liquidation math, tiers, Copy
Trading economics, wallet ledger, deposits or withdrawals. The existing six-symbol
reference watchlist remains compatible with existing gateway/wallet readers;
new verified instruments are fetched only after explicit entitlement approval.

## API contracts

| Route | Access / behavior |
| --- | --- |
| `/internal/v1/options/instruments` | Existing collector bearer auth; full-universe cached pages |
| `/internal/v1/options/tickers` | Same auth; `baseCoin` required; one cached batch per base |
| `/api/v1/market/options/instruments` | Public read-only backend proxy to configured collector only |
| `/api/v1/market/options/tickers` | Same; no Oregon-to-Bybit fallback |
| `/api/v1/cfd/catalog` | Verified support, entitlement and independent execution approval |
| `/api/v1/cfd/tickers` | All catalog rows, nullable prices, quote status, timestamps and max age |
| `/api/v1/admin/cfd/diagnostics` | Existing JWT/session auth plus database ADMIN role; catalog, quotes, quota usage |

Options query: optional `baseCoin`, ISO `expiry` (`YYYY-MM-DD`), `cursor`, `limit`
(1–500, default 100). Tickers require a known base; no arbitrary-base cache keys.
Bad input returns 400. Cursor revision/filter mismatch returns 409: restart
pagination instead of mixing snapshots. A cursor includes process epoch,
snapshot receipt time, universe receipt time and filter identity. Missing
collector/provider data returns 503. Proxy response schemas discard extra fields;
tokens are never public, upstream redirects are forbidden, errors are sanitized.
Public options requests are limited to 120/minute/IP.

Universe TTL is 15 minutes, with a bounded 60-minute stale extension. Option
ticker TTL is 5 seconds with a 30-second stale extension. Provider event age
over 5 seconds is visibly stale; provider timestamps older than 30 seconds,
future by over 5 seconds, or older than the held provider revision reject refresh.
The ticker cache has at most 32 discovered bases. Options are always
`executable:false` and `mode:rest_snapshot`. There is no options WS or global SSE
fan-out. A later live source can implement the same normalized paged contract,
but must introduce ref-counts, idle cleanup, caps and recovery before activation.

The CFD terminal lists unavailable instruments with `—`, disables unsafe order
submission, rechecks quote expiry on a 500-ms UI clock and repeats the gate when
submitting. Failed polling invalidates trading approval on held rows. Reference
mode polls at 60 seconds; explicitly approved execution rows use a bounded
2.5-second client cadence, coalesced behind the server cache/quota owner. The
server remains authoritative. Chart-provider support is separate from quote
support; the existing honest chart-unavailable fallback remains for unmapped
new instruments.

## Provider observations — not hardcoded runtime counts

Measured using the official public API on 2026-09-12 at 13:32 UTC. Saved response
provenance, page counts, representative rows and full-observation digests are in
[`qa/inverse-options-cfd`](qa/inverse-options-cfd). Listings/expiries can change.

| Category | Instruments / contracts | Universe REST pages |
| --- | ---: | ---: |
| Spot | 538 | 1 |
| Linear | 869 (829 perpetual, 40 dated) | 1 |
| Inverse | **28 (22 perpetual, 6 dated)** | 1 |
| Options | **3,358 (1,679 Calls, 1,679 Puts)** | 4 |

Options by base: BTC 738; ETH 664; HYPE 360; XRP 302; MNT 320; DOGE 274;
XAUT 372; SOL 328. All 3,358 normalized without rejection. A separate candidate
options probe retrieved ticker batches for all eight bases in 12 HTTP requests
(4 universe pages + 8 ticker batches); all eight returned non-stale snapshots.

A 20-second **local** public collector probe, 13:46:03–13:46:23 UTC, reached
`live`: 1,435 instruments, 3 live sockets, 56 subscription requests, 19,736 incoming
messages, 8 REST requests including bootstrap. No deployment occurred. Diagnostics
record 748 timestamp rollbacks rejected, zero malformed messages, and no reconnect
during that short sample. This verifies real connectivity, not an endurance/SLA test.

## Verified CFD catalog and account gate

Official `/commodities` and `/forex_pairs` reference rows were actually retrieved.
Provider support is verified for these exact symbols:

| Class | Provider symbols | VOLTEX symbols |
| --- | --- | --- |
| Metals | XAU/USD, XAG/USD, XPT/USD, XPD/USD | XAUUSD, XAGUSD, XPTUSD, XPDUSD |
| Energy | WTI/USD, XBR/USD | WTIUSD, XBRUSD |
| Major FX | EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD | EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD |

Natural Gas was not verified in the retrieved reference list, so it is excluded.
No indices/stocks or Bybit TradFi-perpetual substitutes are enabled for CFD.

**Actual deployed account entitlement and live CFD freshness are unverified.**
No production key, plan, environment or secret was inspected/changed for this
implementation. A key being present or an old display quote being returned does
not establish real-time permission or freshness. Therefore there are no
account-verified executable CFD instruments to report from this review. With the
new configuration unset, all 13 execution approvals are false; missing quotes
report `entitlement_required`. Returned but unverified quotes are reference-only.

Official Basic limits are 8 credits/minute and 800/day; commodity real-time access
requires an appropriate paid entitlement. A paid plan name alone still does not
activate symbols. `CFD_VERIFIED_LIVE_SYMBOLS` and `CFD_EXECUTION_SYMBOLS` are separate
explicit operator gates; the latter controls NEW openings only. Quote freshness
is then checked dynamically. Existing
open CFD positions also need a verified fresh source for close/liquidation; never
roll this gate out before evaluating that operational impact.

## Measured and projected load

Bybit steady healthy upper bound, one collector process:

- Spot bid/ask REST recovery: at most 12 category requests/minute (5-second timer;
  TTL and request latency can coalesce this lower).
- Instrument refresh: (1 spot + 1 linear + 1 inverse)/15 = 0.2 requests/minute.
- Options universe: 4/15 = 0.267 requests/minute when requested continuously.
- Options quotes: at most 12 requests/minute per active base, independent of the
  number of contracts, filters, pages or readers. Eight active bases: at most 96/min.
- Combined healthy upper bound: **108.467 HTTP requests/minute**. Without active
  option readers: approximately **12.2/minute upper bound**. Cold non-options
  startup costs 6 calls; options full warmup adds 12. Reconnects add category
  snapshots, shared by the category TTL. HTTP retries count as additional attempts.
- Process transport safety ceiling: 120 attempted HTTP calls in any rolling
  5 seconds, including retries; below Bybit's documented 600/5-second IP limit.
  Coordinate budgets across replicas/other consumers of the same egress IP.
- Actual topic packing: spot 538 topics / 10,033 encoded characters / 54 subscribe
  requests; linear 869 / 16,889 / 1; inverse 28 / 500 / 1. Total **3 sockets,
  1,435 topics, 56 initial subscribe requests**. Options add **zero** sockets/topics.
- Each connection is bounded to 21,000 encoded argument characters; spot requests
  hold at most 10 topics. Collector cap: 16 sockets, 200 connection attempts per
  rolling 5 minutes. Heartbeat 20 seconds, bounded reconnect backoff/jitter.

Twelve Data `/quote`: one batched HTTP request costs **N symbol credits**, not
one credit. Every retry reserves another N credits before HTTP. Default hard
process budgets: **8 credits/minute, 800/day**. Budget exhaustion prevents HTTP
and cannot make an old quote executable. Reference cache: 60 seconds; explicitly
entitled cache: configured quote-age limit (default 5 seconds). Stale display
retention is never an execution grace period.

| Hypothetical verified CFD symbols | Credits/request | At 5s: requests/min | Credits/min | Requests/day | Credits/day |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 10 | 12 | 120 | 17,280 | 172,800 |
| 25 | 25 | 12 | 300 | 17,280 | 432,000 |
| 50 | 50 | 12 | 600 | 17,280 | 864,000 |
| 100 | 100 | 12 | 1,200 | 17,280 | 1,728,000 |

These are nominal continuous 24-hour projections before retries, not enabled
catalog sizes or measured billing. At 60s the reference six-symbol watchlist
would demand 6 credits/minute and 8,640/day. Basic's daily budget therefore cannot
sustain even that cadence all day: this implementation stops at the local budget
(133 six-credit attempts = 798 credits), instead of pretending a minute quota is
a daily allowance. Larger batches are rejected before HTTP if they cannot fit
the configured minute budget. Alternative providers implement `CfdQuoteSource`.

## Validation and rollout limits

See [`qa/inverse-options-cfd/test-comparison.json`](qa/inverse-options-cfd/test-comparison.json)
for exact candidate/baseline counts and failure-name comparison. Final result:
450/450 focused tests passed (27 suites); candidate 2,739 passed / 45 failed / 17 skipped;
pristine current main 2,611 passed / 45 failed / 17 skipped. All 45 failure names match:
**zero new failures**. The 17 database tests remain explicitly skipped without
an isolated PostgreSQL fixture; these are not claimed as passes. See also
[`qa/inverse-options-cfd/changed-files.txt`](qa/inverse-options-cfd/changed-files.txt)
for the complete file manifest. Focused tests cover parser truth, pagination,
inverse bootstrap/delta/reconnect/rollback, auth/proxy/public API, quote freshness,
precision, null bid/ask, quota denial, and no CFD writes on invalid quotes.
The PR #35 follow-up adds 40 passing cases covering operation-specific gates,
opening-disabled Gold/WTI through the real adapter, API close/mark/PnL behavior,
expiry after staged balance writes, and continuation of the liquidation loop.
After the main sync, backend TypeScript, collector build, frontend TypeScript and
production Vite build all passed. The exact pristine baseline also received a
fresh production frontend build with identical lockfile dependencies and the
same existing in-process WASM runner. Initial focused testing under concurrent
build load had one LiveTransport timeout; the complete focused rerun passed
without any source/assertion change. The full comparison also has no new failures.

Before staging: review the diff; choose the Frankfurt collector/Oregon backend
staging pair; configure existing collector auth only in staging; inspect actual
CFD plan entitlements and per-symbol timestamp lag; reserve a suitable quote
budget; test API/UI unavailable states and existing open CFD positions. Run an
extended collector reconnect/load test and verify regional RTT/timestamp ages.

**Not production-ready without those checks.** Options live WS is intentionally
deferred. CFD execution is deliberately disabled by default. Quota ownership is
in-process: restart and multi-replica/shared-key accounting require a durable
shared limiter or a single externally quota-managed provider owner before
production execution. Local public probes do not validate the deployed account,
Frankfurt-to-Oregon propagation, market-data SLA or long-running billing.
No production merge or deployment is part of this PR.

## Official sources consulted

- [Bybit instruments and pagination](https://bybit-exchange.github.io/docs/v5/market/instrument)
- [Bybit REST tickers and option field names](https://bybit-exchange.github.io/docs/v5/market/tickers)
- [Bybit WS ticker snapshot/delta semantics](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker)
- [Bybit WS connections, argument limits and heartbeats](https://bybit-exchange.github.io/docs/v5/ws/connect)
- [Bybit volume/turnover units](https://bybit-exchange.github.io/docs/v5/market/kline)
- [Bybit HTTP/IP limits](https://bybit-exchange.github.io/docs/v5/rate-limit)
- [Twelve Data commodity reference](https://api.twelvedata.com/commodities)
- [Twelve Data FX reference](https://api.twelvedata.com/forex_pairs)
- [Twelve Data Basic/trial coverage](https://support.twelvedata.com/en/articles/5335783-trial)
- [Twelve Data symbol-credit accounting](https://support.twelvedata.com/en/articles/5615854-credits)
- [Twelve Data pricing](https://twelvedata.com/pricing)
