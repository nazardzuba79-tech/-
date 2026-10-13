# Targeted HTTP and recovery evidence

Candidate work after PR #512 base `be610e27dccf4d2c5c161de5c8b683611555808f`. These local captures include uncommitted candidate files; they are **not** exact-head CI results for that base. `raw-manifest.json` binds the retained raw bytes. Runtime hashes captured on Windows refer to working-file bytes, which can differ from normalized Git blobs.

## Local results

| Evidence | Actual result | Scope |
| --- | --- | --- |
| `history-cancellation-before.log` | Expected regression failure: an abandoned queued HTTP history request still starts one provider request | Retained negative control; not removed by later PASS |
| `history-cancellation-expanded.log` | 31/31 PASS, including seven new cancellation cases | Actual local HTTP disconnect, last-reader cancellation, shared-reader retention, started-work completion and replacement-flight ownership |
| `native-offline-proof-review2.log` | 10/10 PASS | Injected offline Binance native-event contract; no live WebSocket or availability/licensing proof |
| `targeted-full-runtime-local.log` | 202/202 PASS; 7,398.5202 ms | Existing 192 runtime cases plus ten offline contract cases, Node 24.21.0. The seven new history cases were run separately in the 31-case focused suite |
| `targeted-harness-final-tests.log` | 25/25 PASS | Fourteen diagnostic harness guards and eleven scheduling-selector regressions; no load or capacity test in this command |
| `local-stage-first-report.json` | FAIL | Initial fixture CSRF bookkeeping error retained; not a production failure |
| `local-stage-final-report.json` | Five cases PASS, 61 assertions; owned child exit 0 | Actual compiled `/me` middleware with strict fixture Prisma, isolated paper accounts, lost acknowledgement/restart/idempotency, feature-off admission and quiesced backup/restore |
| `local-stage-build-provenance.json` and `local-stage-build.log` | Fresh TypeScript build PASS | Compiler, config, 279 unchanged source files and 279 emitted outputs bound by hashes; packaged auth closure matches those outputs |

The local-stage safety guards separately passed 3/3. Backup evidence describes a disposable, quiesced SQLite copy and distinct restore. Original fixture ledger remains preserved. Fixture sessions/identities and deliberately generated tokens are not production credentials; no fixture database is committed here.

Earlier offline seven-case success and the independent failing review probe are retained. The final ten-case run includes the subsequent precision-parity and failed-close cleanup regressions.

`targeted-harness-frozen-hashes.json` records the reviewed LF-normalized harness and workflow source. This is distinct from both the raw-evidence hashes and the measured Docker source/image manifests produced by the diagnostic.

## What this evidence does not establish

- The 30-run matched Linux HTTP diagnostic has separate source, resource and result manifests. Its outcome must be read from the actual run artifact; these local tests do not stand in for it.
- Original constrained capacity and crypto coexistence failures remain failures. No new 20/50-user guarantee follows from a unit test or targeted diagnostic.
- Local-stage packaging currently uses installed workspace dependencies. It is not a self-contained deployment image, public TLS ingress, public frontend mount or production auth/database performance proof.
- The offline transport is not imported by the runtime. Bybit native transport, instrument-specific stream availability and commercial redistribution rights remain unverified. MOEX remains blocked.
- No merge, deployment or production database change was performed by these tests.
