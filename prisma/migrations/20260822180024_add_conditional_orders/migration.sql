-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "ocoGroupId" TEXT,
ADD COLUMN     "triggerPrice" DECIMAL(36,18);

-- CreateIndex
CREATE INDEX "Order_ocoGroupId_idx" ON "Order"("ocoGroupId");
