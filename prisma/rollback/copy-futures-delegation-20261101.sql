-- Rollback of 20261101090000_copy_futures_demo_delegation only (automatic copy).
-- Run after the API image that uses it is rolled back. Revokes outstanding
-- delegated copy sessions first so none outlives the feature.
BEGIN;
UPDATE "Session" SET "revokedAt" = now()
  WHERE "revokedAt" IS NULL AND id IN (SELECT "delegatedSessionId" FROM "CopyFuturesDemoConsent" WHERE "delegatedSessionId" IS NOT NULL);
DROP INDEX IF EXISTS "CopyFuturesDemoConsent_delegatedSessionId_key";
ALTER TABLE "CopyFuturesDemoConsent" DROP COLUMN IF EXISTS "delegationExpiresAt";
ALTER TABLE "CopyFuturesDemoConsent" DROP COLUMN IF EXISTS "delegatedSessionId";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101090000_copy_futures_demo_delegation';
COMMIT;
