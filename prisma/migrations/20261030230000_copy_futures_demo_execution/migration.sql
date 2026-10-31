-- TEST-ONLY additive metadata. No financial tables or existing rows are updated.
ALTER TABLE "CopyFuturesDemoEvent" ADD COLUMN "sourceEventIndex" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "CopyFuturesDemoConsent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL UNIQUE,
 "subscriptionId" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','STOPPED')),
 "ratio" DECIMAL(18,8) NOT NULL CHECK ("ratio" > 0 AND "ratio" <= 1),
 "maxLeverage" DECIMAL(18,8) NOT NULL CHECK ("maxLeverage" > 0),
 "maxFillUsdt" DECIMAL(36,18) NOT NULL CHECK ("maxFillUsdt" > 0),
 "maxTotalExposureUsdt" DECIMAL(36,18) NOT NULL CHECK ("maxTotalExposureUsdt" >= "maxFillUsdt"),
 "maxDeviationBps" DECIMAL(8,2) NOT NULL CHECK ("maxDeviationBps" >= 0 AND "maxDeviationBps" <= 10000),
 "startedAfterRevision" INTEGER NOT NULL CHECK ("startedAfterRevision" >= 1),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("subscriptionId") REFERENCES "CopyFuturesDemoSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CopyFuturesDemoMirror" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "consentId" TEXT NOT NULL,
 "sourceEventId" TEXT NOT NULL,
 "sourcePositionId" TEXT NOT NULL,
 "sourceRevision" INTEGER NOT NULL CHECK ("sourceRevision" > 0),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('OPEN','CLOSE')),
 "requestKey" TEXT NOT NULL UNIQUE,
 "followerPositionId" TEXT,
 "filledQuantity" DECIMAL(36,18),
 "status" TEXT NOT NULL DEFAULT 'APPLIED' CHECK ("status" IN ('APPLIED','REJECTED')),
 "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("consentId") REFERENCES "CopyFuturesDemoConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("consentId","sourceEventId")
);
CREATE INDEX "CopyFuturesDemoMirror_consentId_sourcePositionId_idx"
 ON "CopyFuturesDemoMirror"("consentId","sourcePositionId");
