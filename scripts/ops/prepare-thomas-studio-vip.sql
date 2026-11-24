-- Run only after the Studio schema is deployed and the owner separately approves Thomas.
-- This grant reuses the existing premium flag. The copy leader binding stays NULL.
BEGIN;
INSERT INTO "CopyStrategyOwner" ("traderId","publicName","studioAuthorUserId","premium","updatedAt")
SELECT 'STUDIO-THOMAS', COALESCE(NULLIF(trim("displayName"),''),'Thomas'), "id", TRUE, CURRENT_TIMESTAMP
FROM "User" WHERE "id"='85bb5e78-7f14-43e1-a5e4-7a0becf14a60'
ON CONFLICT ("traderId") DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "CopyStrategyOwner"
    WHERE "traderId"='STUDIO-THOMAS'
      AND "studioAuthorUserId"='85bb5e78-7f14-43e1-a5e4-7a0becf14a60'
      AND premium AND "ownerUserId" IS NULL AND "socialOwnerUserId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Missing profile or conflicting Thomas Studio binding';
  END IF;
END $$;
COMMIT;
