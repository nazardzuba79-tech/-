# Issue #644 — first isolated, manual-drain Native Demo Futures copy executor

This implementation is **test-only** and stacked on #650 -> #649 -> #648 -> #647 -> #646 -> #645 -> #643. It is NOT a production Futures Copy Trading release. No merge, deploy or actual customer trading is permitted.

## Why this is separate from observation

An OBSERVING subscription does not authorize financial action. A completely different `CopyFuturesDemoConsent` must be explicitly created with ratio, max leverage, per-fill notional, aggregate exposure, and maximum allowed price deviation. Consent starts at the *current* immutable source revision, never historical events. The subscriber's existing Native Demo account must be flat, in current live mode, with an unrevoked session. Only an allowlisted Native Demo TEST user can consent; source identity remains a bound same-environment strategy. A manually invoked `drainOne()` takes at most one newer, source-provenanced event at a time. It has no scheduler and no public API.

## Actual modeled demo execution

`FuturesDemoFollowerExecutor` issues `NativeDemoService.command` with an internal deterministic key derived from consent ID and immutable source event ID. The existing Native Demo repository remains the **only** authority for funds, modeled order book, positions, margin and journal. No SQL directly alters NativeDemoAccount financial data. The follow-up immutable NativeDemoRevision receipt is reconciled to an additive metadata `CopyFuturesDemoMirror` row. Unknown results retain the same key; retries do not duplicate positions. A retry first looks up the NativeDemoRevision receipt for that key: when the earlier attempt committed and only its response was lost, the receipt is journaled as APPLIED without re-running the pre-checks (before 31.10 a lost CLOSE response was journaled as REJECTED `FOLLOWER_POSITION_MIXED_WITH_OTHER_ACTIVITY` although the follower position was closed). If consent is stopped between that commit and the retry, the receipt stays unjournaled and a new consent is refused (`FOLLOWER_MUST_START_FLAT`) until it is reconciled.

A `NativeCommitGuard` runs on the **finished modeled result before the PostgreSQL CAS commit**, and again immediately before the final DB write. It checks actual modeled fill price vs source, actual notional, portfolio exposure, leverage, fill quantity, unrelated protection/funding/liquidation activity and position ownership. Rejecting this guard prevents the entire Native Demo journal and position update. A source's price is only a slippage reference: follower execution is priced from its independently observed book.

In this intentionally narrow slice:
- Only one live follower position may be copied at a time. Existing independent positions/open orders refuse admission. The follower position is isolated margin regardless of the leader's chosen Cross/Isolated mode, to prevent broader collateral risk.
- A source's first OPEN may be followed, and a source CLOSE may reduce exactly its mapped follower position. Additional OPENs into the same source position are explicitly rejected, not silently merged.
- If the follower quote has no depth, stale marks or invalid margin, NativeDemoService/commit guard refuses it.
- Source events before explicit consent cannot execute; the screen remains OBSERVATION_ONLY until a distinct later owner-approved product activation.
- Stop serializes against manual drain under the consent row lock and never liquidates already opened demo positions. Full position close/stop/reconciliation UX remains a separate requirement.
- A persisted, nonexpired Native Demo execution session is mandatory; the executor cannot invent a future expiry to act as a new user.

## Hard isolation

`COPY_FUTURES_DEMO_EXECUTION_ENABLED=true` must be set **in addition to** the existing observer gate; the latter includes `COPY_FUTURES_DEMO_OBSERVER_ENABLED=true`, `COPY_DEMO_ENABLED=true`, `COPY_DEMO_ISOLATED_REVIEW=true`, `DEMO_SPOT_ENABLED=true`, `NODE_ENV=test` and a loopback PostgreSQL database named `copy_demo_...`. No remote/production database can enable it. The current test invokes a service with an injected gate on a disposable local CI database; no production environment variable was changed.

## Evidence and remaining blockers

`copy-futures-executor-isolated.yml` builds TypeScript, applies migrations only to a disposable PostgreSQL 18.6 service, runs direct NativeDemoService guard tests and executes real Native Demo leader/follower OPEN/CLOSE with a separate immutable record. Exact-head CI must be verified before PASS can be claimed.

Still required: position add-ons and simultaneous contracts, a durable server-side periodic worker (with capacity/backpressure), protocol for source leverage/protection changes and auto TP/SL/liquidation, explicit client risk UX and consent, full cancellation reconciliation, operational kill switch, authenticated external test sessions and load/regression gates. Do NOT use this candidate to offer real-money copy trading or turn on a production service.
