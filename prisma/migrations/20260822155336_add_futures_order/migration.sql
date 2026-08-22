-- CreateTable
CREATE TABLE "FuturesOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL(36,18),
    "originalQuantity" DECIMAL(36,18) NOT NULL,
    "remainingQuantity" DECIMAL(36,18) NOT NULL,
    "status" TEXT NOT NULL,
    "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuturesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuturesOrder_userId_idx" ON "FuturesOrder"("userId");

-- CreateIndex
CREATE INDEX "FuturesOrder_symbol_status_idx" ON "FuturesOrder"("symbol", "status");

-- AddForeignKey
ALTER TABLE "FuturesOrder" ADD CONSTRAINT "FuturesOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
