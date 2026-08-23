/*
  Warnings:

  - You are about to drop the column `approvedBy` on the `Withdrawal` table. All the data in the column will be lost.
  - You are about to drop the column `chain` on the `Withdrawal` table. All the data in the column will be lost.
  - You are about to drop the column `fee` on the `Withdrawal` table. All the data in the column will be lost.
  - You are about to drop the column `txHash` on the `Withdrawal` table. All the data in the column will be lost.
  - Added the required column `network` to the `Withdrawal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Withdrawal" DROP COLUMN "approvedBy",
DROP COLUMN "chain",
DROP COLUMN "fee",
DROP COLUMN "txHash",
ADD COLUMN     "network" TEXT NOT NULL,
ADD COLUMN     "performedByAdminId" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
