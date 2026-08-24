-- CreateTable
CREATE TABLE "DemoBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "available" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "locked" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL(36,18),
    "originalQuantity" DECIMAL(36,18) NOT NULL,
    "remainingQuantity" DECIMAL(36,18) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoTrade" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "takerOrderId" TEXT NOT NULL,
    "makerOrderId" TEXT NOT NULL,
    "takerUserId" TEXT NOT NULL,
    "makerUserId" TEXT NOT NULL,
    "price" DECIMAL(36,18) NOT NULL,
    "quantity" DECIMAL(36,18) NOT NULL,
    "side" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoBalance_userId_asset_key" ON "DemoBalance"("userId", "asset");

-- CreateIndex
CREATE INDEX "DemoBalance_userId_idx" ON "DemoBalance"("userId");

-- CreateIndex
CREATE INDEX "DemoOrder_userId_idx" ON "DemoOrder"("userId");

-- CreateIndex
CREATE INDEX "DemoOrder_pair_status_idx" ON "DemoOrder"("pair", "status");

-- CreateIndex
CREATE INDEX "DemoTrade_pair_executedAt_idx" ON "DemoTrade"("pair", "executedAt");

-- AddForeignKey
ALTER TABLE "DemoBalance" ADD CONSTRAINT "DemoBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoOrder" ADD CONSTRAINT "DemoOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: seed the requested demo balances for the account owner
-- (voltex.crypto@gmail.com) — 272 BTC and 7,000,000 USDT, so the sandbox is
-- ready to trade with immediately after this deploys, no manual admin-panel
-- step required first.
INSERT INTO "DemoBalance" ("id", "userId", "asset", "available", "locked", "updatedAt")
SELECT '74fe0af6-204f-439b-a03e-a92052e366e8', "id", 'BTC', 272, 0, CURRENT_TIMESTAMP
FROM "User" WHERE lower("email") = 'voltex.crypto@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO "DemoBalance" ("id", "userId", "asset", "available", "locked", "updatedAt")
SELECT '1ff8704a-a4c9-4c91-b419-68658261d25f', "id", 'USDT', 7000000, 0, CURRENT_TIMESTAMP
FROM "User" WHERE lower("email") = 'voltex.crypto@gmail.com'
ON CONFLICT DO NOTHING;
