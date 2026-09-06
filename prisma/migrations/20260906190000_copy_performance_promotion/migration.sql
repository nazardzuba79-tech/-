-- Additive presentation identity + isolated modeled strategy persistence only.
-- No User/account/order/wallet data is created, updated, deleted or copied.
CREATE TABLE "CopyStrategyOwner" (
    "traderId" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopyStrategyOwner_pkey" PRIMARY KEY ("traderId")
);
ALTER TABLE "CopyStrategyOwner" ADD CONSTRAINT "CopyStrategyOwner_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CopyPerformanceScenario" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "stateText" TEXT NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopyPerformanceScenario_pkey" PRIMARY KEY ("id")
);

-- Bind only the owner-confirmed stable ID, only if it exists locally. A new
-- environment legitimately displays initials; never create a customer row.
INSERT INTO "CopyStrategyOwner" ("traderId", "publicName", "ownerUserId", "premium", "updatedAt") VALUES
('VX-001', 'Nazar', (SELECT "id" FROM "User" WHERE "id" = 'f4ad5a72-a371-4be4-a071-ad47d43e88c1'), true, CURRENT_TIMESTAMP),
('VX-KSENIA', 'Ksenia', (SELECT "id" FROM "User" WHERE "id" = 'a2184cdc-c0fc-4892-9141-e493967245fd'), true, CURRENT_TIMESTAMP);
