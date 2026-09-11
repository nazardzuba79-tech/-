# Bybit collector staging verification

This is preparation and local QA, not production readiness. No Render
service, production environment, Cloudflare, database or main branch was
changed. The review remains PR #31. Initial re-fetch confirmed main
`0097d8b72ffb3c5e9f8537e4a9da267ac0586e0f` and reviewed PR head
`fb7a2ab58592e9844757b123e5a0de0b1beb9f84`.

## Review findings and changes

The previous head was reviewed directly, including collector lifecycle,
book REST/WS ordering, API connector, internal WS, SSE writer, browser
store, metadata join and execution boundaries. Two related rollback gaps
were fixed: the initial reconnect snapshot no longer bypasses same-epoch
revision ordering, and a new epoch's older ticker observation cannot replace
a newer retained row. A replacement snapshot still owns universe membership;
matching newer last-good rows remain explicitly stale until the provider
catches up. Backend and browser apply the same rule.

The backend HTTP timeout now closes over its own AbortController, so an
old start/stop generation cannot abort a later request. Collector URLs must
be origins (no path, userinfo, query or fragment); HTTP is loopback-only.
Redirect following remains disabled on both authenticated HTTP and WS.

Authenticated diagnostics now include per-connection and overall last
provider activity, last accepted ticker activity, subscriber count and
collector-process memory. Existing category/state/topic counts, active
assets/instruments, ticker count, REST requests, reconnects, malformed
messages and timestamp/sequence rejection counters remain available.
No token or complete private configuration is included.

The internal WS writer was extracted into a testable function in the same
module, preserving its behavior. Tests now cover 5,000 superseded writes,
latest snapshot recovery, permanent blockage termination, SSE timeout
cleanup, ten real connect/disconnect cycles, twelve provider reconnect
cycles, repeated browser reconnects, and rollback/security regressions.
No architecture redesign or financial/execution change was made.

## Exact Render Frankfurt staging settings

Deployment is a separate authorized action. Configure only a new staging
collector when deployment is requested:

| Setting | Value |
| --- | --- |
| Name | `voltex-market-data-staging` |
| Type | Web Service |
| Region | Frankfurt |
| Runtime | Docker |
| Repository | `nazardzuba79-tech/-` |
| Branch | Reviewed `codex/bybit-live-market-data` head; pin the approved SHA |
| Root directory / Docker context | `.` |
| Dockerfile | `Dockerfile.market-data` |
| Build | Dockerfile: `npm ci --ignore-scripts`, then `npx tsc -p tsconfig.collector.json` |
| Start | Docker CMD `node dist/marketDataCollector.js` |
| Port | Render-provided `PORT`; fallback `10000`, bind `0.0.0.0` |
| Health | `GET /health` (liveness, not provider readiness) |
| Auto-deploy | Off during staging review; deploy only the approved revision |
| Required environment | `MARKET_DATA_COLLECTOR_TOKEN` from secret storage |
| Optional overrides | `BYBIT_REST_URL`, `BYBIT_SPOT_WS_URL`, `BYBIT_LINEAR_WS_URL` |

Default Bybit endpoints remain public REST and public spot/linear ticker WS.
Do not add `DATABASE_URL`, `DIRECT_URL`, wallet/JWT keys, trading API keys,
Prisma generation hooks or migrations. The collector does not need Neon.

After the collector URL exists, only the **staging backend** needs:

```text
MARKET_DATA_COLLECTOR_URL=https://<collector-host>
MARKET_DATA_COLLECTOR_TOKEN=<same secret, injected by secret storage>
```

The API and collector can run in different regions via HTTPS/WSS. Cross-region
proxy behavior must be checked on the actual deployment. Existing polling
remains available if either backend variable is absent.

## Run the reusable verifier

Install the repository production dependencies first. Inject these values
into the shell environment using secret storage; do not paste the token
into a URL, command argument, screenshot, chat, log or tracked file:

```text
MARKET_DATA_COLLECTOR_URL=https://<staging-collector-host>
MARKET_DATA_COLLECTOR_TOKEN=<secret>
VOLTEX_API_URL=https://<staging-api-host>
```

Then run exactly:

```sh
node scripts/verify-market-data-staging.cjs
```

`VOLTEX_API_URL` accepts the API origin or that origin with `/api/v1`.
The default is two 20-second observations separated by reconnecting only
the verifier's own read-only clients. It does not restart remote services,
change environment variables, open orders, or touch account endpoints.

Optional 15-minute soak, after the normal reconnect checks:

```powershell
$env:STAGING_SOAK_MINUTES = '15'
node scripts/verify-market-data-staging.cjs
```

On POSIX shells, use `STAGING_SOAK_MINUTES=15 node scripts/verify-market-data-staging.cjs`.
`STAGING_OBSERVE_SECONDS` optionally adjusts each initial observation
(3–300 seconds). Soak accepts 0–1,440 minutes, including fractional minutes
for local smoke tests. Missing/unsafe configuration and real verification
failures exit nonzero. Output uses `PASS`, `FAIL`, and `NOT RUN` when no
natural numeric zero was observed; zeros are never manufactured for a check.

Checks cover health; authenticated snapshot/diagnostics; missing/invalid
HTTP and WS tokens; initial snapshots and deltas on internal WS and public
SSE; revision/epoch continuity; per-row timestamp monotonicity; normalized
identity; spot/linear/asset/ticker counts; stale flags; null-only spot
derivative fields; natural numeric zeros; secret leakage; and payload bounds.
The parser handles split SSE events and CRLF with bounded buffering.

Reports retain current row maps and aggregate counters, not raw frame
history. They include frames/deltas/states, deliberate client reconnects,
rejected frames, revision gaps, min/max ticker count, maximum stale count,
largest frame, average delta row count, maximum silence gap and allowlisted
before/after collector diagnostics/memory. Provider reconnect/rejection
counters are separate from verifier-client reconnects. Unexpected transport
closure or a silence gap over 40 seconds fails the observation; it is not
hidden behind an indefinite retry loop. A one-minute local soak does not
prove long-term memory stability.

## Docker and local runtime results

**Docker image build: NOT RUN.** Docker is still absent from PATH and both
standard Windows installation locations. All Dockerfile COPY sources
exist. The exact `tsconfig.collector.json` dependency graph compiles and
emits `dist/marketDataCollector.js`; its third-party runtime dependencies
(`express`, `ws`) are production dependencies. The collector graph has no
Prisma/account/execution imports. This does not substitute for building
and running the actual image.

**Local collector runtime: PASS.**
`node scripts/run-market-data-local-qa.cjs <report-path>` starts the exact
compiled standalone entrypoint in a child process, with a fresh ephemeral
bearer token and only required environment variables. It connects to real
public Bybit, starts the actual backend connector/SSE router in a local QA
host, runs the verifier and then tests shutdown. This QA host is not a full
deployed VOLTEX API and needs no database or production credentials.

Windows cannot deliver native POSIX SIGTERM through `child.kill()`. The QA
bridge emits SIGTERM via IPC to exercise the installed handler and observes
clean exit code 0. **Handler: PASS; native POSIX SIGTERM: NOT RUN.** Docker
or Linux staging must verify real signal delivery and container termination.

The one-minute local soak recorded 1,407 ticker rows / 869 assets throughout,
538 spot and 869 linear rows, three snapshots per leg, 271 deltas per leg,
two deliberate client reconnects, zero revision gaps/rejected frames,
and real null and zero values on both legs. Maximum frame size was 892,975
bytes. Collector RSS rose from 107,339,776 to 152,539,136 bytes during warmup;
heap/GC and multi-hour stability are not established by these two samples.
The one-minute and subsequent three-minute/browser run have separate raw
artifacts; do not combine their counters or describe them as 15-minute QA.

The subsequent three-minute soak also passed: 765 internal frames / 777
public frames, 751 deltas per leg, 1,407 rows throughout, zero stream
rejections/revision gaps, largest frame 893,134 bytes. Provider diagnostics
remained live on two sockets, with zero provider reconnects/malformed
messages during this run. REST count advanced from 4 to 23 (cached spot
refresh continues during observation). The same backend connector remained
connected once throughout the verifier's own reconnects and browser use.
Collector RSS was 106,844,160 → 207,486,976 bytes, while heap used was
24,570,752 → 20,548,256 bytes; reserved heap expanded. This supports bounded
live objects in this short run, not a claim of leak-free long-term RSS or a
validated low-memory Render plan.

For an optional browser check, set `STAGING_QA_BROWSER_PORT=4206` and a
sufficient `STAGING_SOAK_MINUTES` in the local QA host. It serves the real
production frontend bundle, real Bybit tickers and explicitly unavailable
CoinGecko metadata; only the unrelated account shell uses a local fixture.
Its fixed `exchange_token=local-qa` is a separate dummy UI value, never the
collector bearer token. No mock ticker prices or volumes are injected.

Browser QA observed 869 reference assets and 50 rows at 1440/390 px, no
document overflow, no console errors, and no Trade buttons in provider-only
rows. BTC changed from 78,783.00 to 78,787.60 USDT without navigation, proving
the local provider → collector → connector → SSE → browser store → Markets
path. These observations do not establish Frankfurt deployment performance.

## Audit and remaining merge checks

| Structure | Bound / cleanup |
| --- | --- |
| Provider sockets/subscriptions | Encoded 21,000-char plans; spot ≤10 args/request; old connection stopped before resubscribe |
| Ticker/REST-time maps and dirty set | Current instrument membership; delisting removes entries; dirty set drains each batch |
| Internal WS clients | At most 32; subscriber/timers removed on close |
| Internal slow writer | No delta history; one snapshot after recovery; ~2 MB buffered threshold, then timeout close |
| Public SSE clients | At most 2,000; write backpressure drops superseded deltas, snapshot on drain, permanent blockage closes |
| Retry/heartbeat timers | One owned timer per role/session; generation checks prevent old bootstrap reopening stopped sockets |
| Browser Map/connection | One source for all subscribers; reconnect replaces membership; last unsubscribe clears transport/timers |
| Verifier | ≤20,000 rows / 16 MB frames, bounded SSE accumulator, numeric aggregates only |

Security review and tests confirm bearer headers only, authenticated
diagnostics, redirect refusal, non-loopback HTTP refusal, and no collector
token reference in frontend source. Runtime public frames and child logs
were checked with the ephemeral token. Diagnostic output is allowlisted;
errors never echo URLs, headers, payloads or the environment.

Required before claiming production readiness: build/run the actual Docker
image; deploy an explicitly authorized Frankfurt staging collector plus
staging backend; run the verifier with a longer soak through actual proxies;
check real POSIX SIGTERM and resource stability; inspect the real staging
Markets UI. No staging URLs/token were configured in this environment.
The existing repository failures remain separate from new regression
results. Exact tests and artifacts: [staging QA evidence](qa/bybit-live-market-data/staging-results.json).

Final validation: collector/backend/frontend TypeScript, production Vite
build and diff checks **PASS**; 17 focused suites / 291 tests **PASS**.
Full candidate: 2,473 passed / 49 failed / 17 skipped (2,539 total).
Pristine current main: 2,417 passed / the identical 49 failed / 17 skipped
(2,483 total). **Zero additional failures; full suite is not green.**
