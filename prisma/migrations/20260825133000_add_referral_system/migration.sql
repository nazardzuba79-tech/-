-- Referral system: every user gets a referralCode (their shareable /r/:code
-- link), and referredById records who referred them (set once, only at
-- registration). ReferralReward logs each 5%-of-deposit payout — see
-- DepositService.claimDeposit and the model's own doc comment.

-- Added nullable first because this table already has real rows with no
-- code yet — backfilled below, then locked down to NOT NULL + UNIQUE.
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referredById" TEXT;

-- Deterministic per-row backfill: md5(id) is effectively unique across any
-- realistic user count since id is already a UUID, so this can't collide
-- with itself — the UNIQUE constraint added below is the real guarantee,
-- this just gives every pre-existing account a real code instead of NULL.
UPDATE "User" SET "referralCode" = upper(substr(md5("id"), 1, 8)) WHERE "referralCode" IS NULL;

ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReferralReward" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "amount" DECIMAL(36,18) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralReward_depositId_key" ON "ReferralReward"("depositId");
CREATE INDEX "ReferralReward_referrerId_idx" ON "ReferralReward"("referrerId");

ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_depositId_fkey"
  FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
