# One isolated positive PG/TLS smoke

Owner authorization: Issue #558, CTO comment 6295088442.

Application SHA: `98c577d4241ce527f7bfca3b78dd7bb78255e300` (unchanged).
Harness: this separate review commit, verified against the labeled PR head.
Base: PR #559 branch `codex/stocks-build-only-f97b7f9c-20261020`, exactly that application SHA.
Review branch: `codex/stocks-pg-tls-smoke-98c577d4-20261020`.
Workflow: **Stocks Isolated Positive PG TLS — 98c577d4**.
Trigger: one `stocks-positive-pg-tls-approved` label event; attempt must be 1.

One standard public-repository GitHub-hosted ubuntu-24.04 job rebuilds API and
gateway with the existing original strict 44+2 SQL packager and pinned Node
22.23.3 image. Neither image is pushed. The API and gateway use their unchanged
default image CMDs. The actual production runtime-bootstrap is not copied or
executed: **REAL_PRODUCTION_BOOTSTRAP=NOT_RUN**.

PostgreSQL 18.6 runs in a new internal Docker network with no published ports,
new tmpfs data directory, random ephemeral credentials and a `stocks_disposable_*`
database. Setup checks version, TLS, exact database name and empty schema before
using the existing acceptance base schema and only the Stocks migration. This
is disposable fixture setup, not deployment or a production migration.

A locally generated one-day certificate enables PostgreSQL TLS and an HTTPS
proxy. Verification remains enabled. Hostname overrides inside the network
route provider requests to a bounded fictional transport. No real provider
requests are made and no production feed entitlement is claimed. Application
parsers, order matching, freshness, PostgreSQL authority, accounting and
authorization remain unchanged. MOEX has no fixture data and stays unavailable.

Three newly generated technical users exercise the normal HTTP password/session
flow: two permitted traders and one viewer. The only balances are two fabricated
USDT DemoBalance rows. Checks cover API SHA/health, positive PG-only startup,
HTTPS, quotes/candles parsing, BUY, partial/full SELL, same-intent replay,
LIMIT/cancel/reservation, overspend/oversell, persistent cash/history, denied
viewer/invalid JWT/revoked session, finance-off authority, private-route fencing,
and hostile forwarded headers. These are bounded smoke checks, not a repeat of
the PG regression suites or a capacity test.

Each first failure stops subsequent checks. Logs and partial receipts are retained
in the GitHub job output and summary, with generated passwords, URLs and JWTs
redacted. Container cleanup runs afterwards. No automatic retry or rerun; no
upload of private keys, environment files or database contents.

A PASS does not close production-bootstrap/topology, actual account binding,
backup/restore/OTC, provider rights/data, or 50+2 performance gates.

The code-only diagnostics follow-up to run 39456249348 captures Docker CLI
stdout and stderr separately, including exit-zero `docker logs`. It records
CLI exit/signal separately from container state and startup stage, removes
generated secrets/credential URLs/bearer tokens before limiting each emitted
stream to 12,000 characters, and retains both the beginning and end of long
output. Early readiness exit and finalization capture logs before removal.
Diagnostic failure cannot replace the original readiness failure.

New fake-Docker subprocess tests: Node 22.23.3, 6 PASS. A temporary mutant that
restores exit-zero stderr loss produces 4 FAIL / 2 PASS. No real Docker, server,
database or old suite is run by these tests.

The subsequent code-only setup fix generates `API_KEY_ENCRYPTION_SECRET` with
`crypto.randomBytes(32).toString('hex')` alongside the other disposable credentials.
Only the two API env files receive it; the fixture config, gateway and PostgreSQL
env files do not. It is registered for the existing raw/URL-encoded redaction.
No actual key is stored in this repository. The unchanged API module still
rejects missing or malformed keys.

`source-guard.cjs` accepts multiple harness commits only when APP is their
ancestor, the independent source checkout is exactly APP, and the review
checkout is exactly the event head. Both checkouts must be clean. A NUL-delimited
diff with rename detection disabled allows only this harness directory, this
workflow file and `docs/AI_HANDOFF.md`; changes/deletions/renames involving
application paths fail. Existing label, branch, base, same-repo, runner and
one-attempt gates are unchanged. Both workflow checkouts already fetch full history.

New setup tests: Node 22.23.3, **11 PASS**. Restoring either the missing env key
or the single-parent assertion in a temporary copy causes its targeted new test
to FAIL. The previous six diagnostics tests were not rerun; their code and helper
remain byte-identical to c7306b5b. See [startup-preflight.md](startup-preflight.md)
for the source-only startup review and its limits.

Run only these new tests with `STOCKS_SMOKE_TEST_SOURCE` set to an existing
checkout of APP with its existing TypeScript dependency installed:
`node --test review/stocks-pg-tls-98c577d4/setup-guards.test.cjs`.
They use temporary Git repositories and isolated module evaluation; no Docker,
HTTP server, database, external provider or production secret is used.

The subsequent authorized run 39463377193 at harness3387ffb1 passed API/gateway
startup, PG/TLS, login and the first trader's full cycle, then failed at the second
trader's LIMIT with HTTP503 AUTH_UNAVAILABLE. No retry was made. The later
security/final-ledger checks and REAL_PRODUCTION_BOOTSTRAP remain NOT_RUN.

The current code-only follow-up adds a gated fixture-only auth observer. See
[auth-boundary-investigation.md](auth-boundary-investigation.md) for the exact
source path, retained-log limitations, safe trace fields and new targeted tests.
The original cause remains UNKNOWN; no application/auth/financial rule was
changed. Run the new local observer tests with
`node --test review/stocks-pg-tls-98c577d4/auth-trace.test.cjs` on Node22.23.3.
Publication and any further single smoke require separate owner approval.
