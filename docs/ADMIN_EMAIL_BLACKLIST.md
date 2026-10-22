# Manual email blacklist

The latest CONTACT_EMAIL_BLOCKED / CONTACT_EMAIL_UNBLOCKED AuditLog event is the durable state. Only trim and case normalization apply; aliases, domains and IPs are not expanded. Admin -> Users supports row Spam / Not spam, a Spam filter and a manual email list showing actor and time.

Blocking records the audit and revokes matching active Session rows in one PostgreSQL transaction. Unblocking appends an audit event; it does not restore sessions or modify User, Balance, Order or history rows. Legacy JWTs issued before a block remain revoked after unblocking. Login, registration, pending 2FA and authenticated Support check the policy.

## Release gate

Do not activate until exact-head CI including blacklist-postgres and browser QA passes. No Prisma migration or dependency changes are required. Production currently uses a narrower backend than main: backport only this feature onto the verified serving SHA; do not deploy unrelated main changes.

1. Privately generate a random SUPPORT_RELAY_KEY (at least 32 random bytes). Store the same value in backend configuration and the Support Worker secret binding. Never put it in frontend variables, Git or logs.
2. Deploy the compatible backend and verify health, one collector and unchanged DB container. Deploy the Worker and frontend together in the controlled release. The Worker fails closed if the relay secret is absent. Preserve previous images, Worker version and configuration for rollback.
3. Add the three owner-supplied addresses through the authenticated Admin spam list. This is an explicit business action, not QA. Verify the list and revoked-session count without creating accounts or sending mail. The addresses are not hardcoded in any frontend or source file.
4. Check that guest homepage has no Support launcher, unauthenticated API and direct Worker sends are rejected, and backend /health reports the expected SHA. Do not send production email as a smoke test.

QA uses synthetic addresses and recorded mail only. PostgreSQL integration requires EMAIL_POLICY_TEST_URL matching a localhost voltex_email_policy_test database; an arbitrary DATABASE_URL cannot enable it. See Support form CI and scripts/qa-admin-spam.cjs, scripts/qa-support-form.cjs.
