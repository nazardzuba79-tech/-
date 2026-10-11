# Stocks cache retention and overload recovery — PR #497

Implementation baseline: `bd97e35020e40bfc48cdc5647b32d5e79b023c05`. Fresh main: `a2290d4f26a1b2ddf71c045110a89f185fd968e6`. Exact-head measurements and CI outcomes are published in the PR and matching CI artifacts; this methodology is not a capacity approval.

## Request accounting

The existing mixed workload opens 20 instruments (13 Binance, 7 Bybit), switches 15m/1h/1D every six seconds, polls state every two seconds and requests an earlier page on the next turn. These are unchanged stress assumptions, not predicted production user behavior.

Previously, expired recent pages still occupied the LRU and displaced valid older pages. The normalized-page cache now removes expired entries before applying pressure eviction. Its conservative **8 MiB** byte allowance is unchanged; the independent entry bound is 128, allowing the workload's 100 normal 300-candle pages (7,782,400 accounted bytes) to remain together. There is still no duplicate raw-history cache.

The deterministic fixture replay isolates caching/admission from HTTP, SQLite and CPU. It now records 40 historical-page hits instead of zero, 160 source attempts instead of 200, and 156 fixture transports instead of 170. Local RATE_LIMIT refusals fall from 30 to 4. This is a reproducible cache diagnosis, not a capacity test or live market-data claim.

Under the current cold-cache, exact-page contract, five uncached recent pages and three earlier pages per instrument require 13 × 8 = **104 Binance starts inside 30 seconds**, exceeding the existing **100 starts per host per rolling 60 seconds** even before additional requests sharing that host. Bybit needs 7 × 8 = 56. More hardware alone does not remove this request-budget constraint. This is a lower bound for the current 300-row request architecture and schedule, not proof that all further optimization is impossible.

The latest fixture pages contain only 156/264/299 of the first older page's 300 candles at 15m/1h/1D; serving their overlapping subset would truncate history. Subsequent exact older-page revisits are now reused. A separately verified range cache or larger initial fetch might reduce calls further, but larger fetches retrieve older rows before requested and need provider pagination/freshness/OHLC equivalence proof. Neither is implemented or counted as ready here.

No source limit or TTL changes: recent pages 10 seconds; ended pages 300 seconds; MOEX pages 10 seconds. Exact provider/instrument/interval/end keys, exclusive end filtering, normalized OHLC, receivedAt and immutable arrays remain. Concurrent identical pages share one request and one normalization. History is requested only for the open chart/timeframe; no catalogue-wide history prefetch is added. Quote polling remains limited to selected, held or ordered instruments with an active account lease.

## Controlled overload behavior

RATE_LIMIT retains its existing HTTP422 code; ACCOUNT_BUSY and SOURCE_BUSY retain HTTP503. Responses add an advisory minimum wait (60 seconds for RATE_LIMIT, three seconds for busy errors) as retryAfterMs and Retry-After. These are not readiness guarantees, provider entitlements or permission to replay a mutation. Unknown/failed storage outcomes have no retry hint.

The Stocks-local interface latches a read pause on supported overloads, including safe codes in state.errors. It preserves displayed history/candles and displays a clear message plus a manual read-recovery control. A manual probe is bounded and never submits orders, cancellation or balance changes. Polling must not become an unlimited failure/retry loop. Session changes fence late responses; hidden/unmounted views do not keep requesting data.

Trading admission, freshness and pending order-id reconciliation remain authoritative. No optimistic fill, stale-price execution, new request ID for an uncertain prior order or automatic financial retry is introduced.

## Unchanged safety and measurement gates

- SQLite worker, DELETE journal, synchronous=FULL, BEGIN IMMEDIATE and durable acknowledgement unchanged.
- Engine, ownership, Alice/Bob, idempotency, quote/FX evidence, rounding, PnL and no-double-fill rules unchanged.
- Original 50/100-reader load workload and acceptance criteria unchanged.
- Same account tests: 5/20/50, mixed/shared, three 30-second repeats, .05 vCPU, 256 MiB, three-second deadline, 1 MiB/s read and 128 KiB/s write caps.
- Separate no-artificial-I/O-cap comparison keeps the same CPU/RAM/schedule. It does not certify Hetzner disk speed or available production capacity.
- Original stress readers do not adopt the UI cooldown. Rejected/timeout requests remain failures; the UI test is additional evidence, not a replacement workload.
- Synthetic responses exist only in isolated test fixtures with no external provider or trading-order requests. No public quote fallback is installed.
- MOEX/SBER remain blocked. Bybit/Binance commercial redistribution rights remain unconfirmed.

## Minimum conditions and publication boundary

A viable deployment needs uncached per-host demand within the existing rolling budget, enough durable-write capacity to drain the bounded account queue within request deadlines, and measured CPU/RAM headroom shared with Spot/Futures. The tested lower bound from the preceding review is five mixed/shared users at .05 vCPU/256 MiB with the artificial disk cap; its shared-50 no-cap result is a different, narrowly defined scenario. New exact-head measurements must be reported independently, including failures and worker overhead.

There is no universal minimum server size or 20–50-user guarantee inferred from this diagnostic. Do not buy or provision a server from these measurements alone. No merge, production deployment, production database changes or external financial operations are authorized by this PR.
