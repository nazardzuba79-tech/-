# Infrastructure and exchange recovery review — 2026-09-30

Source base: `f62d28da893ca3feef73fe344ebb317ee69f32e8` (released PR #352).
Scope: reproduced request failures, stale display recovery and unnecessary reads.
This package is a proposed release. Its changes have not been merged or deployed.

## Confirmed defects and changes

| Area | Reproduction before the change | Result after the change |
| --- | --- | --- |
| Futures, Spot Orders and Balances routes | Rejecting a database read in an actual Express router running in an isolated child process caused exit 1 without an HTTP response or a call to error middleware. | A shared `asyncRoute` forwards rejection to existing error middleware. The client receives the existing generic HTTP 500 and a subsequent health request succeeds. Async API-key authentication is wrapped too. |
| Futures registry after a cold start | Empty/rejected ticker data returned only core markets without reading open positions or resting orders. A held non-core symbol could fail the ordinary order route's listing check, including a reduce-only order. | Recover actually held symbols once from the existing exposure queries. Failed recovery remains retryable; subsequent feed outages after successful recovery add no periodic database scans. Positions and orders were never deleted by this bug; the separate quick-close path does not use this listing check. |
| Spot/CFD connection indicator | With successful HTTP data, the mounted page displayed connection loss after the existing 35-second grace because it observed an unused venue socket. The false warning was also seen on the live Spot and CFD pages while their book/quote was populated. | Feed status comes from the actual Spot public-book read or selected CFD quote load. Sustained failure and successful recovery retain the existing grace period. No socket is added. |
| VTA to CFD navigation | The real simulation store kept polling every five seconds after the CFD screen became active: 12 extra GETs in a simulated minute. | The simulation subscription stops on CFD and resumes on Spot. This is an HTTP-read reduction; the affected simulation endpoint does not use Prisma, so no SQL or Neon savings are claimed. |
| Hung public-book read | A never-settling GET retained the in-flight lock and prevented later reads. | A 12-second abort deadline, matching the adjacent chart's public-read contract, releases the request for the next ordinary poll. Hide/unmount cancels it; an old pair's late result cannot overwrite the new pair. |
| Home recovery | One failed section request advanced its six-hour freshness gate despite failure. Visibility changes did not recover it. | A failed section retries after 60 seconds while active. Healthy sections retain their six-hour cadence. The hero retries its three related reads together. Hidden/sleeping pages retain no retry timer. |
| Snapshot freshness | A failed transport or an unavailable HTTP-200 section left cached ticker/overview metadata marked fresh. | Last-good values and their original observation time remain, with `stale: true`; successful data supplies fresh metadata again. |
| CFD self-test visibility | Two failed final startup self-tests in the inspected production log window were labelled INFO, so a warn/error-only view missed them. | A failed final self-test uses `console.warn` and structured `level: warn`. Successful/intermediate results remain informational. Provider behavior, retries and deadlines are unchanged. |

## Validation and preserved behavior

- The first 11 new Home/store cases and five mounted TradePage cases failed against the original runtime, then passed with the fixes.
- Final focused frontend validation: 9 suites, 136 tests passed, none skipped. The mounted cases use the actual TradePage, ConnectionBanner and test-market store with synthetic responses and mocked heavy children; unexpected transport is refused.
- Backend regression cases: registry 21, Futures request failures 14, existing Futures protection 21, Spot request failures 10 and existing Spot orders 4 — all passed (70 distinct tests).
- Isolated child-process probes for Futures, Balances and Orders each changed from exit 1/no response to controlled HTTP 500, subsequent health HTTP 200 and normal test-process exit. This demonstrates a failure mechanism; it does not attribute a specific historical production restart to it.
- AST comparison with the source base confirms all 21 async handler bodies are byte-identical: Futures 14, Spot Orders 6, Balances 1. The wrapper does not retry commands. Existing ownership checks, auth refusals, domain errors and financial calculations remain.
- Existing CFD self-test suite: 3/3 passed. Final backend TypeScript and frontend TypeScript/Vite builds passed. Vite retains its existing large-chunk warning; no bundle-size improvement is claimed.
- The complete local frontend run executed 2,892 tests in 170 suites: 2,891 passed and one complete-file fingerprint correctly detected the intended Futures wrapper change. Only that reviewed expected fingerprint was updated, with an explanation; the assertion was retained. Its focused rerun is recorded in the handoff. Exact PR CI remains the complete release gate.
- The existing Server idle workflow now includes the shared helper, affected routes and regression files in its path filters and runs the four request/error/domain suites in its existing job. There is no additional CI job or production database dependency.
- Independent source review covered the registry, feed lifecycle, stale metadata and error wrapper. Exact PR/check URLs and final outcomes belong to the PR record, not a claim that this proposed package is already live.

Live browser checks used ordinary read-only navigation after sign-in: Futures, Spot, CFD, Copy Trading, Wallet and the Admin entry. Copy Trading rendered its trader cards; Spot and CFD reproduced the false warning. No positions were opened, closed or modified, and no account/balance/database mutation was used for QA. Empty positions do not prove the live P&L row layout with an open position. These observations are not a load test or a full financial audit.

## Infrastructure conclusions

The current Render service runs the API and market collector together through `scripts/start-render-single-service.cjs`. The checked production build is `npm ci && npx prisma generate && npm run build`; its start command runs migrations and then that launcher. The old root `render.yaml` describes a different deployment and must not be applied as the current service's configuration.

The sampled Render CPU and memory did not show saturation. HTTP latency/status-series metrics were unavailable from the exposed telemetry, so there is no supported p95 API-latency, request-error-rate or monetary-savings claim. The evidence does not rule out short spikes, event-loop stalls or provider timeouts.

The Render service and the production Neon project named in the owner's handoff are configured in different regions. Neon control-plane history shows successful suspends and starts; it does not provide SQL latency. Actual hourly compute/egress consumption and invoice totals were unavailable. A configured maximum compute size is a ceiling, not actual use. Do not change capacity, disable suspension or migrate the database based only on those configuration fields.

### Concrete next configuration change: avoid unrelated Render deployments

PR #352 changed frontend presentation but also triggered a Render API/collector deployment. Both processes and their warm caches restart during that rollout. Current source/runtime inspection found no dependency on `frontend/` or `docs/` in the Render build/start closure.

For the existing Render API service, add these **Ignored Paths** to its Build Filters, retaining any other existing filters:

```text
frontend/**
docs/**
```

Leave the service root directory and its current build/start commands as they are. All backend source, Prisma migrations, root dependencies, launcher scripts and newly added paths outside those two directories should still trigger the existing auto-deploy behavior. A mixed frontend/backend commit must still deploy the API. Cloudflare Pages continues its independent frontend deployment.

The service-details response did not expose a build-filter field, so existing filters must be checked immediately before applying this additive change. This document prepares the exact intended change; it does not claim the production setting was applied. Use the existing service, not the stale Blueprint, and do not trigger a duplicate manual deploy.

Official behavior: [Render monorepo support and build filters](https://render.com/docs/monorepo-support). Ignored paths suppress matching automatic deployments; configuration changes and manual deployments are not suppressed by those filters.

## Remaining review priorities

1. Audit Promise rejection handling in the remaining API routers, starting with public database reads and account/portfolio/auth paths. A static inventory outside these three routers found 148 direct async handlers, including 62 with an await outside a lexical try/catch in 24 files. These are candidates, not 62 reproduced crashes; for example, `Promise.allSettled` may safely contain its input failures. This patch is not a global Express hardening claim.
2. Obtain hourly Neon CU and network-transfer consumption plus representative API/SQL latency before choosing a compute ceiling or a region migration. The [official consumption-history endpoint](https://api-docs.neon.tech/reference/getconsumptionhistoryperprojectv2) reads billing metrics without waking compute, but that operation was not exposed by the connected tool set during this review.
3. Measure the already documented synchronous Copy Trading replay/compression stages if user-facing stalls persist. No new worker, paid service or scheduler was introduced here.
4. Review the legacy funding scheduler separately if that engine is actively used: its per-cycle failure handling and interval idempotency deserve dedicated financial tests. No production missed/duplicate funding payment was established, and no scheduler or schema was changed.

Concurrent Claude PR #353 adjusts only the Futures panel presentation and its own evidence. It was not imported into this package; the files do not overlap the runtime fixes here. Refresh main and check both PRs again before a release.
