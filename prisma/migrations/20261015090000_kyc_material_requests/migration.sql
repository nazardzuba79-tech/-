-- KYC additional materials (2026-10-15): an admin asks for a new document photo,
-- an ordinary selfie, or both, without rejecting the submission. Additive only:
-- one new table, no change to existing tables, enums or rows. Files are never
-- stored here; they travel through the KYC edge to the admin mailbox.

-- CreateTable
CREATE TABLE "KycMaterialRequest" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "documentReason" TEXT,
    "documentReasonText" TEXT,
    "selfieComment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedBy" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentDeliveryId" TEXT,
    "documentReceivedAt" TIMESTAMP(3),
    "documentMessageId" TEXT,
    "documentMimeType" TEXT,
    "documentSizeBytes" INTEGER,
    "selfieDeliveryId" TEXT,
    "selfieReceivedAt" TIMESTAMP(3),
    "selfieMessageId" TEXT,
    "selfieMimeType" TEXT,
    "selfieSizeBytes" INTEGER,
    "selfieConsentAt" TIMESTAMP(3),
    "selfieConsentVersion" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closedOutcome" TEXT,

    CONSTRAINT "KycMaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KycMaterialRequest_clientRequestId_key" ON "KycMaterialRequest"("clientRequestId");

-- CreateIndex
CREATE INDEX "KycMaterialRequest_submissionId_idx" ON "KycMaterialRequest"("submissionId");

-- CreateIndex
CREATE INDEX "KycMaterialRequest_userId_status_idx" ON "KycMaterialRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "KycMaterialRequest" ADD CONSTRAINT "KycMaterialRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
