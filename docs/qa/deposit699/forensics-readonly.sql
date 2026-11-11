-- Issue #699 — READ-ONLY production forensics for the 11 November Telegram burst.
-- Run by the operator inside the PostgreSQL container, e.g.
--   psql -X -v ON_ERROR_STOP=1 -U <user> -d <database> -f forensics-readonly.sql
-- It changes nothing (READ ONLY transaction, short timeouts) and prints no full
-- TXID, no address, no e-mail and no user id. Paste the output privately.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '500ms';

\echo '== 1. Native TRX micro-transfers recorded 9–11 November: chain time vs record time vs notice =='
SELECT left(d."txHash", 6) || '…' || right(d."txHash", 4)                         AS tx,
       d.asset, d.amount::text                                                    AS amount,
       to_char(d."blockTimestamp" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS chain_time_kyiv,
       to_char(d."createdAt"      AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS recorded_kyiv,
       to_char(d."verifiedAt"     AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS verified_kyiv,
       round(extract(epoch FROM d."createdAt" - d."blockTimestamp") / 3600.0, 2)  AS hours_old_when_recorded,
       d.confirmations, d.finalized, d.status, d.source, (d."userId" IS NOT NULL) AS attributed,
       a.action                                                                   AS notice_action,
       a.metadata ->> 'deliveryStatus'                                            AS delivery,
       to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS notice_recorded_kyiv
FROM "Deposit" d
LEFT JOIN "AuditLog" a ON a.id = 'deposit-notice:' || d.id
WHERE d.chain = 'tron' AND d.asset = 'TRX' AND d.amount < 0.001
  AND d."createdAt" >= '2026-11-09 00:00:00' AND d."createdAt" < '2026-11-12 00:00:00'
ORDER BY d."blockTimestamp", d.id;

\echo '== 2. Every deposit notice recorded on 11 November (Kyiv day) =='
SELECT to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS notice_recorded_kyiv,
       a.action, a.metadata ->> 'asset' AS asset, a.metadata ->> 'deliveryStatus' AS delivery,
       d.amount::text AS amount,
       to_char(d."blockTimestamp" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS chain_time_kyiv
FROM "AuditLog" a
LEFT JOIN "Deposit" d ON a.id = 'deposit-notice:' || d.id
WHERE a.id LIKE 'deposit-notice:%'
  AND a."createdAt" >= '2026-11-10 22:00:00' AND a."createdAt" < '2026-11-11 22:00:00'
ORDER BY a."createdAt", a.id;

\echo '== 3. Watcher state: last runs and the stored last-run summary (counts only) =='
SELECT enabled, "lastRunTrigger", "lastRunOk", "providerStatus",
       to_char("lastRunStartedAt"   AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS last_run_started_kyiv,
       to_char("lastScheduledRunAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS last_scheduled_kyiv,
       to_char("lastAdminOpenRunAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS last_admin_open_kyiv,
       "lastRunSummary" -> 'newTransfers' AS new_transfers, "lastRunSummary" -> 'verified' AS verified,
       "lastRunSummary" -> 'backlog' AS backlog, "lastRunSummary" -> 'notices' AS notices
FROM "DepositWatchState" WHERE id = 'tron';

\echo '== 4. Cursors: when watching began and how far each has scanned (address masked) =='
SELECT left(address, 4) || '…' || right(address, 4) AS address, asset,
       to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS watching_since_kyiv,
       to_char(to_timestamp("scannedThroughMs" / 1000.0) AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI:SS') AS scanned_through_kyiv,
       ("windowEndMs" IS NOT NULL) AS window_in_progress, "lastError" IS NOT NULL AS has_error
FROM "DepositWatchCursor" WHERE chain = 'tron' ORDER BY "createdAt";

\echo '== 5. Sentinels: nothing credited or attributed among the micro-transfers =='
SELECT count(*) FILTER (WHERE status = 'CREDITED') AS credited, count(*) FILTER (WHERE "userId" IS NOT NULL) AS attributed, count(*) AS micro_rows
FROM "Deposit" WHERE chain = 'tron' AND asset = 'TRX' AND amount < 0.001;

\echo '== 6. Before the #699 release: proven transfers still without a notice record, by the class the new code will give them =='
SELECT d.asset,
       CASE WHEN d.amount < 1 THEN 'MICRO (digest)'
            WHEN d."blockTimestamp" IS NULL THEN 'TIME_UNKNOWN (digest)'
            WHEN d."createdAt" - d."blockTimestamp" > interval '48 hours' THEN 'HISTORICAL (digest)'
            ELSE 'FRESH (one alert each)' END AS class_after_release,
       count(*) AS transfers
FROM "Deposit" d
WHERE d.chain = 'tron' AND d.asset IN ('USDT', 'TRX') AND d.status <> 'CREDITED'
  AND d."verifiedAt" IS NOT NULL AND d.finalized = true AND d."verifyError" IS NULL AND d."ignoredAt" IS NULL
  AND d."createdAt" > now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.id = 'deposit-notice:' || d.id)
GROUP BY 1, 2 ORDER BY 1, 2;

ROLLBACK;
