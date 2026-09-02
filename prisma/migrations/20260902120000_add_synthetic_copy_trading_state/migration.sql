CREATE TABLE "SyntheticCopyTradingState" (
    "id" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyntheticCopyTradingState_pkey" PRIMARY KEY ("id")
);
