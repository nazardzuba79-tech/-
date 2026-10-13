# Stocks synthetic TLS ingress rehearsal — fixture only

This is a local contract rehearsal. It does not implement or authorize production ingress, public frontend wiring, live authentication access, or deployment. Existing runtime and public-host fences remain intact.

## Files and invocation

- `scripts/qa-stocks-tls-ingress.cjs`: QA HTTPS wrapper and ephemeral certificate generation.
- `scripts/qa-stocks-tls-ingress.test.cjs`: finite framing, authority, disconnect and timeout regressions.
- `scripts/qa-stocks-tls-rehearsal.cjs`: explicit invocation of the unchanged local-stage harness, followed by a second fresh ledger through synthetic TLS.

Use an absolute existing Python executable with `cryptography` installed. The locally bundled isolated Python has cryptography 50.0.2. No dependency installation is performed. Set `STOCKS_FIXTURE_PYTHON` to that executable for the Node test command. Run the rehearsal with `node scripts/qa-stocks-tls-rehearsal.cjs --output <new-absolute-directory> --python <absolute-python-executable>`. Existing output directories are rejected.

The rehearsal first invokes the unchanged `qa-stocks-local-stage-recovery.cjs` with its fresh bounded backend TypeScript build. Its compiled real `/api/v1/me`, strict fixture Prisma/session/contact-policy boundary, package/source/build manifest and prior recovery assertions must pass. A second `tls-data/primary.sqlite` is then created beside that verified package. No existing ledger is reused or overwritten. The child uses the existing bounded IPC/exit cleanup.

## TLS and ingress contract

- Python `cryptography` creates a short-lived fixture CA and RSA-2048 server certificate for the reserved `stocks-review.invalid` name. Node validates issuer/signature/SAN. Private keys stay in memory and are not written to artifacts or Git.
- HTTPS listens only on `127.0.0.1`. Clients override lookup directly to that address while sending the synthetic SNI/Host/Origin. Each client receives the fixture CA explicitly with certificate verification enabled. No DNS, OS trust store, global TLS override or real certificate is used.
- Exact SNI, Host and Origin are required. Duplicate headers, caller-supplied forwarded identity headers and non-allowlisted routes/methods are denied. Existing loopback proxy query and trading authorization/CSRF checks still run.
- Headers are capped at 16 KiB, request bodies at 64 KiB and buffered responses at 2 MiB. POST bodies finish within the deadline before any forwarding. The three-second ingress deadline spans body collection and upstream response; monotonic completion checks reject delayed timer delivery. These are QA wrapper limits, not a production capacity claim.
- The wrapper translates admitted synthetic authority to the operator-selected literal loopback gateway. This translation is new QA code. It is not a substitute for reviewing an eventual production gateway implementation.
- Disconnect before a complete POST body does not forward anything. Disconnect after forwarding aborts the matching HTTP request. It cannot promise cancellation of an operation already durably admitted; the unchanged local-stage lost-ACK/idempotency rehearsal covers that case separately.
- Feature-off admission is checked both at headers and immediately before forwarding a complete body. A valid owner POST is held after its first body byte, disabled, and completed; the regression requires 503 with zero upstream/auth/quote deltas and an unchanged ledger. This does not change semantics of an already-forwarded operation. Cached bearer/CSRF requests are also denied. Session revocation remains checked by the actual compiled `/me` fixture.

## Evidence and limits

Artifacts are saved outside Git under the supplied output directory: source hashes, fresh local-stage build/package manifests, TLS public fingerprints, safe error codes, request statuses, assertion results and child logs. No bearer or CSRF values are logged. Public certificate fingerprints identify the ephemeral test chain; no claim is made about production certificates or ingress.

Local runs are Windows Node 24; Linux/Node 22 is not implied. Initial unit evidence is preserved even when a later correction passes. The first unit run exposed a QA response teardown reentrancy bug; settling before destroying the upstream response corrected it. No runtime file changed.

Independent review also found a partial-body feature-off race in this QA wrapper. Its before-fix regression returned 200 instead of 503 and is retained as `tls-ingress-partial-disable-before.log`; the narrow complete-body admission check fixes it. Previously successful reports remain historical evidence, not proof of this added contract.

`frontend/src/pages/stocks/stockHostPolicy.ts` permits only literal `127.0.0.1`; both `StocksPage.tsx` and the Stocks Wallet hook use this shared policy. The synthetic public hostname therefore remains blocked for the unmodified simulator frontend. Public-host fixture evidence is documented separately in `PUBLIC-HOST-FIXTURE-20261014.md`; its in-memory reserved-host candidate does not alter this real fence. Packaging, deployment, production auth load, storage operations and all prior capacity/data-rights release gates remain separate evidence requirements.
