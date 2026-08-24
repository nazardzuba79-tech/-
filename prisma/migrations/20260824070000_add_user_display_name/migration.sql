-- AlterTable: cosmetic display name shown in the nav instead of the raw
-- email — never used for auth or lookups.
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;

-- Data migration: the one deliberate, manual name assignment for the
-- account owner, same one-off pattern as the ADMIN role assignment in
-- 20260823110000_add_role_treasury_wallet_withdrawal_txhash.
UPDATE "User" SET "displayName" = 'Ксения' WHERE lower("email") = 'voltex.crypto@gmail.com';
