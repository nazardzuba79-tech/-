# Five-character referral links

Public links keep the existing domains: https://voltextech.net/9BB77 and https://ru.voltextech.net/9BB77.
No frontend runtime, DNS, redirect, layout, language or financial calculation changes.

## Identity and compatibility
- Add nullable unique User.referralShortCode (five uppercase base36 characters).
- Keep User.referralCode and referredById unchanged. Both legacy and short links resolve at registration; lowercase links normalize as before.
- Profile and Banking return the same public alias through their existing referralCode response field. No extra HTTP requests or lookup during page navigation.
- Existing accounts prefer the first five characters if available. Prefix collisions, legacy short codes and reserved page names get another code; the unique DB index rejects concurrent collisions.
- New accounts get an alias through the column's database default; registration retries the alias unique constraint. The legacy eight-character generator remains unchanged, so new canonical codes cannot overlap the alias namespace.
- Codes are public identifiers, not passwords. 36^5 = 60,466,176 possible strings before reserved paths/existing legacy short codes. Future five-character app routes must be checked against issued aliases before adoption.
- Never manually rewrite canonical codes into the five-character namespace. Default allocation excludes current canonical codes; direct database writes are not a referral-management API.

## Release order and rollback
Production NOT changed by this PR. Main and installed production differ; do not deploy all of main.
1. Back up and preflight the installed API/schema. Review migration lock/backfill time against actual user count.
2. Apply only 20261030120000_referral_short_codes. It adds alias metadata and does not change financial tables, canonical codes or referrer bindings.
3. Release a narrowly reviewed API overlay with regenerated Prisma client, auth route, referral route and the two referralSummary lines in BankingService. Preserve all installed newer fixes.
4. Existing frontend already renders the API's code; no frontend deployment is necessary.
5. Verify both old/new links for the same referrer, both region selectors, anonymous handling and financial invariants.
Rollback the display change while retaining the alias column, its unique/default constraints and the auth alias resolver. Already shared short links must continue to resolve. Do not roll back to an old auth module that silently ignores short codes; if auth itself must be reverted, pause new registrations until a compatible resolver is restored. No alias or financial data is deleted.

## Local evidence (2026-10-30)
- 79 targeted auth/link tests PASS; backend and frontend builds PASS.
- Isolated PostgreSQL 18.6: historical migration, six prefix/reserved/legacy fixtures, 250 concurrent creations, unique index/format rejection, reconnect persistence, unchanged legacy bindings and financial sentinel rows PASS.
- Existing 13 Banking accounting integration tests PASS in the isolated database.
- Built browser QA: eight cases across both origins, 1440/390; new uppercase/lowercase five-character links and old eight-character links reach registration and preserve referredById; copy/reload/Banking/profile agree; no overflow, page errors or financial writes.
- Local browser fixture has no live external connections. It does not establish production deployment.
- Local Windows junction initially broke Vite root resolution; build from the physical checkout path passed. First browser run used the accounting-test database and correctly rejected its existing financial rows; a separate fresh browser database passed. Tests were not weakened.
- Expected warnings: notification transport deliberately NOT_CONFIGURED in fixtures; existing frontend chunks >500 kB.
- CI exposed historical fixture queries returning every current User column against intentionally old schemas. OTC/Stocks fixture creates/updates now return only ID; their pinned schemas, financial scenarios and assertions are unchanged. Local reruns: OTC historical cutover 21 scenarios PASS; Stocks PostgreSQL authority 22 tests PASS, zero skipped.
- Support-form CI now initializes its disposable database with migrations instead of db push, so the SQL default allocator is installed. No deployment step was changed.
CI evidence belongs to the final PR SHA, not these local runs.
