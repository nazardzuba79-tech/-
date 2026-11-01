-- Automatic Futures copy: the follower's explicit consent carries one revocable
-- Session row the server uses for that follower's own Native Demo commands.
-- Additive; the copy tables are new in #662 and hold review data only.
ALTER TABLE "CopyFuturesDemoConsent" ADD COLUMN "delegatedSessionId" TEXT;
ALTER TABLE "CopyFuturesDemoConsent" ADD COLUMN "delegationExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CopyFuturesDemoConsent_delegatedSessionId_key" ON "CopyFuturesDemoConsent"("delegatedSessionId");
