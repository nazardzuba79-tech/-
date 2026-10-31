-- Additive, nullable strategy-only fields. Apply before releasing the new API.
ALTER TABLE "CopyStrategyOwner"
  ADD COLUMN "xUrl" TEXT,
  ADD COLUMN "telegramUrl" TEXT,
  ADD COLUMN "socialOwnerUserId" TEXT;
-- A changed owner binding must never inherit the former owner's links.
