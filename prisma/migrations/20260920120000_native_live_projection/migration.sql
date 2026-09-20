CREATE TABLE "NativeDemoLiveProjection" (
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "digest" TEXT NOT NULL,
  "executionSession" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NativeDemoLiveProjection_pkey" PRIMARY KEY ("userId")
);
