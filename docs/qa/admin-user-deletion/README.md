# Admin account deletion verification

Code commit: 5b083fe8e0b26b93cb70d59302f34a5f939ec78c. Base synchronized with main 1a60840509340b8214534a52ffe32628f21c1326.

- Backend and frontend production builds pass. Vite reports the existing 500 kB bundle warning.
- Scoped CI command: 961 tests pass in 60 suites; 22 tests in 2 database-dependent suites skip without their dedicated DB environment. The separate embedded PostgreSQL harness runs against its own disposable localhost cluster, never production DATABASE_URL.
- PostgreSQL/browser harness: 20 checks pass. Screenshots: 1440 and 390 px. Includes cancellation, 409 error/retry, double-click deduplication, list refresh, detail deletion/redirect and protected email UI.
- Existing rows survive the migration. Full owned model fixtures delete atomically; immediate and deferred-COMMIT failures roll back; all three order books remain intact on rollback and cancel owned orders only after confirmed commit.
- Uncredited deposits retain hash/amount/history and become permanently ignored. Credited records and withdrawals with hashes remain immutable. Attribution, restoration, duplicate hash insertion and package reentry are refused. Other users/referral rewards remain.
- Existing native/banking immutability remains except the target-specific transaction-local admin deletion authorization. Legacy/session JWT and previously valid HMAC API key fail after deletion.
- Broader exploratory run: 1209 pass, one unrelated stale CFD assertion expects Gold US Dollar but current source returns Gold Spot. The CFD test and implementation are unchanged from main. No CFD production change was made.

## Operational boundaries

The current Render service voltex-api was verified read-only in workspace VOLTEX Free: one instance, free plan, auto-deploy from main. Coordination drains the existing process-local Spot/Demo books plus Futures publication; it is not a new multi-replica matching architecture. Do not scale the memory-book service to multiple independent writers without distributed book coordination.

If PostgreSQL cannot establish whether deletion committed, matching fails closed and logs ADMIN_DELETE_COMMIT_UNKNOWN (no secrets or user data). Restore DB connectivity and restart the service so startup rebuilds books before matching resumes. Ordinary rollback does not halt trading.

Old AuditLog rows and shared counterparty execution history are retained. Dormant Support conversations and strategy owner references are detached. Native/private/banking owned records are removed. KYC metadata is deleted; no Cloudflare/email delivery is changed and no legacy disk file is removed without a verified safe ownership path. Production accounts were not deleted during QA.
