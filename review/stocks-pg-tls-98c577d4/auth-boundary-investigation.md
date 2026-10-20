# AUTH_UNAVAILABLE investigation — CTO 6297028621

Parent harness: `3387ffb104af7c426095d88159564eb753b2621f`.
Immutable application: `98c577d4241ce527f7bfca3b78dd7bb78255e300`.
Existing run: 39463377193 / job 118768234494. **No new CI or Docker run.**

## Finding: the original cause remains UNKNOWN

Reused the actual retained 269099-byte job log, SHA256
`63cd1961ec1876fd58aa1f469b7692d7eef4026d3b77a72694d1694ae7423b73`.
It proves first trader's full cycle PASS and second trader's failure at
`fixture.cjs:218`, `LIMIT: HTTP 503, safe error AUTH_UNAVAILABLE`.
Reaching that assertion also means the preceding second-trader BUY, replay,
partial SELL, full SELL and cash-restoration assertions completed. It does not
prove that its LIMIT was accepted, cancelled or committed.

The log has no per-identity upstream status, body classification, request count,
correlation or duration. Buffered container stdout is timestamped when Docker
logs are collected; those timestamps cannot reconstruct individual BUY/SELL or
identity durations. API/gateway/PG remained running without OOM. Kraken fixture
503 and SQLite import warnings do not establish causation. No honest comparison
of first/second LIMIT request counts or latency can be recovered.

## Actual immutable release path

1. Fixture HTTPS request carries the normal JWT and existing CSRF token.
   Fixture TLS proxy forwards to hosted ingress. `hosted-ingress.mjs` checks
   loopback/Host/Origin/routes and forwards only its existing security allowlist.
2. `release-entrypoint.mjs` uses `openReleaseAuthority`, which verifies PG
   readiness and constructs `authority-adapter.mjs`. It supplies that verified
   adapter to `server.mjs`. The legacy `identity.mjs` resolver is **not** the
   active identity implementation.
3. `server.mjs` obtains request context through `authenticate`; financial routes
   additionally call `authorize`, bind identity to the initial principal and
   check cancellation. `authority-adapter` holds credentials in per-request
   AsyncLocalStorage, without caching an authorization decision.
4. Adapter GET `/api/v1/stocks-test-cash/identity` uses the actual bearer token
   and its own **3000 ms** AbortController covering response/body. It parses
   response JSON before examining HTTP status. Non-SimError on this GET becomes
   `AUTH_UNAVAILABLE`. Non-JSON error pages, aborts and socket errors can therefore
   collapse to the same code. Its 8 MiB response limit has a distinct
   `ACCOUNT_RESPONSE_TOO_LARGE` code. Gateway cancellation checks can also emit
   AUTH_UNAVAILABLE. None of these checks was changed.
5. API's global rate limiter precedes routes: **120 requests / 60000 ms**.
   `requireAuth` verifies JWT, then queries Session on every request, binding
   session/user and checking revocation/expiry/contact policy. A caught session
   DB failure returns JSON503 with a non-enum message, which this adapter maps
   differently (`ACCOUNT_UNAVAILABLE`). The identity route verifies JWT/sub/sid
   again and emits only issuer/subject. A global non-JSON429 is a plausible
   source of the observed code, **not a proven explanation of this CI run**.
6. Only after identity/CSRF/account/financial authorization does the gateway
   submit `submitObserved` through the adapter's POST command route. The API
   repeats auth, gateway-key, body and actor checks. PG authority locks User and
   Session `FOR NO KEY UPDATE`, then the shared USDT DemoBalance and Stocks row,
   applies idempotent operations/receipt/audit, and repeats session/expiry checks
   before the transaction resolves. Response follows COMMIT. Queue/lease/quote/
   transaction safety remains unchanged; there is no evidence of a specific
   contention or lease defect in the retained log.

## Narrow fixture-only observer

`auth-trace.cjs` is a read-only-mounted `/smoke` preload, **not packaged in the
application images**. Runner adds NODE_OPTIONS only to the two API containers
and gateway. Defaults and application commands remain unchanged. Startup
requires the exact APP, a recognized fixture role, the existing fixture issuer/
principals and loopback disposable PG URL. Missing/invalid scope fails closed
with a generic code. No real account or production secret is used.

- Observe incoming gateway/API routes and authority fetches, retaining original
  methods, JWT/CSRF/gateway credentials, bodies, signals, limits and responses.
  No retries, auth cache, timeout extension, grant or error remapping.
- Opaque UUID correlation crosses only the fixture's loopback ingress and
  authority hops. Existing security headers are preserved. Diagnostic fields
  are never added to response bodies/headers visible to the client.
- Emit role, safe route/command enums, sequence, identity-call ordinal, status,
  duration, numeric limiter headers, abort flag and allowlisted socket codes.
  Never log URLs/query strings, tokens, headers, cookies, user/session IDs,
  exception messages/stacks, balance values or raw bodies.
- An identity-body iterator observer yields unchanged chunks without cloning
  or prefetching. It retains at most 8 KiB transiently to classify JSON as
  VALID/INVALID/NOT_INSPECTED, counts bytes/completion and reports stream errors.
  The application's existing 8 MiB limit and deadline remain in charge.
- Maximum 4000 trace records per process, then one explicit `trace-limit`.
  Existing two-stream redaction/bounded stdout/stderr capture is unchanged.
  No synchronous file writes or new background timer/worker are introduced.
- The gateway's own order request reports NOT_SUBMITTED when no direct
  submit/cancel command was sent; ACK_AFTER_COMMIT means its successful command
  HTTP acknowledgment (per unchanged API source), otherwise UNKNOWN.
  API/ingress contexts report NOT_OBSERVED. This is **not SQL tracing** and says
  nothing about unrelated/background commits. Lost ACK must remain UNKNOWN.

Observer overhead exists; timings are diagnostic evidence, not a performance
acceptance result. An API-internal generic failure can still require a separate
reviewed probe; this patch intentionally does not dump DB exceptions or queries.

## New local checks only

Node22.23.3: **11 PASS**, no skipped tests:
non-JSON429, malformed JSON200, repeated uncached identity and 401 preservation,
connection refused, post-headers socket close, caller cancellation, correlation/
no-submit boundary, fixture-scope denial/log-sink failure, unchanged hosted
ingress JWT/CSRF/correlation/no-client-leak, bounded trace quota, and acknowledged/
rejected/lost-ACK command classification. The latter uses HTTP responders, not DB
transactions; it proves that absent acknowledgment is never reported as COMMIT.

Tests use the **unchanged** authority adapter and hosted ingress with local
ephemeral HTTP responders. They do not connect to PostgreSQL or test financial
transactions. Valid JSON401 remains AUTH_REQUIRED; the demonstrated fault
classes still return AUTH_UNAVAILABLE. Thus no security policy is relaxed.
Suppressing the upstream-header diagnostic in a temporary copy makes the
targeted new test fail (1 FAIL); corrected final suite passes. This RED proof
tests observability, **not reproduction or correction of the original CI cause**.

Application/SQL/workflows, keep-alive5000, 3000ms authority timeout, maxInflight80,
JWT/session revocation, COMMIT/ACK/idempotency and prior stderr helper are
unchanged. Prior suites were not rerun. Current hosted FAIL remains open;
remaining viewer/revocation/finance-OFF/final-ledger checks and real production
runtime-bootstrap remain NOT_RUN. Publication and any subsequent single smoke
need separate owner authorization.
