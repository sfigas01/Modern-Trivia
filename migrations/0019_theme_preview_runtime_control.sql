-- STE-25 S12A: persist the exact preview runtime plan on its preparation job
-- and provide one durable, disabled-by-default runtime kill switch.
ALTER TABLE theme_preparation_jobs
  ADD COLUMN IF NOT EXISTS plan_version varchar(64),
  ADD COLUMN IF NOT EXISTS plan_hash varchar(64),
  ADD COLUMN IF NOT EXISTS plan_json jsonb,
  ADD COLUMN IF NOT EXISTS plan_hold_until timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'theme_preparation_jobs_plan_complete'
      AND conrelid = 'theme_preparation_jobs'::regclass
  ) THEN
    ALTER TABLE theme_preparation_jobs ADD CONSTRAINT theme_preparation_jobs_plan_complete
      CHECK (
        (plan_version IS NULL AND plan_hash IS NULL AND plan_json IS NULL AND plan_hold_until IS NULL)
        OR
        (plan_version IS NOT NULL AND plan_hash IS NOT NULL AND plan_json IS NOT NULL AND plan_hold_until IS NOT NULL)
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'theme_preparation_jobs_plan_values'
      AND conrelid = 'theme_preparation_jobs'::regclass
  ) THEN
    ALTER TABLE theme_preparation_jobs ADD CONSTRAINT theme_preparation_jobs_plan_values
      CHECK (
        plan_version IS NULL OR
        (length(trim(plan_version)) > 0 AND plan_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(plan_json) = 'object')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_theme_preparation_job_plan() RETURNS trigger AS $$
BEGIN
  IF OLD.plan_version IS NOT NULL AND (
    OLD.plan_version IS DISTINCT FROM NEW.plan_version
    OR OLD.plan_hash IS DISTINCT FROM NEW.plan_hash
    OR OLD.plan_json IS DISTINCT FROM NEW.plan_json
    OR OLD.plan_hold_until IS DISTINCT FROM NEW.plan_hold_until
  ) THEN
    RAISE EXCEPTION 'theme preparation job plan is immutable once populated' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_preparation_jobs_plan_immutable ON theme_preparation_jobs;
CREATE TRIGGER theme_preparation_jobs_plan_immutable
  BEFORE UPDATE ON theme_preparation_jobs
  FOR EACH ROW EXECUTE FUNCTION protect_theme_preparation_job_plan();

CREATE TABLE IF NOT EXISTS theme_runtime_control (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_runtime_control_singleton CHECK (singleton_id = 1)
);

INSERT INTO theme_runtime_control (singleton_id, enabled)
VALUES (1, false)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION protect_theme_runtime_control_singleton() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'theme runtime control singleton cannot be deleted' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_runtime_control_no_delete ON theme_runtime_control;
CREATE TRIGGER theme_runtime_control_no_delete
  BEFORE DELETE ON theme_runtime_control
  FOR EACH ROW EXECUTE FUNCTION protect_theme_runtime_control_singleton();
