-- Native demo funding versions. Additive: one new table, nothing else touched.
CREATE TABLE "NativeFundingModel" (
    "version" TEXT NOT NULL,
    "longCashflow" TEXT NOT NULL,
    "shortCashflow" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeFundingModel_pkey" PRIMARY KEY ("version")
);

-- A pinned version is immutable: changing its rates or start would re-price
-- settlements that were already made. Different rates are a new version.
CREATE FUNCTION "native_funding_model_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'NativeFundingModel rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "native_funding_model_no_update"
  BEFORE UPDATE OR DELETE ON "NativeFundingModel"
  FOR EACH ROW EXECUTE FUNCTION "native_funding_model_immutable"();
