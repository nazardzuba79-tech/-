-- Email verification for new registrations.
--
-- MIGRATION SAFETY: every account that already exists predates this feature
-- and has no way to have verified anything. The backfill below sets their
-- emailVerifiedAt to their own createdAt, so they stay exactly as able to
-- log in as they were a minute before this ran. Only rows inserted after
-- this migration start life with emailVerifiedAt = NULL and therefore need
-- to pass the six-digit check before /auth/login will issue them a session.

-- 1. The column starts NULL for everyone...
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- 2. ...and is immediately backfilled for existing rows only. New inserts
--    from the application default to NULL because Prisma sends no value.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- 3. One live challenge per user; the code itself is never stored, only an
--    HMAC keyed by EMAIL_VERIFICATION_SECRET (see the Prisma model docs).
CREATE TABLE "EmailVerificationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerificationChallenge_userId_idx" ON "EmailVerificationChallenge"("userId");
CREATE INDEX "EmailVerificationChallenge_expiresAt_idx" ON "EmailVerificationChallenge"("expiresAt");

ALTER TABLE "EmailVerificationChallenge"
    ADD CONSTRAINT "EmailVerificationChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
