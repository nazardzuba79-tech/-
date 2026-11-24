CREATE TABLE "QuantStrategyDraft" (
  "id" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "pair" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "QuantStrategyDraft_ownerUserId_createdAt_idx" ON "QuantStrategyDraft"("ownerUserId","createdAt");
CREATE INDEX "QuantStrategyDraft_publishedAt_id_idx" ON "QuantStrategyDraft"("publishedAt","id");

ALTER TABLE "CopyStrategyOwner" ADD COLUMN "studioAuthorUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "CopyStrategyOwner_studioAuthorUserId_key" ON "CopyStrategyOwner"("studioAuthorUserId");
