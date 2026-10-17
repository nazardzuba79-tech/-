-- Local/disposable migration only until separately released. Never funds cash.
CREATE TABLE "StocksTestAccount" (
  "principalHash" TEXT PRIMARY KEY,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),
  "ledger" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("issuer","subject"),
  CHECK (NOT (("ledger"->'wallets'->'USDT') ? 'cash'))
);
CREATE TABLE "StocksTestReceipt" (
  "principalHash" TEXT NOT NULL REFERENCES "StocksTestAccount"("principalHash") ON DELETE RESTRICT,
  "intentId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("principalHash","intentId")
);
CREATE TABLE "StocksTestAudit" (
  "principalHash" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "sessionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("principalHash","intentId"),
  FOREIGN KEY ("principalHash","intentId") REFERENCES "StocksTestReceipt"("principalHash","intentId") ON DELETE RESTRICT
);
