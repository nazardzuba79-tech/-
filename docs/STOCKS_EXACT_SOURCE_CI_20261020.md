# Stocks exact-source CI follow-up

Scope: CTO Issue #505 comment
https://github.com/nazardzuba79-tech/-/issues/505#issuecomment-6285669444
and the owner's direct code-only instruction. Parent:
`dfd769726df8572995edb197ef75b76197110b0b`.
The containing commit is a **new candidate**; its full SHA is in the delivery
manifest and bundle. Previous parent results are not exact-head CI for it.

Fresh main remains `f81df788a8ddcc5d925b827b6e783f6e21dc39fa`, #554 remains
`ce670d8cc96e46864d3d31d39c1e3a608a0c06bc`. No branch push, PR creation,
workflow dispatch, merge, deployment, database action or load test occurred.

## Event and job inventory

Only these two existing workflows were edited:

| Workflow | Event | Expected immutable source |
| --- | --- | --- |
| `stocks-focused-review.yml` | `pull_request` (existing path filters plus the new CI contract test) | `github.event.pull_request.head.sha` |
| `stocks-legacy-unsupported.yml` | `pull_request` (existing path filters plus the new CI contract test) | `github.event.pull_request.head.sha` |
| Both | Existing `workflow_dispatch` definition | `github.sha`, the selected run's immutable commit; dispatch remains unauthorized |

Both workflows capture `EXPECTED_SOURCE_SHA` once in workflow environment.
The expression selects `github.sha` **only for workflow_dispatch**. It never
falls back to the PR merge-result SHA for a PR event.

| Job | Checkout / evidence | Required role |
| --- | --- | --- |
| `financial-review` | Explicit `ref: env.EXPECTED_SOURCE_SHA`; verify actual `git rev-parse HEAD`; output `source-sha` | Full existing Node24 financial job |
| `node22-hetzner-module-load` | Same explicit ref and verification; output `source-sha` | Full existing Node22.23.3 financial job, plus bounded offline CI contract tests |
| `pg-release-required` / `Stocks PostgreSQL release contract` | No source code execution or checkout; verifies **both** dependency results and actual checkout SHA receipts against expected SHA | Mandatory PG aggregate; cannot pass on missing/mismatched receipts, failure, skip or cancellation |
| `legacy-unsupported` | Same explicit ref and verification; prints expected/verified SHA in its independent summary | Unsupported legacy control; genuine FAIL retained outside PG aggregate |

Each test job prints both expected and actual checkout SHA immediately after
checkout, before dependency installation or tests. Each rejects malformed or
missing SHA, a different actual checkout, an unsupported event, or a head
repository different from the current repository. This contract intentionally
accepts same-repository PRs only; fork PRs fail closed.

All test artifacts are named with the captured source SHA rather than
`github.sha`. Permissions remain exactly `contents: read`; credentials are
not persisted by checkout. No secrets are referenced.

There is no new optional merge-result job. This follow-up does not claim
merge-result integration evidence. Other repository workflows are unchanged.
No push, pull_request_target, workflow_run, schedule or deployment trigger was
introduced.

## Local validation, not GitHub execution

`scripts/qa/stocks-ci-source-head.test.cjs` parses the actual YAML and executes
the exact inline assertion JavaScript using Node22.23.3 and read-only Git
against the checkout. It writes only temporary assertion receipts.

The 37 bounded tests cover:

- Explicit immutable checkout, capture expression and assertion ordering in
  all three test jobs.
- Actual checkout equality for PR/manual event fixtures, including PR fixtures
  whose `GITHUB_SHA` is deliberately a different synthetic merge-result SHA.
- Wrong/missing/malformed expected SHA, fork/missing repository and unsupported
  push event rejection, with no success receipt.
- Aggregate success only for two successful jobs with matching SHA receipts;
  failure, skip, cancellation, missing receipt and another commit are rejected.
- Read-only permissions, no secrets or continue-on-error, SHA-named artifacts.
- Original >0 PASS / 0 FAIL / 0 skipped PG TAP gates and original failing
  legacy command, assertions and test blob.

YAML was parsed locally; the assertion bodies were executed locally.
The GitHub expression engine and hosted workflow execution were **not run**.
The test checks the exact capture expression statically rather than claiming
to emulate GitHub's scheduler. Hosted exact-head CI remains **NOT RUN**.

An offline comparison against `dfd7697` additionally confirms every existing
financial/build/test command is identical. Only source checks, the aggregate
SHA checks, artifact names and the legacy provenance summary changed.
The minimal two-file YAML diff is supplied as `workflows.patch`.

## Preserved evidence and scope

Runtime, API, SQL, financial tests, frontend and profiler have no delta from
`dfd7697`. The original unsupported legacy test blob is still
`d1af5fc7353857d3e5ae60e03fc2c0c2f2c16034`.

The following are **historical local results for dfd7697**, retained with their
original evidence, not rerun or relabeled for this CI-only commit:

- PG release: Node22 compiled authority **23 PASS**, Node24 PG/preflight
  **23 PASS**, no failures or skips.
- Startup/boundary **18 PASS**; Node22 contracts **37 PASS**; financial/source/
  harness contracts **67 PASS**; Jest **39 PASS**; backend TypeScript PASS.
- Unsupported SQLite: **6 PASS / 1 FAIL**, HTTP200 instead of401 at the
  pre-COMMIT revocation barrier, synthetic reservation0 to9, exit1.

No broad suites, PostgreSQL process, new diagnostic profile or load scenario
were started for this follow-up. The prior legacy defect is not repaired.
Financial safety, PG-only production launcher, keep-alive5000ms, DemoBalance,
session fences, financial assertions and Work/Claude code remain unchanged.

## Publication and release status

**Publication BLOCKED:** Northflank build/deploy/preview triggers remain
unverified according to the CTO's latest audit reference. The owner has
explicitly forbidden push, Draft PR and dispatch. Delivery is local bundle,
patch and report only. No unreferenced GitHub blob or Issue comment is published
by this follow-up.

The deploy-capable manual paths `deploy-market-edge.yml`, `support-form.yml`,
`deploy-deposit-catalogue.yml` and `deploy-kyc-edge.yml` are excluded. Neither
they nor any other workflow were dispatched.

**Production independently BLOCKED:** actual image/config/ingress,44+2
migration provenance, backup restore, private principals, data rights and
50+2 capacity still need their separate evidence and approvals. Local static
CI checks are not a production gate PASS.

After Northflank is verified, a separate owner decision must authorize any new
review branch/PR and specifically named nondeploy CI. This document grants no
such permission. Import the bundle into an isolated checkout, verify its full
SHA and review the YAML diff before considering that next step.
