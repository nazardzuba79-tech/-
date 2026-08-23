-- AlterTable: documentNumber is redundant with the uploaded document photo
-- (see kyc.ts) — dropped rather than kept nullable, since nothing reads it.
ALTER TABLE "KycSubmission" DROP COLUMN "documentNumber";
