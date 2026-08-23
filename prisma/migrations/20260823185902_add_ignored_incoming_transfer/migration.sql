-- CreateTable
CREATE TABLE "IgnoredIncomingTransfer" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredIncomingTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredIncomingTransfer_chain_txHash_key" ON "IgnoredIncomingTransfer"("chain", "txHash");
