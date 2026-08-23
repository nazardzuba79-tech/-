-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable: add "role", defaulting everyone to USER
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';

-- Data migration: preserve whatever the old isAdmin boolean already granted,
-- then apply the one explicit admin-by-email assignment this deployment
-- requires. Both run BEFORE the column is dropped, so nothing is lost.
UPDATE "User" SET "role" = 'ADMIN' WHERE "isAdmin" = true;
UPDATE "User" SET "role" = 'ADMIN' WHERE lower("email") = 'voltex.crypto@gmail.com';

-- AlterTable: isAdmin is superseded by "role" — single source of truth from
-- here on (see requireAdmin middleware).
ALTER TABLE "User" DROP COLUMN "isAdmin";

-- AlterTable: Withdrawal gains an optional txHash for the APPROVED -> SENT step.
ALTER TABLE "Withdrawal" ADD COLUMN "txHash" TEXT;

-- CreateTable
CREATE TABLE "TreasuryWallet" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryWallet_chain_key" ON "TreasuryWallet"("chain");
