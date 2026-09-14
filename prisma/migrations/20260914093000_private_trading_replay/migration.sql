-- Additive, isolated operator simulation tables. No real money tables are altered.
CREATE TABLE "PrivateTradingAccount" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id"),
  "available" DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK ("available" >= 0),
  "reserved" DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK ("reserved" >= 0),
  "principal" DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK ("principal" >= 0),
  "realized" DECIMAL(36,18) NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PrivateTradingLedger" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "eventId" TEXT NOT NULL, "scenarioId" TEXT, "kind" TEXT NOT NULL,
  "amount" DECIMAL(36,18) NOT NULL, "metadata" JSONB NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivateTradingLedger_userId_eventId_key" ON "PrivateTradingLedger"("userId", "eventId");
CREATE INDEX "PrivateTradingLedger_userId_scenarioId_effectiveAt_idx" ON "PrivateTradingLedger"("userId", "scenarioId", "effectiveAt");
CREATE TABLE "PrivateTradingCommand" (
  "userId" TEXT NOT NULL REFERENCES "User"("id"), "key" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "key")
);
CREATE TABLE "PrivateTradingPreview" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "requestKey" TEXT NOT NULL,
  "session" JSONB NOT NULL, "mode" TEXT NOT NULL, "status" TEXT NOT NULL, "request" JSONB NOT NULL,
  "result" JSONB, "progress" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "confirmedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "PrivateTradingPreview_userId_requestKey_key" ON "PrivateTradingPreview"("userId", "requestKey");
CREATE INDEX "PrivateTradingPreview_userId_status_idx" ON "PrivateTradingPreview"("userId", "status");
CREATE TABLE "PrivateTradingCard" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PrivateTradingCard_userId_createdAt_idx" ON "PrivateTradingCard"("userId", "createdAt");
