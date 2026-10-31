-- Isolated review metadata only. NEVER touch User/Balance/DemoBalance/NativeDemo payloads.
-- Zero account credits, futures positions, live orders, or financial effects.
CREATE TABLE "CopyFuturesDemoSubscription" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "traderId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OBSERVING'
    CHECK ("status" IN ('OBSERVING', 'STOPPED')),
  "maxLeverage" DECIMAL(18,8) NOT NULL CHECK ("maxLeverage" > 0),
  "maxFillUsdt" DECIMAL(36,18) NOT NULL CHECK ("maxFillUsdt" > 0),
  "lastRevision" INTEGER NOT NULL CHECK ("lastRevision" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CopyFuturesDemoSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CopyFuturesDemoSubscription_traderId_fkey"
    FOREIGN KEY ("traderId") REFERENCES "CopyStrategyOwner"("traderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CopyFuturesDemoSubscription_traderId_status_idx"
  ON "CopyFuturesDemoSubscription"("traderId", "status");

CREATE TABLE "CopyFuturesDemoEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL CHECK ("sourceRevision" > 0),
  "sourceActionId" TEXT NOT NULL,
  "sourcePositionId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('OPEN', 'CLOSE')),
  "side" TEXT NOT NULL CHECK ("side" IN ('LONG', 'SHORT')),
  "quantity" DECIMAL(36,18) NOT NULL CHECK ("quantity" > 0),
  "price" DECIMAL(36,18) NOT NULL CHECK ("price" > 0),
  "leverage" DECIMAL(18,8) NOT NULL CHECK ("leverage" > 0),
  "marginType" TEXT NOT NULL CHECK ("marginType" IN ('CROSS', 'ISOLATED')),
  "pricing" TEXT NOT NULL CHECK ("pricing" IN ('OBSERVED_BOOK', 'MAKER_MODEL')),
  "status" TEXT NOT NULL DEFAULT 'OBSERVED_ONLY'
    CHECK ("status" = 'OBSERVED_ONLY'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopyFuturesDemoEvent_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "CopyFuturesDemoSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CopyFuturesDemoEvent_subscriptionId_sourceEventId_key"
    UNIQUE ("subscriptionId", "sourceEventId")
);
CREATE INDEX "CopyFuturesDemoEvent_subscriptionId_sourceRevision_idx"
  ON "CopyFuturesDemoEvent"("subscriptionId", "sourceRevision");
