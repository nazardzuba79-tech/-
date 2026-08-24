-- AlterTable: admin-controlled account lock, checked at login (see auth.ts).
ALTER TABLE "User" ADD COLUMN "blockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "blockedReason" TEXT;
