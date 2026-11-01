-- STE-167 S12B-4: retain validated provider results for exact durable replay.
CREATE TABLE IF NOT EXISTS theme_job_attempt_provider_results (
  attempt_id uuid PRIMARY KEY REFERENCES theme_job_attempts(id) ON DELETE RESTRICT,
  result_json jsonb NOT NULL CHECK (
    octet_length(result_json::text) <= 4194304
  ),
  result_hash varchar(64) NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS theme_job_attempt_provider_results_immutable
  ON theme_job_attempt_provider_results;
CREATE TRIGGER theme_job_attempt_provider_results_immutable
  BEFORE UPDATE OR DELETE ON theme_job_attempt_provider_results
  FOR EACH ROW EXECUTE FUNCTION reject_theme_provider_persistence_mutation();
