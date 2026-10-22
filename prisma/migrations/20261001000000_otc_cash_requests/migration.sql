-- Additive only. No existing wallet rows are read or changed by this migration.
CREATE TABLE "OtcCashRequest" (
 "id" TEXT PRIMARY KEY, "number" SERIAL NOT NULL UNIQUE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "idempotencyKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "country" TEXT NOT NULL, "cityId" TEXT NOT NULL, "asset" TEXT NOT NULL,
 "quantity" DECIMAL(36,18) NOT NULL CHECK ("quantity" > 0),
 "fiat" TEXT NOT NULL, "tier" TEXT NOT NULL, "policyVersion" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("status" IN ('RESERVED','OFFERED','ACCEPTED','PICKUP_READY','PAYOUT_IN_PROGRESS','COMPLETED','CANCELLED','REJECTED')),
 "version" INTEGER NOT NULL DEFAULT 1, "offerVersion" INTEGER NOT NULL DEFAULT 0,
 "acceptedOfferVersion" INTEGER, "acceptedAt" TIMESTAMP(3),
 "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "pickupRevision" INTEGER NOT NULL DEFAULT 0,
 "payoutReference" TEXT UNIQUE, "completedBy" TEXT, "completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("userId","idempotencyKey")
);
CREATE INDEX "OtcCashRequest_userId_createdAt_id_idx" ON "OtcCashRequest"("userId","createdAt","id");
CREATE INDEX "OtcCashRequest_status_createdAt_id_idx" ON "OtcCashRequest"("status","createdAt","id");
CREATE TABLE "OtcCashReservation" (
 "requestId" TEXT PRIMARY KEY REFERENCES "OtcCashRequest"("id") ON DELETE RESTRICT,
 "asset" TEXT NOT NULL, "quantity" DECIMAL(36,18) NOT NULL CHECK ("quantity" > 0),
 "status" TEXT NOT NULL DEFAULT 'HELD' CHECK ("status" IN ('HELD','RELEASED','CONSUMED')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "settledAt" TIMESTAMP(3)
);
CREATE TABLE "OtcCashOffer" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "OtcCashRequest"("id") ON DELETE RESTRICT,
 "version" INTEGER NOT NULL, "asset" TEXT NOT NULL, "quantity" DECIMAL(36,18) NOT NULL,
 "fiat" TEXT NOT NULL, "rate" DECIMAL(36,18) NOT NULL CHECK ("rate" > 0),
 "gross" DECIMAL(36,18) NOT NULL, "fee" DECIMAL(36,18) NOT NULL CHECK ("fee" >= 0),
 "net" DECIMAL(36,18) NOT NULL CHECK ("net" > 0 AND "net" = "gross" - "fee"),
 "cashPrecision" INTEGER NOT NULL CHECK ("cashPrecision" BETWEEN 0 AND 4),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acceptedAt" TIMESTAMP(3),
 UNIQUE ("requestId","version")
);
CREATE TABLE "OtcCashMessage" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "OtcCashRequest"("id") ON DELETE RESTRICT,
 "authorId" TEXT NOT NULL, "sender" TEXT NOT NULL CHECK ("sender" IN ('USER','ADMIN')),
 "kind" TEXT NOT NULL DEFAULT 'TEXT' CHECK ("kind" IN ('TEXT','PICKUP')),
 "text" TEXT NOT NULL CHECK (length("text") BETWEEN 1 AND 3000),
 "idempotencyKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("requestId","authorId","idempotencyKey")
);
CREATE INDEX "OtcCashMessage_requestId_createdAt_id_idx" ON "OtcCashMessage"("requestId","createdAt","id");
CREATE TABLE "OtcCashCommand" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "OtcCashRequest"("id") ON DELETE RESTRICT,
 "idempotencyKey" TEXT NOT NULL, "actorId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "result" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("requestId","idempotencyKey")
);
CREATE TABLE "OtcCashLedger" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "OtcCashRequest"("id") ON DELETE RESTRICT,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('RESERVE','RELEASE','CONSUME')),
 "asset" TEXT NOT NULL, "quantity" DECIMAL(36,18) NOT NULL CHECK ("quantity" > 0),
 "availableAfter" DECIMAL(36,18) NOT NULL, "lockedAfter" DECIMAL(36,18) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("requestId","kind")
);
