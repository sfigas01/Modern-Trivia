-- STE-25 S11B: durable, account-bound dispatch accounting. Existing rows are
-- retained; NULL policy/owner/fingerprint values on legacy rows fail closed in
-- the gateway rather than inventing historical limits or ownership.
ALTER TABLE theme_daily_budgets
  ADD COLUMN IF NOT EXISTS account_daily_limit_micros integer,
  ADD COLUMN IF NOT EXISTS account_rolling_limit_micros integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_daily_budgets_account_limits') THEN
    ALTER TABLE theme_daily_budgets ADD CONSTRAINT theme_daily_budgets_account_limits
      CHECK (account_daily_limit_micros >= 0 AND account_rolling_limit_micros >= 0);
  END IF;
END $$;

ALTER TABLE theme_budget_allocations
  ADD COLUMN IF NOT EXISTS owner_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS policy_fingerprint varchar(64);
ALTER TABLE theme_job_attempts
  ADD COLUMN IF NOT EXISTS request_fingerprint varchar(64);

ALTER TABLE theme_budget_allocations DROP CONSTRAINT IF EXISTS theme_budget_allocations_job_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_budget_allocations_policy_fingerprint') THEN
    ALTER TABLE theme_budget_allocations ADD CONSTRAINT theme_budget_allocations_policy_fingerprint
      CHECK (policy_fingerprint IS NULL OR policy_fingerprint ~ '^[a-f0-9]{64}$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_theme_budget_allocations_job_restrict') THEN
    ALTER TABLE theme_budget_allocations ADD CONSTRAINT fk_theme_budget_allocations_job_restrict
      FOREIGN KEY (job_id) REFERENCES theme_preparation_jobs(id) ON DELETE RESTRICT;
  END IF;
END $$;
ALTER TABLE theme_job_attempts DROP CONSTRAINT IF EXISTS theme_job_attempts_job_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_theme_job_attempts_job_restrict') THEN
    ALTER TABLE theme_job_attempts ADD CONSTRAINT fk_theme_job_attempts_job_restrict
      FOREIGN KEY (job_id) REFERENCES theme_preparation_jobs(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE theme_budget_allocations DROP CONSTRAINT IF EXISTS theme_budget_allocations_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_budget_allocations_status') THEN
    ALTER TABLE theme_budget_allocations ADD CONSTRAINT theme_budget_allocations_status
      CHECK (status IN ('reserved', 'partially_settled', 'settled', 'released', 'expired', 'unknown'));
  END IF;
END $$;
ALTER TABLE theme_budget_allocations DROP CONSTRAINT IF EXISTS theme_budget_allocations_amounts;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_budget_allocations_amounts') THEN
    ALTER TABLE theme_budget_allocations ADD CONSTRAINT theme_budget_allocations_amounts
      CHECK (reserved_micros >= 0 AND settled_micros >= 0);
  END IF;
END $$;
ALTER TABLE theme_job_attempts DROP CONSTRAINT IF EXISTS theme_job_attempts_accounting;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_job_attempts_accounting') THEN
    ALTER TABLE theme_job_attempts ADD CONSTRAINT theme_job_attempts_accounting
      CHECK (sequence > 0 AND candidate_slots_consumed BETWEEN 0 AND 100
        AND reserved_cost_micros >= 0 AND actual_cost_micros >= 0
        AND (input_tokens IS NULL OR input_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_job_attempts_request_fingerprint') THEN
    ALTER TABLE theme_job_attempts ADD CONSTRAINT theme_job_attempts_request_fingerprint
      CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[a-f0-9]{64}$');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_job_attempts_allocation
  ON theme_job_attempts(allocation_id) WHERE allocation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_theme_budget_allocations_owner_created
  ON theme_budget_allocations(owner_user_id, created_at);

-- Reconciliation is append-only. It acknowledges an investigated overrun
-- without rewriting the charge or its immutable provider attempt.
CREATE TABLE IF NOT EXISTS theme_budget_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL UNIQUE REFERENCES theme_budget_allocations(id) ON DELETE RESTRICT,
  decision varchar(24) NOT NULL CHECK (decision = 'overrun_acknowledged'),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION protect_theme_budget_reconciliation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'theme budget reconciliations are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS theme_budget_reconciliation_append_only ON theme_budget_reconciliations;
CREATE TRIGGER theme_budget_reconciliation_append_only
  BEFORE UPDATE OR DELETE ON theme_budget_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_theme_budget_reconciliation();

CREATE OR REPLACE FUNCTION protect_theme_budget_allocation_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.budget_date IS DISTINCT FROM NEW.budget_date
    OR OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
    OR OLD.policy_fingerprint IS DISTINCT FROM NEW.policy_fingerprint
    OR OLD.reserved_micros IS DISTINCT FROM NEW.reserved_micros
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
    RAISE EXCEPTION 'theme budget allocation identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('settled','released','expired') AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'settled theme budget allocation is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS theme_budget_allocation_identity_immutable ON theme_budget_allocations;
CREATE TRIGGER theme_budget_allocation_identity_immutable
  BEFORE UPDATE ON theme_budget_allocations
  FOR EACH ROW EXECUTE FUNCTION protect_theme_budget_allocation_identity();

CREATE OR REPLACE FUNCTION protect_theme_job_attempt_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.allocation_id IS DISTINCT FROM NEW.allocation_id
    OR OLD.sequence IS DISTINCT FROM NEW.sequence
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.model IS DISTINCT FROM NEW.model
    OR OLD.provider_request_key IS DISTINCT FROM NEW.provider_request_key
    OR OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint
    OR OLD.candidate_slots_consumed IS DISTINCT FROM NEW.candidate_slots_consumed
    OR OLD.reserved_cost_micros IS DISTINCT FROM NEW.reserved_cost_micros
    OR OLD.dispatched_at IS DISTINCT FROM NEW.dispatched_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'theme job attempt identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('succeeded','failed','canceled') AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'settled theme job attempt is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS theme_job_attempt_identity_immutable ON theme_job_attempts;
CREATE TRIGGER theme_job_attempt_identity_immutable
  BEFORE UPDATE ON theme_job_attempts
  FOR EACH ROW EXECUTE FUNCTION protect_theme_job_attempt_identity();
