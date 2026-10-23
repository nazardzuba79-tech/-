# Private namespace PG/TLS fixture — preparation only

Owner/CTO558 comment6298848108; Work topology6298752358. No Docker, PG, CI,
production, push or release operation was executed while preparing this harness.

## Immutable application and separate harness

Application: `133cb85a95003c229829b1ecef3d8d0e6308db95`. It is deliberately
different from the previous smoke's `98c577d4`. `application.json` records its
exact Git tree, the entire approved base98c→133 delta and SHA256 of each blob.
Only four application runtime paths differ: `src/index.ts`, the new private
ingress middleware, authority-adapter and gateway server. Tests/review/docs in
the application commit are not application image content.

This harness is a separate descendant commit, on local branch
`codex/stocks-private-topology-133cb85a-20261021`. Its exact SHA/tree and verified
bundle hashes are in the delivery report. The guard accepts only the exact
application checkout/tree, exact PR event HEAD, clean checkouts, APP ancestry,
matching app blob manifest and a harness-only delta from APP. No blanket source
allowlist was added. Existing PR560, old workflows, finance code and SQL are
unchanged by this task.

The future build invokes the existing byte-exact 44+2 SQL packager, then stages
only explicit Docker COPY inputs. Authored tests/review/docs/Git are omitted.
The application recipe and Node22.23.3 base pin are preserved. API/Gateway images
are tagged with the new application SHA, not the harness SHA. `packaged-source`
receipt hashes the staged source list. No SQL content is modified; disposable
fixture schema setup is not a production migration.

## Actual staging topology to be exercised

`compose.staging.template.json` is a review rendering of `topology.cjs`, not an
installation file. Mandatory placeholders cannot silently fall back to existing
images or paths. The guarded runner renders exact image IDs and a new temporary
directory after building. Do not run the template directly against any host.

| Service | Network namespace / transport | Credentials and UID |
|---|---|---|
| api-production | Own internal Docker bridge namespace; public3000, private127.0.0.1:3001 | Disposable API/PG/JWT/capability;1000 |
| gateway | `service:api-production`; loopback4437 and hosted-ingress4438 | Gateway capability and two fake principals;1000; no PG credentials |
| unix-ingress | `service:api-production`; Unix socket only, fixed upstream127.0.0.1:4438 | No auth/PG secrets;10001:10002 |
| postgres | Separate bridge namespace, TLS5432, tmpfs disposable cluster | Newly generated password; pinned PG18.6 |
| frontend | Separate namespace; local fixture TLS4443→shared Unix socket; login/health→api-production3000 | TLS test key only;10002:10002 |
| outsider | Separate namespace; probes private ports and Unix permissions | No auth/PG secrets;10003:10003 |
| checks/setup | Fixture driver; setup separate bridge, checks share API namespace for explicit private-path probes | Disposable fake users/keys only |

No service publishes TCP ports. The runner inspects namespace identities,
Docker NetworkMode, internal bridge and absence of PortBindings, and requires
positive public API access plus explicit private-port refusal from the outsider.

The external TLS fixture substitutes for host Nginx/Cloudflare. It intentionally
does not claim to test actual host13020 DNAT, Cloudflare edge authenticity or the
production Nginx UID/ACL. Gateway→API and Unix-proxy namespaces/bindings match the
agreed design; actual production ingress and bootstrap remain separate gates.

The minimal Unix proxy uses Node22 from the already built API image instead of
adding the previously proposed Nginx image. This is a staging implementation of
the same topology, not an approved production proxy replacement. It permits only
the eight existing Stocks routes with exact methods, Host/Origin and bounded
body/concurrency. It cannot proxy to3000/3001, has no variable upstream, forwards
only approved headers, rejects forged forwarding/capability headers and does not
retry/cache/redirect a financial request.

Unix directory0710/socket0660, owner10001/group10002, are verified before readiness.
The sole group consumer is the fictional frontend UID10002. Wrong UID10003 must
get EACCES/EPERM, not an accepted timeout or missing socket. Startup fails closed
on symlinks, stale sockets, wrong ownership/modes or unsupported platform. The
standard runner uses sudo only to initialize its newly created temporary socket
directory, never an existing server directory. Real host ACLs are NOT VERIFIED.

The provider transport is fictional CI wire data, explicitly confined to an
internal network and mounted fixture files, never included in application images.
The real parsers/freshness/accounting run unchanged. No external data-rights or
provider availability claim follows from the test. Provider TLS is loopback443
inside the API namespace; checks verify the inherited exact hostname mapping.

## Positive scenario and quota evidence

Retains both traders' normal login, initial distinct existing DemoBalance USDT,
BUY, same-intent replay, partial/full SELL, LIMIT reservation/cancel, oversell and
overspend rejection, final three fills/cash restoration. Then viewer deny,
wrong-signature JWT, subject/session mismatch, finance OFF (separate3010/3011
instance), private route denial, hostile Host/Origin/forwarding, logout/revoked
read and write, other trader unaffected, unchanged balance/receipt/audit rows.
Public wallet availability is also checked on public3000.

Only after all those assertions does a bounded quota check consume the remaining
private240 budget and assert429/AUTH_RATE_LIMIT through the Gateway without any
financial write; public120 is then exhausted separately. No sleeps/retries are
added to make the financial scenario fit a budget. Existing quote-freshness waits
are unchanged. Public120, private240, maxInflight80, JWT and COMMIT fences stay
unchanged. This is functional quota checking, not a 50+2 load test.

The diagnostic preload records only safe route/status/quota counters and time.
A post-financial snapshot is retained in subsequent records and the partial
receipt, distinguishing normal scenario consumption from intentional exhaustion.
It logs no tokens, identities, bodies or capability values. Sufficiency of240 for
the complete scenario is **NOT RUN**, not inferred from local tests.

## Local validation and future workflow

Node22.23.3 targeted tests cover Compose graph/template, exact-source rejection,
workflow trigger bounds, proxy validation/body/header/no-retry behavior, quota
diagnostic redaction, and real TCP private/public listener behavior from133 source.
TCP tests use a downstream handler double: they are not JWT/PG financial proofs.
Windows does not prove Linux Unix permissions or Docker namespace attachment.

Initial local failures were a missing optional YAML parser (changed to existing
js-yaml) and Node fetch normalizing hostile Host (test now sends raw HTTP).
Assertions were retained. A wrong-upstream3001 mutant is rejected by the proxy
test. An old98c application mutant is rejected by the source guard assertion;
an initial mutation attempt failed in test setup and is not counted as proof.

Prepared workflow: `Stocks Private Namespace PG TLS — 133cb85a`.
New approval label: `stocks-private-pg-tls-133cb85a-approved`.
Only labeled PR events, same repository, exact new head branch, draft state,
base PR560 branch at086a25a3, attempt1; ubuntu24.04, Node22.23.3, contents:read,
30-minute timeout. No dispatch/push/schedule/secrets/OIDC/environment/deploy or
registry push. It checks out133 application and exact event harness separately.
The existing stacked PRs/workflows are untouched. No label/PR/push/run occurred.

**NOT_RUN:** Docker build/Compose validation by Docker CLI, Linux socket ACL and
namespace negative probes, real PG/TLS scenario, quota envelope, actual production
runtime-bootstrap, production ingress, capacity50+2. Previous actual smoke FAIL
is not superseded by these local checks. No production readiness claim.

Next action requires CTO diff review and a separate owner permission for the
exact publication/one-run workflow. API replacement must recreate namespace
sidecars; no automatic fallback to host13020/public3000 is permitted. Production
rollback and operator gates remain Work's existing plan, not exercised here.

Local final result: Node22.23.3, 23/23 targeted tests PASS, zero skips; 12 syntax checks PASS. Two intentional mutants fail the intended assertions, then original bytes restored. A Windows launch-fence probe exits1 before any Docker call (expected rejection, not a PG/TLS run). No broad suites or completed CI rerun.
