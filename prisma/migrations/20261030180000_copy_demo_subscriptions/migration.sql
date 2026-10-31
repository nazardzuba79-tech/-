-- Isolated review only. Metadata references existing demo execution; no credits.
CREATE TABLE "CopyDemoSubscription" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE,
  "traderId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','STOPPING','STOPPED')),
  "ratio" DECIMAL(18,8) NOT NULL CHECK ("ratio" > 0 AND "ratio" <= 1),
  "maxOrderUsdt" DECIMAL(36,18) NOT NULL CHECK ("maxOrderUsdt" > 0),
  "maxExposureUsdt" DECIMAL(36,18) NOT NULL CHECK ("maxExposureUsdt" >= "maxOrderUsdt"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("traderId") REFERENCES "CopyStrategyOwner"("traderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CopyDemoSubscription_traderId_status_idx" ON "CopyDemoSubscription"("traderId","status");
CREATE TABLE "CopyDemoExecution" (
  "sequence" BIGSERIAL NOT NULL UNIQUE,
  "id" TEXT NOT NULL PRIMARY KEY, "subscriptionId" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL, "pair" TEXT NOT NULL, "side" TEXT NOT NULL CHECK ("side" IN ('BUY','SELL')),
  "sourceType" TEXT NOT NULL, "sourcePrice" DECIMAL(36,18), "sourceQuantity" DECIMAL(36,18) NOT NULL CHECK ("sourceQuantity" > 0),
  "ratio" DECIMAL(18,8) NOT NULL CHECK ("ratio" > 0 AND "ratio" <= 1),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','EXECUTED','REJECTED','SKIPPED')),
  "reason" TEXT, "demoOrderId" TEXT UNIQUE, "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("subscriptionId") REFERENCES "CopyDemoSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("subscriptionId","sourceOrderId")
);
CREATE INDEX "CopyDemoExecution_status_createdAt_idx" ON "CopyDemoExecution"("status","createdAt");
CREATE INDEX "CopyDemoExecution_sourceOrderId_idx" ON "CopyDemoExecution"("sourceOrderId");
CREATE TABLE "CopyDemoFill" (
  "sequence" BIGSERIAL NOT NULL PRIMARY KEY,
  "executionId" TEXT NOT NULL REFERENCES "CopyDemoExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tradeId" TEXT NOT NULL,
  UNIQUE ("executionId","tradeId")
);
