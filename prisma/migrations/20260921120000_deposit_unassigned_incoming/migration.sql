BEGIN;
-- Preserve verified incoming transfers before their user is identified.
-- The existing (chain, txHash) unique constraint remains the credit identity.
ALTER TABLE "Deposit" ALTER COLUMN "userId" DROP NOT NULL;
-- Canonical hexadecimal identities. If legacy case aliases collide, the
-- existing unique constraint aborts migration for manual reconciliation;
-- never discard one of two previously credited financial records.
UPDATE "Deposit" SET "txHash" = CASE WHEN chain = 'ton' THEN regexp_replace(lower("txHash"), '^0x', '') ELSE lower("txHash") END
WHERE chain <> 'solana';

COMMIT;
