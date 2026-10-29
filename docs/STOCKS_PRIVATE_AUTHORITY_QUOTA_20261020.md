# Stocks authority quota — local code candidate, CTO6298165675

Parent: `086a25a360caac261666c2d36148188294e99d74` (remote Draft PR560).
The containing candidate SHA/bundle is recorded in the Issue558 handoff.

## Confirmed failure and bounded resolution

Run39473575500 remains **FAIL**. The second trader's LIMIT made identity
calls114/115; the first returned200/remaining0, the second returned429/text42B/
Retry-After28. JSON parsing masked it as AUTH_UNAVAILABLE. No submit command
was sent for that LIMIT. This document does not replace that hosted result.

The new code selects separate finite quotas without changing the public
120 requests/60000ms policy or its existing deposit-copy exception:

| Listener/traffic | Window and budget | Downstream behavior |
| --- | --- | --- |
| Existing public API | 120/60s per IP, unchanged | Existing routes/auth; with private opt-in, authority identity/readiness/command paths denied |
| Proven private service traffic | 240/60s for the whole service instance | All original JWT, live Session, actor and PG transaction checks |
| Rejected private attempts | 120/60s aggregate denial budget | 403, then429; no JWT/DB/financial handler |

The default240 private envelope is **not** a change to the public limit or a
capacity guarantee. The measured failing fixture already made115 internal
calls before finishing trader2. A separate budget of240 leaves125 for the
remaining actions/checks. The local admission regression proves two traders
can each perform120 live identity validations on the same IP and that the
241st is blocked. This is a bounded request-envelope test, not a successful
full two-trader PG/TLS run, a throughput benchmark or a50+2 claim.
Operators can choose an integer120..240; values outside that reviewed ceiling
fail startup. If the completed hosted scenario needs more, do not raise it
automatically. Independently review request amplification.

**#613, 28.10 (measured, not raised).** With identity checks multiplexed (`POST identities`), 50 viewers
need 60–90 private requests a minute. A trader's order cycle in the 50+2 harness (state, limit, cancel,
buy, replay, sell, replay) is 7 private requests; at the harness's 4 s cadence two traders alone make 210
a minute, so the harness's full trader load needs about 300/min and two traders got 429 at their fifth
cycle through this ingress. The ceiling stays 240; the release-chain regression runs the order cycle every
8 s. Details: `docs/STOCKS_613_PROCESS_ISOLATION.md`.

**#613 R5, 29.10 (quota still 240, not raised).** A trader's request no longer takes a separate identity
check once its bearer was confirmed live: the authority's judgement inside the command (now naming the
bound actor) is that check, and a request without a command is checked live before it is answered.
Identity batches never take the last minute past Q - Q/16 (225 of 240). The harness's original 4 s
cycle now fits: busiest minute 210 of 240 including the warm-up, 0 x 429, on the release chain (local).
A full minute of continuous 4 s trading (210 commands a minute) would still leave too little for 50
viewers polling every second; that remains an owner decision.

## Provenance and activation contract

Disabled by default. No production config, listener or trading flag is changed.
Opt-in requires:

- `STOCKS_AUTHORITY_INTERNAL_PORT`: explicit1024..65535, different from public
  `PORT` (default3000); no wildcard bind/address option.
- Existing `STOCKS_TEST_CASH_GATEWAY_KEY`:32..256 UTF-8 bytes.
- Catalogue or test-cash feature explicitly enabled already.
- Optional `STOCKS_AUTHORITY_REQUESTS_PER_MINUTE`: integer120..240, default240.
- Gateway authority URL and its readiness request must point to
  `http://127.0.0.1:<private-port>/api/v1/stocks-test-cash`.

The listener binds **127.0.0.1** only, in the API network namespace. A private
WeakSet marks requests arriving on that actual Node listener; it is transport
provenance, never an authorization cache. Admission additionally requires:
loopback local/remote socket addresses, the bound local port, exact Host,
exact path/method (GET identity/readiness, POST command, and since #613 P1 POST
identities: the multiplexed live identity checks, docs/STOCKS_613_PROCESS_ISOLATION.md), no forwarded/edge
headers, one nonduplicated capability header and constant-time key comparison.
Headers cannot mark a request arriving on the public listener as internal.
The existing authenticated public `/wallet` projection remains public and
subject to120/60s; it is not an authority service endpoint.

Wrong capability/provenance/method/path/Host denies before auth/ledger code.
The private socket also uses request15s/headers10s/keep-alive5s deadlines and
max128 connections. No auth timeout, grant cache or financial rule changed.
Invalid opt-in configuration or a private bind failure prevents public startup.

This is deliberately narrower than trusting Docker subnet/IP forwarding.
Separate bridge-network containers will **not** work through arbitrary
172.x/CIDR allowlisting: they need a separately reviewed topology. Do not expose,
publish, tunnel or proxy this private port publicly. Do not install the
capability in a browser or forward it from client headers. Actual production
namespace, firewall, proxy routing and secret isolation remain **BLOCKED**
until Work/operator evidence confirms them. Same-host socket checks alone
would not protect a publicly misconfigured proxy into this private listener.

## HTTP status handling

The adapter now sends the existing capability on identity as well as command
calls. Status401/403 maps to AUTH_REQUIRED before parsing, even for text bodies.
Status429 maps to safe AUTH_RATE_LIMIT, with bounded integer Retry-After1..60s
(invalid/date/oversized values default60s). The gateway emits429 with that
generic code and wait hint. It never exposes upstream text or credentials.
Rejected bodies are cancelled without speculative consumption.

No automatic retry, especially for commands. Transport/lost-ACK mutation
failures remain ACCOUNT_OUTCOME_UNKNOWN without a retry hint. No change to
per-request JWT/session revalidation, final PG session fence, ACK-after-COMMIT,
idempotency or the shared existing DemoBalance USDT.

## Targeted evidence (Node22.23.3)

- New ingress Jest:8PASS, zero skipped; real TCP listeners, Express limiter,
  real JWT verifier and Stocks router. Prisma session reads and financial
  authority are controlled test doubles, **not a live PostgreSQL test**.
- Adapter/gateway tests:10PASS (5 existing +5 new), real loopback HTTP.
- Existing diagnostic preload tests:11PASS; the429 assertion now requires
  classified denial and **no body consumption**, rather than the obsolete
  parse failure. Historical FAIL logs remain unchanged.
- Existing directly affected Stocks router suite:15PASS.
- Backend TypeScript production compile:PASS.
- Original adapter RED:4FAIL (the initial4 new tests), including real text429
  yielding AUTH_UNAVAILABLE/ACCOUNT_OUTCOME_UNKNOWN.
- Quota RED mutation: restoring120 for private requests fails at validation121
  (429 instead of200). Capability bypass mutation: forged key incorrectly
  returns200 instead of403. Each targeted mutation1FAIL; other7 tests filtered
  out only for mutation runs. Implementation byte-restored before final GREEN.

Tests cover copied capability on the public listener, forged forwarding
headers, duplicate keys, Host/method/path attacks, private/public/denial
exhaustion, two distinct live-revalidated sessions, revocation, invalid JWT,
finance-OFF, public wallet preservation and blocked repeated financial intent.
No authority call occurs for saturated/revoked/forged submissions, hence
those route tests cannot create duplicate reservations. This does not
substitute for the unchanged PG ledger/idempotency suite.

## Integration and rollback gates

**No push, PR update, label, CI, Docker, PG mutation, merge or deploy.**
No actual PostgreSQL transaction or full BUY/SELL smoke was run for this code
candidate. No frontend, quote feed, financial engine, SQL, DemoBalance, Claude
or Work implementation was edited.

The current hosted workflow/source guard deliberately remains pinned to
application98c. This candidate changes application code: it must become a
separately reviewed application artifact before a future harness can select
it. Do not relax the guard or run the old workflow and claim it tests this fix.
No new image IDs or production readiness are claimed.

Next: CTO review of the private transport boundary/budget, then separately
authorized isolated positive PG/TLS build using the approved new application
SHA and private topology. Must finish trader2 LIMIT/cancel and all previously
NOT_RUN denial/revocation/final ledger checks. Preserve existing50+2 gates.
Work must separately verify real runtime-bootstrap, ingress, backup/restore,
migration set, private two-trader binding, source rights/freshness and capacity.

Rollback of a future authorized integration: restore the prior application
image/config together and stop the opt-in listener; no schema or ledger
rollback is introduced by this change. Returning to the old shared public
authority path restores the known120/60s bottleneck and is not a release PASS.
