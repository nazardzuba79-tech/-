# Admin read indexes — proposal only

No schema or production database change is included. The measured candidate uses the existing schema. Evaluate these against the deployed PostgreSQL version and real distribution in an approved follow-up; do not infer production timing from the local fixture benchmark.

## Evidence

At 10,000 fixture customers / 200,000 audit records, the paged audit endpoint returns 20 rows in 52.61 ms median, with 45 ms summed SQL time. The legacy 200-row endpoint is 50.97 ms median; pagination introduces an exact count query. Both currently sort `createdAt DESC, id DESC`, but `AuditLog` only has single-column `userId` and `action` indexes. `Withdrawal` similarly has `userId` and `status` indexes, with no matching default order index. Its paged median is 27.68 ms versus 27.32 ms legacy.

## Narrow first candidates

```sql
-- Proposed review-stage experiment only. Not run by this PR.
CREATE INDEX CONCURRENTLY "AuditLog_createdAt_id_admin_read_idx"
  ON "AuditLog" ("createdAt" DESC, "id" DESC);
CREATE INDEX CONCURRENTLY "Withdrawal_createdAt_id_admin_read_idx"
  ON "Withdrawal" ("createdAt" DESC, "id" DESC);
```

These target the default sort, not the full count cost. First capture `EXPLAIN (ANALYZE, BUFFERS)` on a disposable representative database, then compare 30+ cold/warm repetitions before/after. Retain only indexes with a demonstrated latency/IO benefit and acceptable storage/write cost. The current report does not claim a benefit from these untested indexes.

If scoped audit, status-filtered withdrawals or KYC date-range traffic dominates, separately evaluate `(userId, createdAt DESC, id DESC)`, `(action, createdAt DESC, id DESC)`, `(status, createdAt DESC, id DESC)`, and KYC `(userId, createdAt DESC, id DESC)` on their respective tables. Do not add them all preemptively. Session last-login sorting already has `Session(userId)`; a composite timestamp index may help but must be measured. A basic B-tree does not solve the substring/metadata search cost of the audit-email endpoint.

For any approved production follow-up, use concurrent creation outside a transaction, check for an invalid index after interruption, compare deployed query plans, and keep the API compatible throughout. Roll back only the new named index with `DROP INDEX CONCURRENTLY`, never data or existing indexes. This proposal does not authorize running those commands or deploying a migration.
