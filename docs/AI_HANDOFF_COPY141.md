# Copy Trading #141 — integration handoff

2026-09-19 — reviewer/coordinator.

## Exact inputs

- Fresh release main: `1552390360ffe4dd3018b3eb3625ccecff7401b6` (includes Futures cluster #142).
- Reviewed Copy Trading head: `68cb6c80ff2984996cce172d10c3e9304af8f621`.
- Shared ancestor: `9bf0e493ed7e3fc42ade8b91bb839ee75600dc1b`.
- Owner has explicitly authorized publishing #141 after review and checks; #123 has NO merge authorization here.

## Conflict resolution

The two branches append different sections at the end of the shared 724KB handoff. No application-code path overlaps. Preserve the release `docs/AI_HANDOFF.md` byte-for-byte, including #142, and keep the Copy-specific continuation here instead of replacing that history or duplicating the entire diary.

The full original Copy handoff remains available immutably at:
https://github.com/nazardzuba79-tech/-/blob/68cb6c80ff2984996cce172d10c3e9304af8f621/docs/AI_HANDOFF.md#L2803

All #142 application files, tests, QA script and the QA screenshot directory are copied exactly from fresh main. All Copy application files and Copy evidence stay exactly at reviewed head 68cb6c8. No financial formulas, history, production data, avatar source, orders, balances or engine files change during integration.

## Copy changes being integrated

- Failed intent-prefetch may be retried on navigation; an identity-only/partially unavailable response is not treated as a successful performance refresh. Preserve last-good sections independently and coalesce in-flight work.
- Legacy validated caches are redacted before paint and rewritten without execution details. Old-session results cannot mutate the new session's retry/auth state.
- Strategy execution details are removed server-side LAST, after reported-performance overlays, on marketplace, per-strategy and legacy synthetic routes. Admin access and users' own account executions are separate. Financial aggregates retain their full-history basis.
- Strict HIDDEN payload declaration replaces reliance on visible rows for legitimately unknown holding-time fields. A HIDDEN response containing execution rows or reportedPerformance is rejected.
- Nazar's existing avatar styling uses the same gold ring as Ksenia; no new VIP authorization or photograph is created.
- 61.9% is owner-reported metadata, NOT an overwritten modeled ROI. This PR must not be described as making weekly published ROI 61.9% or as verifying an external trading result. The inclusion/exclusion note is the branch author's recorded owner confirmation, not an independently verified calculation.
- Existing Copy CI now runs the privacy/retry/period suites and both actual-router local browser harnesses. Earlier source-head evidence is not proof of the newly integrated tree: re-run CI before merging.

## Evidence and limits

Read the reviewed source and #141 conversation, including reviewer fixes already recorded at 68cb6c8. Local source-head fixtures are not an authenticated production-account test and do not prove the historical root cause of every user screenshot. A build/deploy success must not be reported as such a test.

## Separate outstanding tasks

Global VOLTEX wordmark enlargement, lower-panel visual rework and full text readability are a separate Claude task. Whole-site developer-message audit stays separate from Copy financial state; replace developer wording with honest customer wording, never hide required simulation disclosures or pretend stale data is live. No merge of #123 and no balance re-credit.
