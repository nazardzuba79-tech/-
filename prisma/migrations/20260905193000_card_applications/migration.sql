-- Additive only: preserve historical cardWaitlistJoinedAt values unchanged.
CREATE TYPE "CardProduct" AS ENUM ('TITANIUM', 'BLACK_SIGNATURE');
CREATE TYPE "CardApplicationStatus" AS ENUM ('SUBMITTED');

CREATE TABLE "CardApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" "CardProduct" NOT NULL,
    "status" "CardApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligibilitySnapshot" JSONB NOT NULL,
    CONSTRAINT "CardApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardApplication_userId_key" ON "CardApplication"("userId");
ALTER TABLE "CardApplication" ADD CONSTRAINT "CardApplication_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Eligibility reads each account's complete executed history on either side.
CREATE INDEX "Trade_takerUserId_idx" ON "Trade"("takerUserId");
CREATE INDEX "Trade_makerUserId_idx" ON "Trade"("makerUserId");
