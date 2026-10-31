-- STE-25 S12B-3: persist provider metadata and the first semantic batch before dispatch.
CREATE TABLE IF NOT EXISTS theme_job_attempt_provider_metadata (
  attempt_id uuid PRIMARY KEY REFERENCES theme_job_attempts(id) ON DELETE RESTRICT,
  provider_request_id varchar(255) CHECK (
    provider_request_id IS NULL OR length(btrim(provider_request_id)) > 0
  ),
  returned_model varchar(255) CHECK (
    returned_model IS NULL OR length(btrim(returned_model)) > 0
  ),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_semantic_adjudication_batches (
  candidate_id uuid PRIMARY KEY,
  candidate_content_hash varchar(64) NOT NULL CHECK (candidate_content_hash ~ '^[a-f0-9]{64}$'),
  semantic_policy_fingerprint varchar(64) NOT NULL CHECK (semantic_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  pair_snapshot jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(pair_snapshot) = 'array'
      THEN jsonb_array_length(pair_snapshot) <= 4
        AND octet_length(pair_snapshot::text) <= 262144
      ELSE false
    END
  ),
  pair_fingerprint varchar(64) NOT NULL CHECK (pair_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_semantic_batch_candidate_content
    FOREIGN KEY (candidate_id, candidate_content_hash)
    REFERENCES theme_candidates(id, content_hash)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_theme_provider_persistence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'theme provider persistence records are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_job_attempt_provider_metadata_immutable ON theme_job_attempt_provider_metadata;
CREATE TRIGGER theme_job_attempt_provider_metadata_immutable
  BEFORE UPDATE OR DELETE ON theme_job_attempt_provider_metadata
  FOR EACH ROW EXECUTE FUNCTION reject_theme_provider_persistence_mutation();

DROP TRIGGER IF EXISTS theme_semantic_adjudication_batches_immutable ON theme_semantic_adjudication_batches;
CREATE TRIGGER theme_semantic_adjudication_batches_immutable
  BEFORE UPDATE OR DELETE ON theme_semantic_adjudication_batches
  FOR EACH ROW EXECUTE FUNCTION reject_theme_provider_persistence_mutation();
