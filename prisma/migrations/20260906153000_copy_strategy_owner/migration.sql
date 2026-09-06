CREATE TABLE "CopyStrategyOwner" (
  "traderId" TEXT NOT NULL PRIMARY KEY,
  "publicName" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "externalOwnerUserId" TEXT,
  "premium" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CopyStrategyOwner_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "CopyReviewScenario" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "state" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
-- No identity import, User creation, account update or synthetic financial seed.
