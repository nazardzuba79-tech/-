-- KYC documents move to the Cloudflare KYC edge (browser -> Worker -> admin
-- email). Additive and backward-compatible: existing rows keep their
-- documentImagePath; new rows leave it NULL. Nothing is dropped.
ALTER TABLE "KycSubmission" ALTER COLUMN "documentImagePath" DROP NOT NULL;
ALTER TABLE "KycSubmission" ADD COLUMN "documentDelivery" TEXT;
ALTER TABLE "KycSubmission" ADD COLUMN "emailMessageId" TEXT;
ALTER TABLE "KycSubmission" ADD COLUMN "emailAcceptedAt" TIMESTAMP(3);
ALTER TABLE "KycSubmission" ADD COLUMN "documentMimeType" TEXT;
ALTER TABLE "KycSubmission" ADD COLUMN "documentSizeBytes" INTEGER;
