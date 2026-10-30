# Issue #644 — Futures Demo subscription/inbox, strictly observation-only

This is a stacked Draft after #648 -> #647 -> #646 -> #645 -> #643, not a product release.

## Implemented for isolated PostgreSQL review

- `CopyFuturesDemoSubscription` persists the subscriber, fixed strategy binding, explicit max leverage/max observed fill notional, a revision cursor, and `OBSERVING/STOPPED` status.
- `CopyFuturesDemoEvent` stores only accepted, immutable source-event references and modeled demo fill metadata, with `UNIQUE(subscriptionId, sourceEventId)`; permanent `OBSERVED_ONLY` status. A stored event **does not execute** or authorize a follower order.
- Authorize each subscriber through their persisted Session and User (refuse revoked sessions, blocked users, missing Native Demo account); leaders cannot follow. Require existing same-environment `CopyStrategyOwner`, an initialized leader Native Demo account and explicitly opted-in leader ID. Never infer leader consent from a public strategy page.
- Creating or resuming an observation starts at the source's latest committed Native Demo revision: no pre-subscription backfill. Source switching and owner rebinding are fail-closed. A stopped observer receives no new events.
- Explicit, bounded `scan` processes up to 8 immutable `NativeDemoRevision` records at a time. Per-user PostgreSQL row locks serialize overlapping reads, keep source revision order and protect the cursor; unique source event constraints remove repeats across revisions and retries. Missing revision = fail-closed, not silent advancement.
- The read-only source classifier accepts only account-journal-linked book fills (not synthetic history); leverage and notional caps are checked for metadata admission.

## Isolation

`futuresDemoObserverEnabled` requires `COPY_FUTURES_DEMO_OBSERVER_ENABLED=true` **plus every existing copy-demo hard-isolation condition:** COPY_DEMO_ENABLED=true, COPY_DEMO_ISOLATED_REVIEW=true, DEMO_SPOT_ENABLED=true, NODE_ENV=test and a loopback PostgreSQL database named `copy_demo_...`. `approvedFuturesDemoLeader` additionally requires an explicit `COPY_FUTURES_DEMO_APPROVED_LEADER_IDS` list. This is intentionally unusable on production database or NODE_ENV=production.

The test may inject a strict allowlist and gate only on disposable PostgreSQL. An isolated, gated REST route exists at `/api/v1/copy-trading/futures-demo-observer` for GET snapshot, PUT subscription, explicit POST scan and DELETE stop. It cannot place or close trades. No frontend, no timer, no scheduled scan, no user creation endpoint, no funds endpoint, no NativeDemoService.command invocation, no financial-table modification, and no real Futures import. Only the separate metadata tables can be mutated. The migration is additive and **not applied to production**.

## Reproduction and status

GitHub Actions workflow `copy-futures-demo-observer.yml` provisions PostgreSQL 18.6, applies all migrations only inside the disposable CI database, builds TypeScript, and executes `scripts/test-copy-futures-observer-postgres.cjs`. The script refuses a remote or non-`copy_demo_` database and refuses a nonempty User table. Fixture credits/accounts are written only to that disposable database. Checks cover gate, owner consent, source binding, revoked session, real JWT/Express request ownership and forged request rejection, duplicate concurrent scans, stopped observer/resume, missing revisions, risk filters, and real/demo table equality.

**All results are pending exact-head CI unless linked explicitly to a completed run.** No statement about financial copy execution follows from these checks.

## Outstanding before genuine Futures Copy Trading

Implement follower-specific authorization and per-source-position allocation; resolve partial fills, position side and reduce-only correctness; check Cross/Isolated margin, fees, max exposure, collateral, liquidation, fresh price and slippage; execute with NativeDemoService.command using deterministic idempotency after a durable, atomic claim; stop/revoke, rollback/reconciliation, high-fanout capacity bounds and provenance audit; extensive PostgreSQL and browser tests. Never call the ordinary FuturesPositionService for a demo follower. Require user authorization before any production migration/merge/deploy.
