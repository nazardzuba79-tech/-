-- PREPARED ONLY. Run against production only after separate owner approval.
-- Applies exactly one reviewed migration; never runs pending repository migrations.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE n integer; tracked integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(641640) THEN RAISE EXCEPTION 'Another social migration is running'; END IF;
  IF current_setting('server_version_num')::integer <> 180006 THEN RAISE EXCEPTION 'Expected PostgreSQL 18.6'; END IF;
  SELECT count(*) INTO tracked FROM public."_prisma_migrations" WHERE migration_name='20261029150000_copy_strategy_socials';
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema='public' AND table_name='CopyStrategyOwner' AND column_name IN ('xUrl','telegramUrl','socialOwnerUserId');
  IF tracked=1 AND n=3 THEN
    IF NOT EXISTS (SELECT 1 FROM public."_prisma_migrations" WHERE migration_name='20261029150000_copy_strategy_socials' AND checksum='6b22197bac2fb548c3f473532949f26772f35b613fe060208ca83504f9b63569' AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1) THEN RAISE EXCEPTION 'Migration receipt mismatch'; END IF;
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='CopyStrategyOwner' AND column_name IN ('xUrl','telegramUrl','socialOwnerUserId') AND data_type='text' AND is_nullable='YES' AND column_default IS NULL)<>3 THEN RAISE EXCEPTION 'Unexpected social column shape'; END IF;
  ELSIF tracked=0 AND n=0 THEN
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='CopyStrategyOwner' AND column_name IN ('traderId','publicName','ownerUserId','premium','updatedAt'))<>5 THEN RAISE EXCEPTION 'Production owner table changed'; END IF;
    -- Additive, nullable strategy-only fields. Apply before releasing the new API.
ALTER TABLE "CopyStrategyOwner"
  ADD COLUMN "xUrl" TEXT,
  ADD COLUMN "telegramUrl" TEXT,
  ADD COLUMN "socialOwnerUserId" TEXT;
-- A changed owner binding must never inherit the former owner's links.
    INSERT INTO public."_prisma_migrations" (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
    VALUES (gen_random_uuid()::text,'6b22197bac2fb548c3f473532949f26772f35b613fe060208ca83504f9b63569',now(),'20261029150000_copy_strategy_socials',NULL,NULL,now(),1);
  ELSE RAISE EXCEPTION 'Partial or untracked migration state: stop for review'; END IF;
END $guard$;
COMMIT;
