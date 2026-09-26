-- Additive only: no existing row, balance or credited deposit is rewritten.
-- Accumulated deposit packages with manual batch approval, client TXID claims
-- as hints only, treasury address history and a durable watcher cursor.
BEGIN;

ALTER TABLE "Deposit"
  ADD COLUMN "recipientAddress" TEXT,
  ADD COLUMN "blockNumber" BIGINT,
  ADD COLUMN "blockTimestamp" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "finalized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "verifyError" TEXT,
  ADD COLUMN "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastVerifyAttemptAt" TIMESTAMP(3),
  ADD COLUMN "source" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "creditedAt" TIMESTAMP(3),
  ADD COLUMN "batchId" TEXT;

CREATE TABLE "DepositBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "totalAmount" DECIMAL(36,18) NOT NULL,
    "depositCount" INTEGER NOT NULL,
    "usdValue" DECIMAL(36,18) NOT NULL,
    "usdPolicy" TEXT NOT NULL,
    "priceUsd" DECIMAL(36,18),
    "pricedAt" TIMESTAMP(3),
    "approvedByAdminId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepositBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DepositClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepositClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreasuryAddressHistory" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreasuryAddressHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DepositWatchCursor" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "scannedThroughMs" BIGINT NOT NULL,
    "windowStartMs" BIGINT,
    "windowEndMs" BIGINT,
    "pageCursor" TEXT,
    "pagesInWindow" INTEGER NOT NULL DEFAULT 0,
    "lastPageAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DepositWatchCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DepositWatchState" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastRunStartedAt" TIMESTAMP(3),
    "lastRunFinishedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lastRunTrigger" TEXT,
    "lastScheduledRunAt" TIMESTAMP(3),
    "lastRunSummary" JSONB,
    "providerStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DepositWatchState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepositBatch_idempotencyKey_key" ON "DepositBatch"("idempotencyKey");
CREATE INDEX "DepositBatch_userId_idx" ON "DepositBatch"("userId");
CREATE INDEX "DepositClaim_chain_txHash_idx" ON "DepositClaim"("chain", "txHash");
CREATE UNIQUE INDEX "DepositClaim_userId_chain_txHash_key" ON "DepositClaim"("userId", "chain", "txHash");
CREATE UNIQUE INDEX "TreasuryAddressHistory_chain_address_key" ON "TreasuryAddressHistory"("chain", "address");
CREATE UNIQUE INDEX "DepositWatchCursor_chain_address_contract_key" ON "DepositWatchCursor"("chain", "address", "contract");
CREATE INDEX "Deposit_status_userId_chain_asset_idx" ON "Deposit"("status", "userId", "chain", "asset");
CREATE INDEX "Deposit_batchId_idx" ON "Deposit"("batchId");

ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DepositBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
