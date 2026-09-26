-- CreateEnum
CREATE TYPE "SupportNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "SupportConversation" ADD COLUMN     "unreadByAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "SupportNotification" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT,
    "status" "SupportNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCategory" TEXT,
    "failureCode" INTEGER,
    "claimedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportNotification_messageId_key" ON "SupportNotification"("messageId");

-- CreateIndex
CREATE INDEX "SupportNotification_status_nextAttemptAt_idx" ON "SupportNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SupportNotification_conversationId_idx" ON "SupportNotification"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_externalId_key" ON "SupportMessage"("externalId");

-- AddForeignKey
ALTER TABLE "SupportNotification" ADD CONSTRAINT "SupportNotification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNotification" ADD CONSTRAINT "SupportNotification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
