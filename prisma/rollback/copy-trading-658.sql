-- Rollback for the Copy Trading #658 integration candidate (#643 → #651 + integration).
-- Run ONLY after the application release that uses these tables has been rolled back.
-- The four migrations are purely additive: seven new tables, no change to any existing
-- table, column, balance or ledger. Dropping them removes copy-review metadata only.
-- Take a pg_dump of these seven tables first if their contents must be kept for audit.
BEGIN;
DROP TABLE IF EXISTS "CopyFuturesDemoMirror";
DROP TABLE IF EXISTS "CopyFuturesDemoConsent";
DROP TABLE IF EXISTS "CopyFuturesDemoEvent";
DROP TABLE IF EXISTS "CopyFuturesDemoSubscription";
DROP TABLE IF EXISTS "CopyDemoFill";
DROP TABLE IF EXISTS "CopyDemoExecution";
DROP TABLE IF EXISTS "CopyDemoSubscription";
DELETE FROM "_prisma_migrations" WHERE migration_name IN (
  '20261030180000_copy_demo_subscriptions',
  '20261030210000_copy_futures_demo_observer',
  '20261030230000_copy_futures_demo_execution',
  '20261031090000_copy_futures_demo_exit_receipts');
COMMIT;
