-- Additive. Every existing request held its amount in the spot balance, so
-- they all keep `true`; only new requests from Cross trading accounts write
-- `false` (see WithdrawalService.requestUnheldWithdrawal).
ALTER TABLE "Withdrawal" ADD COLUMN "balanceHeld" BOOLEAN NOT NULL DEFAULT true;
