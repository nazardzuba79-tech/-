-- Add public aliases only. Never rewrite legacy codes, referredById or money.
BEGIN;
ALTER TABLE "User" ADD COLUMN "referralShortCode" TEXT;
CREATE UNIQUE INDEX "User_referralShortCode_key" ON "User" ("referralShortCode");
ALTER TABLE "User" ADD CONSTRAINT "User_referralShortCode_format"
  CHECK ("referralShortCode" IS NULL OR "referralShortCode" ~ '^[A-Z0-9]{5}$');

-- Codes are public identifiers, not authentication secrets. The unique index
-- is authoritative when concurrent registrations choose the same candidate.
CREATE FUNCTION voltex_referral_short_code(preferred TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  candidate TEXT;
  attempt INTEGER;
  i INTEGER;
BEGIN
  FOR attempt IN 0..999 LOOP
    candidate := CASE WHEN attempt = 0 THEN upper(preferred) ELSE NULL END;
    IF candidate IS NULL OR candidate !~ '^[A-Z0-9]{5}$' THEN
      candidate := '';
      FOR i IN 1..5 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * 36)::integer, 1);
      END LOOP;
    END IF;
    -- React Router is case-insensitive. Do not shadow application paths or
    -- existing legacy codes (including unusually short historical codes).
    IF candidate <> ALL(ARRAY['LOGIN','TRADE','TOOLS','LEGAL','ADMIN','ABOUT','TERMS'])
      AND NOT EXISTS (SELECT 1 FROM "User" WHERE "referralShortCode" = candidate)
      AND NOT EXISTS (SELECT 1 FROM "User" WHERE "referralCode" = candidate)
    THEN RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Unable to allocate a unique referral alias';
END;
$$;

-- Stable order makes shared prefixes deterministic; collisions get another
-- unique alias, never another user's referrer. UPDATE visits each user once.
DO $$
DECLARE account RECORD;
BEGIN
  FOR account IN SELECT id, "referralCode" FROM "User" ORDER BY id LOOP
    UPDATE "User" SET "referralShortCode" = voltex_referral_short_code(left(account."referralCode", 5))
      WHERE id = account.id;
  END LOOP;
END;
$$;
ALTER TABLE "User" ALTER COLUMN "referralShortCode" SET DEFAULT voltex_referral_short_code();
COMMIT;
