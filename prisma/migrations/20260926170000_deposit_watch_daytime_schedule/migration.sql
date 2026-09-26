-- Additive: remembers the day's admin-open scan (daytime watcher schedule).
ALTER TABLE "DepositWatchState" ADD COLUMN "lastAdminOpenRunAt" TIMESTAMP(3);
