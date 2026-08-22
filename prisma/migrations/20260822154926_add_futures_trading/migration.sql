-- AlterTable
ALTER TABLE "User" ADD COLUMN     "futuresRiskAckAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FuturesBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "available" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "locked" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuturesBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuturesPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" DECIMAL(36,18) NOT NULL,
    "entryPrice" DECIMAL(36,18) NOT NULL,
    "leverage" INTEGER NOT NULL,
    "marginType" TEXT NOT NULL,
    "initialMargin" DECIMAL(36,18) NOT NULL,
    "liquidationPrice" DECIMAL(36,18) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuturesPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingRateRecord" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "markPrice" DECIMAL(36,18) NOT NULL,
    "indexPrice" DECIMAL(36,18) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingRateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingPayment" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceFund" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "balance" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceFundLedger" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "reason" TEXT NOT NULL,
    "positionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceFundLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuturesBalance_userId_idx" ON "FuturesBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FuturesBalance_userId_asset_key" ON "FuturesBalance"("userId", "asset");

-- CreateIndex
CREATE INDEX "FuturesPosition_userId_status_idx" ON "FuturesPosition"("userId", "status");

-- CreateIndex
CREATE INDEX "FuturesPosition_symbol_status_idx" ON "FuturesPosition"("symbol", "status");

-- CreateIndex
CREATE INDEX "FundingRateRecord_symbol_appliedAt_idx" ON "FundingRateRecord"("symbol", "appliedAt");

-- CreateIndex
CREATE INDEX "FundingPayment_positionId_idx" ON "FundingPayment"("positionId");

-- CreateIndex
CREATE INDEX "FundingPayment_userId_idx" ON "FundingPayment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceFund_asset_key" ON "InsuranceFund"("asset");

-- CreateIndex
CREATE INDEX "InsuranceFundLedger_asset_createdAt_idx" ON "InsuranceFundLedger"("asset", "createdAt");

-- AddForeignKey
ALTER TABLE "FuturesBalance" ADD CONSTRAINT "FuturesBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuturesPosition" ADD CONSTRAINT "FuturesPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingPayment" ADD CONSTRAINT "FundingPayment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "FuturesPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
