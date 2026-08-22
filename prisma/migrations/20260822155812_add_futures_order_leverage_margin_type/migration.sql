/*
  Warnings:

  - Added the required column `leverage` to the `FuturesOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `marginType` to the `FuturesOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FuturesOrder" ADD COLUMN     "leverage" INTEGER NOT NULL,
ADD COLUMN     "marginType" TEXT NOT NULL;
