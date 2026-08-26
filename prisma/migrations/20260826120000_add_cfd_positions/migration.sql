-- CFD positions (gold/oil/indices/EUR-USD) — dealer-model, filled
-- instantly against the live Twelve Data mark price rather than matched
-- against other users. Shares the existing FuturesBalance USDT wallet as
-- its margin account. See CfdPosition's schema.prisma doc comment.

CREATE TABLE "CfdPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" DECIMAL(36,18) NOT NULL,
    "entryPrice" DECIMAL(36,18) NOT NULL,
    "leverage" INTEGER NOT NULL,
    "initialMargin" DECIMAL(36,18) NOT NULL,
    "liquidationPrice" DECIMAL(36,18) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfdPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfdPosition_userId_status_idx" ON "CfdPosition"("userId", "status");

CREATE INDEX "CfdPosition_symbol_status_idx" ON "CfdPosition"("symbol", "status");

ALTER TABLE "CfdPosition" ADD CONSTRAINT "CfdPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
