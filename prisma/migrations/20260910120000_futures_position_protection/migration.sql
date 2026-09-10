-- Take Profit / Stop Loss for an already-open perpetual futures position.
--
-- Purely additive. No existing table is altered, no row is created, updated,
-- deleted or copied, and nothing here touches FuturesOrder, FuturesPosition,
-- FuturesBalance, Order, Balance or any spot/CFD/copy-trading table. An
-- account that never sets a TP/SL has no row here and behaves exactly as
-- before.
--
-- The table is deliberately separate from FuturesOrder: FuturesBookTransaction
-- rebuilds the executable futures book from every FuturesOrder row in
-- OPEN | PARTIALLY_FILLED and rejects anything that is not a priced LIMIT, so
-- an armed trigger stored there could never rest safely. Nothing in this table
-- is executable; a trigger becomes an ordinary reduce-only MARKET order only at
-- the moment it fires.
CREATE TABLE "FuturesPositionProtection" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    -- TAKE_PROFIT | STOP_LOSS
    "kind" TEXT NOT NULL,
    "triggerPrice" DECIMAL(36,18) NOT NULL,
    -- PENDING | TRIGGERING | EXECUTED | CANCELLED | FAILED
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "triggeredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FuturesPositionProtection_pkey" PRIMARY KEY ("id")
);

-- At most one Take Profit and one Stop Loss per position. PUT rewrites the row
-- in place rather than inserting a second one, and this pair is what makes the
-- watcher's conditional claim (PENDING/FAILED -> TRIGGERING) enough on its own
-- to stop two ticks executing the same trigger.
CREATE UNIQUE INDEX "FuturesPositionProtection_positionId_kind_key"
    ON "FuturesPositionProtection"("positionId", "kind");

-- The watcher's scan predicate.
CREATE INDEX "FuturesPositionProtection_status_symbol_idx"
    ON "FuturesPositionProtection"("status", "symbol");

CREATE INDEX "FuturesPositionProtection_userId_idx"
    ON "FuturesPositionProtection"("userId");

ALTER TABLE "FuturesPositionProtection" ADD CONSTRAINT "FuturesPositionProtection_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "FuturesPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FuturesPositionProtection" ADD CONSTRAINT "FuturesPositionProtection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
