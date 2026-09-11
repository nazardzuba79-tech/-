# Bybit live reference pipeline: review evidence

Prepared on 2026-09-11 in an isolated Windows worktree. Original starting
main was `be8c0b6f89b41197eacff865d74e7e1941e67f98`. A final fetch found PR #29
merged, so the implementation was rebased without conflicts onto current
main `0097d8b72ffb3c5e9f8537e4a9da267ac0586e0f`. PR #29's Futures UI is
preserved. No deployment, production configuration change, migration,
private provider call or financial write was performed.

## Implemented path

Bulk REST bootstrap plus two normal Bybit public ticker WS connections feed
a separate collector. Authenticated HTTP snapshot/internal WS feed one API
connector, which publishes normalized snapshot/changed-symbol SSE events.
One browser store owns the connection and latest-good Map. Markets joins
unique canonical CoinGecko metadata; provider-only/colliding identities
cannot become executable markets or acquire guessed icons/names.

See [architecture](../../MARKET_DATA_ARCHITECTURE.md#20-separate-live-reference-collector-2026-09-11)
and [runtime/operations](../../BYBIT_COLLECTOR_OPERATIONS.md).

## Deterministic scale and timing

[Raw measurements](measurements.json) were produced with
`node scripts/measure-live-market.cjs docs/qa/bybit-live-market-data/measurements.json`
after backend compilation. The harness uses real loopback HTTP/WS/SSE
transports and the actual frontend store in Node. It supplies 650 unique
assets, 650 active spot plus 650 active linear instruments, one excluded
inactive instrument, and deliberately paginates linear instruments.

| Quantity | Observed |
| --- | --- |
| Active assets / instruments / tickers | 650 / 1,300 / 1,300 |
| Bootstrap REST | 5: spot instruments, two linear pages, two bulk ticker calls |
| Provider connections | 2 |
| Subscription requests | 66: 65 spot requests of 10 args, one linear request |
| Per-connection encoded args length | 14,841 characters, below 21,000 |
| Backend collector connections | 1 |
| Frontend subscribers / SSE connections | 100 / 1 |
| Input | 30,000 updates, 40 distinct changed symbols |
| Initial snapshot | 762,139 bytes |
| Typical 40-row delta at 250 ms | 23,516 bytes median, 23,517 p95 |
| Serialized ticker book | 762,201 bytes |
| 130,000 Map lookups at 250 ms setting | 3.885 ms, no network requests |

| Batch interval | Messages/sec | Batches/sec | Collector publish → backend p50 / p95 |
| --- | ---: | ---: | ---: |
| 200 ms | 9,039 | 4.52 | 0.515 / 2.376 ms |
| **250 ms (default)** | **8,934** | **3.57** | **0.520 / 1.790 ms** |
| 500 ms | 8,307 | 1.94 | 0.859 / 0.885 ms |

The fixture targets 10,000 messages/sec over three seconds. Reported rates
include final drain time, so batch rates are below the configured 5/4/2 Hz.
The 250 ms default trades less batching delay than 500 ms for fewer batches
than 200 ms. Collector propagation starts when the coalesced frame is
published: it excludes provider network time and the 0–250 ms coalescing
wait. Backend → frontend store in Node was p50 0 / p95 1 ms at 250 ms.
This is a short deterministic experiment, not a production capacity test.

Whole-harness RSS at 250 ms was 194,457,600 bytes, including simulated
provider, collector, API connector, transports, frontend store and prior
measurement runs in the same process. It is **not isolated collector RSS**
and cannot establish a Render instance size. No collector CPU claim is made.

Before this change there was no collector/SSE pipeline, so a comparable
before/after stream latency does not exist. The current-main catalogue and
Kraken polling remain available. Bulk REST is reused rather than replaced
with per-symbol requests; CoinGecko request volume is unchanged. The
measurement above compares three real batching settings, not an invented
slow baseline.

## Real provider smoke

[Provider smoke](provider-smoke.json) ran successfully against the public
Bybit endpoints at `2026-09-11T14:49:03.976Z`, from this local environment.
No key, account, private endpoint or order was involved.

- 538 spot + 869 linear active instruments: 1,407 ticker rows / 869 assets.
- Four bootstrap REST requests; two active provider WS connections.
- 55 initial subscriptions: 54 spot requests and one linear request.
- Encoded args: 10,033 spot and 16,889 linear characters.
- 12,231 received messages by the end, zero malformed messages.
- One forced spot disconnect recovered to live with two active sockets;
  three sockets opened and 109 subscribe requests cumulatively include
  the replacement connection. Real deltas continued after recovery.
- Provider circuit healthy; timestamp/sequence rejections are observable.
  Serialized last-good book at the end: 892,771 bytes.

The count of four is bootstrap/smoke traffic. Long-running operation also
refreshes spot bid/ask with one cached bulk snapshot every five seconds,
and instrument pages at the existing universe cache interval. This smoke
does not verify access from a deployed Frankfurt or Oregon instance.

## Browser QA

`scripts/qa-live-market-ui.cjs` serves the production bundle and real SSE
route on loopback, with explicitly synthetic test-only fixtures. No fixture
is imported by product runtime. The catalogue contains 652 joined rows:
601 canonical fixtures plus safely separated reference identities, with
650 live spot quotes. Desktop/mobile screenshots and native EventSource
reports are adjacent to this document.

The table mounts 50 rows; search for provider-only `ASSET649` shows its real
symbol, missing market cap, deterministic letter icon, real zero turnover,
and “Data only” with no Trade button or guessed remote image. Native browser
reports record one SSE connection, 50 mounted rows at 1440/390 px, no
horizontal overflow and no page errors. Receipt latency was p50 1 ms /
p95 2 ms (606 desktop and 1,069 continuous-session mobile samples; the
mobile report also contains the earlier desktop samples). Existing snapshot
polling continues. Transport timing is measured at native EventSource
receipt with `Date.now() - sentAt`, not React paint time or WAN latency.

## Validation

Backend TypeScript, standalone collector TypeScript, frontend TypeScript,
production Vite build and `git diff --check` pass. The focused run covers
16 suites / 265 passing tests, including existing gateway/cache/health,
Kraken, Bybit universe, catalogue scale and metadata collision suites.

`test-results.json` records the full-suite comparison against pristine
current main and enumerates pre-existing failures. Both current-main and
candidate frontend bundles were built before this final full comparison,
so build-output tests run on both sides. The earlier run on the starting
base found one additional source-scanner failure: provider names in new
non-rendering data-contract modules. The scanner now excludes those two
modules and a new test pins their non-rendering role and absence of provider
fields in table rendering. Product UI still cannot display provider brands.

| Stable full run | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| Pristine current main `0097d8b` | 2,417 | 49 | 17 | 2,483 |
| Candidate implementation `5ec6a06` | 2,447 | 49 | 17 | 2,513 |

The same 49 test names fail on both sides; **zero additional failures**.
They remain out of scope, not hidden or converted to passing tests. The
full suite is therefore not green. All 265 focused tests pass separately.

A final regression test also covers REST spot bid/ask arriving after a
newer WS tick: REST-only bid/ask advance independently while WS price,
timestamp, sequence and freshness do not roll backward. Older cached or
stale REST replies cannot rewind bid/ask. The final full candidate run is
performed on the stable implementation after this fix.
An intermediate full run overlapped that edit and observed the new test
with an already-loaded old implementation; its additional bid/ask failure
is not used as final evidence. The full candidate was restarted with no
further runtime/test edits, rather than treating the focused pass as a
substitute for a stable full comparison.

Reproduction (from repository root, after dependency installation):

```sh
node node_modules/typescript/bin/tsc
node node_modules/typescript/bin/tsc -p tsconfig.collector.json
cd frontend
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
cd ..
node node_modules/jest/bin/jest.js --runInBand --silent --modulePathIgnorePatterns='[.]qa-live'
git diff --check
```

The `.qa-live` exclusion only avoids duplicate discovery of the nested,
pristine comparison worktree. It does not exclude any product suite.

## Preserved boundaries and limits

- No matching engine, Spot/Futures execution, mark price, margin, MMR,
  liquidation, funding settlement, balances, PnL, Copy Trading, CFD, auth,
  deposits, KYC, cards, referrals, admin or database schema changes.
- Existing gateway snapshot methods and Kraken execution inputs remain
  authoritative. Existing `tradable` / `tradingPairs` stay unchanged.
- Only the Markets catalogue consumes the new live display store today;
  the shared hook is available for future analytical consumers. Existing
  financial ticker components retain their prior data inputs.
- No Docker executable was available, so the Docker image was not built.
  The dedicated collector TypeScript import graph compiled. Runtime uses
  the root dependency lock and includes unused production dependencies.
- Cross-region TLS/SSE proxy behavior, long-duration provider behavior,
  actual deployed CPU/RSS, and multi-user API capacity need staging QA.
  The 2,000 public-client cap is a bound, not demonstrated capacity.
- Stale marking is conservative after 30 seconds without an accepted row
  update. Spot bid/ask are bulk-REST cadence, not WS-tick cadence.
- USDT prices/turnover are labelled explicitly; no USD conversion or
  market-cap substitution is invented. Metadata collisions stay separate.

## Exact changed files

See [files-changed.txt](files-changed.txt), generated from the final diff
against current main. It includes runtime, tests, scripts, deployment
preparation, architecture/handoff and evidence. The original user checkout
and its unrelated staged changes were not modified.
