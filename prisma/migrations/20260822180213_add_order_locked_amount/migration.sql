-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "lockedAmount" DECIMAL(36,18),
ADD COLUMN     "lockedAsset" TEXT;
