CREATE TABLE banking_placements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  program_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  principal NUMERIC(36,18) NOT NULL CHECK (principal > 0),
  monthly_rate NUMERIC(18,10) NOT NULL CHECK (monthly_rate >= 0),
  term_months INTEGER NOT NULL CHECK (term_months > 0),
  compound BOOLEAN NOT NULL,
  payout_frequency TEXT NOT NULL,
  lock_rule TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  matures_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX banking_placements_user_created_idx ON banking_placements(user_id, created_at DESC);

CREATE TABLE banking_ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  placement_id TEXT REFERENCES banking_placements(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL CHECK (amount >= 0),
  period_index INTEGER,
  effective_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX banking_ledger_user_effective_idx ON banking_ledger_entries(user_id, effective_at DESC);
CREATE UNIQUE INDEX banking_ledger_period_unique
  ON banking_ledger_entries(placement_id, entry_type, period_index)
  WHERE period_index IS NOT NULL;

CREATE TABLE banking_commands (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX banking_commands_user_created_idx ON banking_commands(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_banking_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'banking ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER banking_ledger_no_update BEFORE UPDATE ON banking_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_banking_ledger_mutation();
CREATE TRIGGER banking_ledger_no_delete BEFORE DELETE ON banking_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_banking_ledger_mutation();
