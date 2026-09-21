-- Banking referral commissions.
--
-- Hand-written, like 20260914170000_banking_earn_ledger, because the banking_*
-- tables exist only as raw DDL and are absent from schema.prisma: letting
-- `prisma migrate dev` diff the schema against the migrated state would emit
-- DROP TABLE for all three. Apply this with `prisma migrate deploy`, which does
-- not diff, exactly as the Dockerfile and both CI workflows already do.
--
-- The table itself IS a Prisma model, so its types follow the Prisma family
-- (TIMESTAMP(3), DECIMAL) rather than the banking family (TIMESTAMPTZ, NUMERIC).
-- It is a sibling of "ReferralReward", not of banking_ledger_entries, and it is
-- only ever read and written through Prisma Client.

CREATE TABLE "BankingReferralReward" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "bankingRewardLedgerEntryId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "sourceProfitAmount" DECIMAL(36,18) NOT NULL,
    "commissionRate" DECIMAL(18,10) NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankingReferralReward_pkey" PRIMARY KEY ("id")
);

-- THE exactly-once guarantee. One settled Banking reward funds at most one
-- commission — under retry, under concurrent settlement, across a restart.
-- Everything else in the settlement path is a convenience; this is the rule.
CREATE UNIQUE INDEX "BankingReferralReward_bankingRewardLedgerEntryId_key"
    ON "BankingReferralReward"("bankingRewardLedgerEntryId");

CREATE INDEX "BankingReferralReward_referrerId_idx" ON "BankingReferralReward"("referrerId");
CREATE INDEX "BankingReferralReward_referredUserId_idx" ON "BankingReferralReward"("referredUserId");
CREATE INDEX "BankingReferralReward_placementId_idx" ON "BankingReferralReward"("placementId");

-- Self-referral cannot be represented at all, not merely rejected in code.
-- Registration already refuses to bind a user to themselves; this is the
-- second lock on the same door, on the side where the money moves.
ALTER TABLE "BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_not_self" CHECK ("referrerId" <> "referredUserId");

-- Commission arithmetic must stay checkable from the row alone.
ALTER TABLE "BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_source_positive" CHECK ("sourceProfitAmount" > 0);

ALTER TABLE "BankingReferralReward" ADD CONSTRAINT "BankingReferralReward_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankingReferralReward" ADD CONSTRAINT "BankingReferralReward_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A paid-out Banking reward is a distinct ledger fact from an accrued one, and
-- it reuses banking_ledger_period_unique — the existing partial unique index on
-- (placement_id, entry_type, period_index) WHERE period_index IS NOT NULL — so
-- 'REWARD_PAID' for a given placement and period can be inserted exactly once
-- without any new index. No DDL is needed here; this comment records the
-- dependency so the index is not "tidied up" later.
