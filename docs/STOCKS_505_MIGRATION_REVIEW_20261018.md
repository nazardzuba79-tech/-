# Stocks #505 — offline file-chain review and attempt gate

Base: Draft #545 at 3e6b88d3daf9d83068c9d911b5ba0e109a2511b6, based on main f81df788a8ddcc5d925b827b6e783f6e21dc39fa.
Owner work order: https://github.com/nazardzuba79-tech/-/issues/505#issuecomment-6246888593

The unpublished 8331513 preparation is preserved. Only its independent filesystem migration checker and tests were recovered. Its constructor/workflow duplicate the module-load boundary already covered by #545, so they were not imported. Historical image/ledger snapshots and the old Stocks-only pending proposal are not published as current production facts or approvals.

## Read-only preflight correction

For each required migration, accept exactly one non-rolled-back completed attempt and zero non-rolled-back unresolved attempts. Resolved rolled-back history is allowed. The previous gate counted successful rows alone, so success plus an unresolved attempt incorrectly passed.

The existing READ ONLY transaction, two-principal configuration, aggregate-only output and productionAuthorized:false remain unchanged. The synthetic regression covers both required migration names, missing rows, rollback-only history, duplicate successes, success plus unresolved and resolved rollback plus success. A disposable PostgreSQL test verifies all twelve scenarios, READ ONLY transaction mode and unchanged synthetic account rows.

## File-only full-chain check

    node scripts/qa/stocks-migration-review.cjs baseline.json candidate-migrations reviewed-pending.json

- baseline.json contains migrations: an array of exact migration name/sha256 pairs from a separately authenticated, pinned source.
- candidate-migrations is a read-only exported directory with exact migration.sql bytes.
- reviewed-pending.json is an array of the proposed SQL name/hash pairs. It is a file allowlist, not permission to execute SQL.
- Missing/changed history, unexpected pending SQL, missing/changed proposals, duplicate entries and malformed manifests block.
- PASS_FILE_REVIEW_ONLY never proves the running image, applied ledger, failed-attempt state, dependency readiness, backup restore or release authorization.
- Historical image bytes and ledger checksums must remain separate evidence. Never silently normalize CRLF/LF, rewrite historical SQL or repair the migration ledger to make a check pass.

Against the historical 44-migration receipt, current main has 46 migration directories. The two additions in order are:
1. 20261016000000_stocks_test_cash_authority: three tables, existing User FK and receipt/audit FKs. No balance seed/update.
2. 20261016170000_native_funding_model: NativeFundingModel plus immutable-row trigger/function. This is separate existing Funding code; this task grants no rollout permission.

Current production pending/failed/order/checksum state is ACCESS_BLOCKED without the existing authenticated operator mechanism. The historical receipt is not a fresh read. A complete read-only chain review must compare all image files, candidate files and ledger attempts; checking two names is insufficient.

## Runtime and release boundaries

The #545 job remains Node 22.23.3 + fresh lockfile dependencies + compiled API module-load smoke. It is not actual pinned production-image/dependency/native-engine proof. No speculative runtime upgrade or constructor rewrite is made.

Keep API, WS and frontend Stocks flags OFF. No live quotes, broker orders, service starts, public proxy, schema/migration execution on production, balances, role changes, merge or deploy.

Actual image validation, full current migration chain and verified full backup restore remain blocked. Archive validation with pg_restore --file=/dev/null is not a full restore. Do not overwrite backups or run restore/migration commands in this task.

Real identity verification stays private and unproven. Stopped staging data/isolation and readiness require read-only operator evidence; no staging container may be started here. The previous +14.3481% remains FAIL; no new 50+2 capacity run or crypto p95 PASS is claimed. Provider rights remain NOT CLEARED.
