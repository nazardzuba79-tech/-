CREATE TABLE "AdminPasswordVault" (
    "userId" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPasswordVault_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "AdminPasswordVault"
ADD CONSTRAINT "AdminPasswordVault_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
