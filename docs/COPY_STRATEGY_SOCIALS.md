# Copy strategy social links — Issue #640

Only the real currently bound owner of VX-001 or VX-KSENIA may GET/PATCH
`/copy-trading/socials/:traderId`. ADMIN and premium status confer no permission.
The editor requires a verified, expiring JWT with a live database session.
The write transaction locks the session and strategy binding and checks both
again. A missing binding is denied. Rebinding hides the former owner's links.

The two optional fields live only on CopyStrategyOwner. Independent PATCH and
clearing are idempotent. Unknown fields are rejected. No User profile socials,
financial table, performance engine, account balance or copy operation is used.
Public responses expose only xUrl/telegramUrl in addition to the existing six
public identity fields. Unknown strategies continue to return no identity.
The shared fail-closed projection returns both social fields null for other IDs.

Normalization accepts @handles or HTTPS/naked x.com/twitter.com/t.me profile
URLs; stores canonical HTTPS x.com/t.me URLs. It rejects other schemes, ports,
userinfo, query strings, fragments, encoded paths, invites and reserved routes.
There is no URL resolution or server-side network request.

Every card, profile and locked catalogue row shows both icons. Other strategies
receive disabled native buttons with no href or handlers even if an identity
contains injected links. Active links stop card navigation and use _blank with
noopener noreferrer. Russian labels are scoped to the new controls; existing
seven-language dictionaries and trading controls are unchanged.

## Verification

- Narrow Jest URL, real JSX render and existing Copy presentation/byte guards.
- `node scripts/qa-copy-socials-postgres.cjs` creates a new random-port loopback
  PostgreSQL cluster, applies migrations only there and tests owner update/clear,
  concurrency, missing/reassigned binding, stranger/other owner/VIP/ADMIN denial,
  session revocation/expiry, tampering, public fields and financial preservation.
- With COPY_SOCIAL_BROWSER_QA=1 it then tests the production frontend and real API
  at 1440/390, both owners, save/clear/reload, consistent card/profile links,
  disabled catalogue and cross-owner editor denial. Screenshots are CI artifacts.
- No production credentials, production database or external browser navigation.

## Release and rollback (not executed)

This is code-only. Apply additive migration 20261029150000_copy_strategy_socials
before separately approved API deployment; no deployment/migration is authorized
by this PR. For rollback, revert the application commit and retain nullable
columns (old application ignores them). Do not drop saved values or alter owner
bindings/financial records. Any production release remains an owner decision.
