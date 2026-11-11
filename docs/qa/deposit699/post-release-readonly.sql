-- Issue #699 — READ-ONLY checks AFTER the release (run by the operator, any time).
--   psql -X -v ON_ERROR_STOP=1 -U <user> -d <database> -f post-release-readonly.sql
-- Changes nothing (READ ONLY transaction, short timeouts). Prints no full TXID,
-- address, e-mail or user id.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '500ms';

\echo '== 1. Notice journal by Kyiv day, kind and outcome (one record per transfer) =='
SELECT to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY') AS kyiv_day,
       a.action, coalesce(a.metadata ->> 'noticeClass', '(before #699)') AS class,
       a.metadata ->> 'deliveryStatus' AS delivery, count(*) AS transfers
FROM "AuditLog" a
WHERE a.id LIKE 'deposit-notice:%' AND a."createdAt" > now() - interval '7 days'
GROUP BY 1, 2, 3, 4 ORDER BY min(a."createdAt"), 2, 3;

\echo '== 2. Repeat protection: every announced transfer exists once; none has two records (must be 0 rows) =='
SELECT a.metadata ->> 'depositId' AS deposit, count(*) AS records
FROM "AuditLog" a WHERE a.id LIKE 'deposit-notice:%'
GROUP BY 1 HAVING count(*) > 1;

\echo '== 3. Individual alerts sent since the release must be FRESH and never micro (must be 0 rows) =='
SELECT left(d."txHash", 6) || '…' || right(d."txHash", 4) AS tx, d.asset, d.amount::text AS amount, a.metadata ->> 'noticeClass' AS class
FROM "AuditLog" a JOIN "Deposit" d ON a.id = 'deposit-notice:' || d.id
WHERE a.action = 'DEPOSIT_NOTIFICATION_DELIVERY' AND a.metadata ? 'noticeClass'
  AND (a.metadata ->> 'noticeClass' <> 'FRESH' OR d.amount < 1);

\echo '== 4. Daily digest: claims, acknowledgements and size (at most one delivered digest per Kyiv day) =='
SELECT c.id AS digest, to_char(c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI') AS claimed_kyiv,
       jsonb_array_length(c.metadata -> 'depositIds') AS transfers, c.metadata -> 'groups' AS groups,
       k.metadata ->> 'deliveryStatus' AS delivery, k.metadata ->> 'deliveredDay' AS delivered_day,
       (SELECT count(*) FROM "AuditLog" r WHERE r.id LIKE 'deposit-notice:%' AND r.metadata ->> 'digestId' = c.id) AS journalled
FROM "AuditLog" c
LEFT JOIN "AuditLog" k ON k.id = replace(c.id, 'deposit-digest:', 'deposit-digest-ack:')
WHERE c.action = 'DEPOSIT_NOTICE_DIGEST_CLAIMED' ORDER BY c."createdAt";

\echo '== 5. Two delivered digests on one Kyiv day (must be 0 rows) =='
SELECT k.metadata ->> 'deliveredDay' AS kyiv_day, count(*) AS delivered
FROM "AuditLog" k WHERE k.action = 'DEPOSIT_NOTICE_DIGEST_DELIVERY' AND k.metadata ->> 'deliveryStatus' = 'SENT'
GROUP BY 1 HAVING count(*) > 1;

\echo '== 6. Proven transfers still waiting for a notice (FRESH should be 0 after a successful scan) =='
SELECT d.asset,
       CASE WHEN d.amount < 1 THEN 'MICRO (next digest)'
            WHEN d."blockTimestamp" IS NULL THEN 'TIME_UNKNOWN (next digest)'
            WHEN d."createdAt" - d."blockTimestamp" > interval '48 hours' THEN 'late or HISTORICAL'
            ELSE 'FRESH (alert due)' END AS class,
       count(*) AS transfers
FROM "Deposit" d
WHERE d.chain = 'tron' AND d.asset IN ('USDT', 'TRX') AND d.status <> 'CREDITED'
  AND d."verifiedAt" IS NOT NULL AND d.finalized = true AND d."verifyError" IS NULL AND d."ignoredAt" IS NULL
  AND d."createdAt" > now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.id = 'deposit-notice:' || d.id)
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== 7. Watcher: schedule state and the last run summary (notices are counts only) =='
SELECT enabled, "lastRunTrigger", "lastRunOk", "providerStatus",
       to_char("lastRunStartedAt"   AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS last_run_kyiv,
       to_char("lastScheduledRunAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS last_scheduled_kyiv,
       "lastRunSummary" -> 'notices' AS notices, "lastRunSummary" -> 'newTransfers' AS new_transfers, "lastRunSummary" -> 'error' AS error
FROM "DepositWatchState" WHERE id = 'tron';

\echo '== 8. Sentinels the release must not move: credited/attributed watcher rows and row totals =='
SELECT (SELECT count(*) FROM "Deposit") AS deposits, (SELECT count(*) FROM "Deposit" WHERE status = 'CREDITED') AS credited,
       (SELECT count(*) FROM "DepositBatch") AS batches, (SELECT count(*) FROM "Withdrawal") AS withdrawals,
       (SELECT count(*) FROM "DepositWatchCursor" WHERE chain = 'tron') AS cursors,
       (SELECT count(*) FROM "TreasuryAddressHistory" WHERE chain = 'tron') AS treasury_addresses;

ROLLBACK;
