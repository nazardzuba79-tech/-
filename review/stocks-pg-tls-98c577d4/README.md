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

Read-only source review found an omitted startup prerequisite:
`src/index.ts` imports `apiKeysRouter`, which imports `ApiKeyService.ts`.
That module unconditionally rejects missing `API_KEY_ENCRYPTION_SECRET`; the
smoke API env does not provide it. Transpiling/executing only that unchanged
module in an empty synthetic environment reproduces the exact required-secret
error. This establishes a configuration blocker, not recovery of the discarded
historical API stderr or proof that no earlier startup error exists. No secret
or application configuration is changed by this logging-only patch.

The existing `HEAD^ == application SHA` single-commit guard is also unchanged.
A follow-up commit has the former harness as its parent; a future run needs a
separately reviewed ancestry-guard adjustment or approved packaging decision.
Do not trigger this local candidate as-is. Publication and another single smoke
require separate owner approval. The prior smoke remains FAIL, financial HTTP
checks remain NOT_RUN, and REAL_PRODUCTION_BOOTSTRAP remains NOT_RUN.
