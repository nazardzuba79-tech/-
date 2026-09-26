-- Keep external financial history and other users' earned referral rewards.
ALTER TABLE "Deposit" ADD COLUMN "deletedUserId" TEXT;
ALTER TABLE "Withdrawal" ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "deletedUserId" TEXT;
ALTER TABLE "Withdrawal" DROP CONSTRAINT "Withdrawal_userId_fkey",
  ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ALTER COLUMN "referrerId" DROP NOT NULL,
  ALTER COLUMN "referredUserId" DROP NOT NULL,
  ADD COLUMN "deletedReferrerId" TEXT, ADD COLUMN "deletedReferredUserId" TEXT;
ALTER TABLE "BankingReferralReward" ALTER COLUMN "referrerId" DROP NOT NULL,
  ALTER COLUMN "referredUserId" DROP NOT NULL,
  ADD COLUMN "deletedReferrerId" TEXT, ADD COLUMN "deletedReferredUserId" TEXT;
ALTER TABLE "ReferralReward" DROP CONSTRAINT "ReferralReward_referrerId_fkey",
  DROP CONSTRAINT "ReferralReward_referredUserId_fkey",
  ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReferralReward_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankingReferralReward" DROP CONSTRAINT "BankingReferralReward_referrerId_fkey",
  DROP CONSTRAINT "BankingReferralReward_referredUserId_fkey",
  ADD CONSTRAINT "BankingReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BankingReferralReward_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission is transaction-local, target-specific, and tied to the exact
-- audit row created by the server after locking/rechecking caller and target.
CREATE FUNCTION admin_account_deletion_allowed(target TEXT) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(target = current_setting('voltex.delete_user', true), false)
    AND EXISTS (
      SELECT 1 FROM "AuditLog" a
      JOIN "User" admin ON admin.id = a.metadata->>'performedByAdminId' AND admin.role = 'ADMIN'
      JOIN "User" victim ON victim.id = target AND victim.role = 'USER'
      WHERE a.id = current_setting('voltex.delete_audit', true)
        AND a.action = 'USER_DELETED' AND a.metadata->>'deletedUserId' = target
        AND admin.id <> victim.id AND lower(trim(victim.email)) <> 'voltex.crypto@gmail.com'
    );
$$;
CREATE OR REPLACE FUNCTION native_demo_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND admin_account_deletion_allowed(OLD."userId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Native demo revisions are immutable';
END;
$$;
CREATE OR REPLACE FUNCTION prevent_banking_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND admin_account_deletion_allowed(OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'banking ledger entries are immutable';
END;
$$;

-- A stale preview, manual attribution, restore or watcher retry cannot
-- reactivate a retained transfer after its account has been deleted.
CREATE FUNCTION retained_account_transfer_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'Transfer belongs to a deleted account; historical record is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retained_deposit_immutable BEFORE UPDATE OR DELETE ON "Deposit"
  FOR EACH ROW EXECUTE FUNCTION retained_account_transfer_immutable();
CREATE TRIGGER retained_withdrawal_immutable BEFORE UPDATE OR DELETE ON "Withdrawal"
  FOR EACH ROW EXECUTE FUNCTION retained_account_transfer_immutable();
