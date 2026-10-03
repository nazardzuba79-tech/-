-- Additive: «Запомнить это устройство». One boolean on Session, default false,
-- so every existing session keeps its current behaviour and the previous
-- release, which never reads the column, keeps working.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "remembered" BOOLEAN NOT NULL DEFAULT false;
