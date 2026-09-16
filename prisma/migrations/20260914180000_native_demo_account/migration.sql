CREATE TABLE "NativeDemoAccount" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE NO ACTION,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "NativeDemoRevision" (
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE NO ACTION,
  "revision" INTEGER NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeDemoRevision_pkey" PRIMARY KEY ("userId", "revision")
);
CREATE UNIQUE INDEX "NativeDemoRevision_userId_requestKey_key" ON "NativeDemoRevision"("userId", "requestKey");
CREATE FUNCTION native_demo_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Native demo revisions are immutable';
END;
$$;
CREATE TRIGGER native_demo_revision_immutable BEFORE UPDATE OR DELETE ON "NativeDemoRevision"
FOR EACH ROW EXECUTE FUNCTION native_demo_revision_immutable();
