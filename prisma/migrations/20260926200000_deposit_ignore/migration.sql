-- Additive: «Игнорировать» keeps the transfer row and records who/why/when.
BEGIN;

ALTER TABLE "Deposit"
  ADD COLUMN "ignoredAt" TIMESTAMP(3),
  ADD COLUMN "ignoredReason" TEXT,
  ADD COLUMN "ignoredNote" TEXT,
  ADD COLUMN "ignoredByAdminId" TEXT;

CREATE INDEX "Deposit_ignoredAt_idx" ON "Deposit"("ignoredAt");

-- Transfers already hidden with the old «Игнорировать» (IgnoredIncomingTransfer)
-- stay hidden in the new queue. Only unattributed, uncredited rows; nothing
-- else is touched and no row is deleted.
UPDATE "Deposit" d
SET "ignoredAt" = i."createdAt", "ignoredReason" = 'LEGACY_IGNORE', "revision" = d."revision" + 1
FROM "IgnoredIncomingTransfer" i
WHERE i."chain" = d."chain" AND i."txHash" = d."txHash"
  AND d."userId" IS NULL AND d."status" <> 'CREDITED' AND d."batchId" IS NULL AND d."ignoredAt" IS NULL;

COMMIT;
