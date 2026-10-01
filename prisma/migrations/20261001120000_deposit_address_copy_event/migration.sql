-- Additive: one new table for «Копировали адрес». No existing table, row or
-- financial column changes; the previous release ignores this table.

-- CreateTable
CREATE TABLE "DepositAddressCopyEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "destinationId" TEXT,
    "addressSnapshot" TEXT NOT NULL,
    "memoSnapshot" TEXT,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientCopiedAt" TIMESTAMP(3),

    CONSTRAINT "DepositAddressCopyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepositAddressCopyEvent_receivedAt_id_idx" ON "DepositAddressCopyEvent"("receivedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "DepositAddressCopyEvent_userId_receivedAt_idx" ON "DepositAddressCopyEvent"("userId", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddressCopyEvent_userId_eventId_key" ON "DepositAddressCopyEvent"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "DepositAddressCopyEvent" ADD CONSTRAINT "DepositAddressCopyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
