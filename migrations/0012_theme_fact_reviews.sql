-- STE-25 S6b: immutable, independent review attempts and terminal outcomes.
-- The composite index is safe when drizzle-kit push already created it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_fact_derivation_outcome_review_binding
  ON theme_fact_derivation_outcomes (attempt_id, fact_revision_id, fact_content_hash);

CREATE TABLE IF NOT EXISTS theme_fact_review_attempts (
  id uuid PRIMARY KEY,
  contract_version varchar(64) NOT NULL
    CHECK (contract_version = 'theme-fact-review-v1'),
  derivation_attempt_id uuid NOT NULL,
  fact_revision_id uuid NOT NULL,
  fact_content_hash varchar(64) NOT NULL CHECK (fact_content_hash ~ '^[a-f0-9]{64}$'),
  review_sequence integer NOT NULL CHECK (review_sequence > 0),
  review_policy_version varchar(255) NOT NULL,
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  policy_hash varchar(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  prompt_version varchar(255) NOT NULL,
  prompt_hash varchar(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_fingerprint varchar(64) NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  reviewer_kind varchar(16) NOT NULL CHECK (reviewer_kind IN ('model', 'human')),
  reviewer_id varchar(255) NOT NULL,
  provider varchar(255),
  model varchar(255),
  execution_id uuid NOT NULL UNIQUE,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_fact_review_attempt_revision_sequence
    UNIQUE (fact_revision_id, review_sequence),
  CONSTRAINT uq_theme_fact_review_attempt_id_revision_hash
    UNIQUE (id, fact_revision_id, fact_content_hash),
  CONSTRAINT fk_theme_fact_review_derivation_outcome_binding
    FOREIGN KEY (derivation_attempt_id, fact_revision_id, fact_content_hash)
    REFERENCES theme_fact_derivation_outcomes (attempt_id, fact_revision_id, fact_content_hash)
    ON DELETE RESTRICT,
  CONSTRAINT fk_theme_fact_review_revision_hash
    FOREIGN KEY (fact_revision_id, fact_content_hash)
    REFERENCES theme_fact_revisions (id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_fact_review_attempt_reviewer_fields CHECK (
    (reviewer_kind = 'model' AND provider IS NOT NULL AND model IS NOT NULL)
    OR (reviewer_kind = 'human' AND provider IS NULL AND model IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_review_attempts_revision_sequence
  ON theme_fact_review_attempts (fact_revision_id, review_sequence DESC);

CREATE TABLE IF NOT EXISTS theme_fact_review_outcomes (
  attempt_id uuid PRIMARY KEY,
  status varchar(24) NOT NULL CHECK (status IN ('reviewed', 'invalid_output', 'failed')),
  aggregate_verdict varchar(8),
  dimensions jsonb,
  output_hash varchar(64),
  valid_until timestamptz,
  failure_code varchar(64),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_fact_review_outcome_attempt
    FOREIGN KEY (attempt_id) REFERENCES theme_fact_review_attempts(id) ON DELETE RESTRICT,
  CONSTRAINT theme_fact_review_outcome_hash CHECK (
    output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT theme_fact_review_outcome_fields CHECK (
    (status = 'reviewed'
      AND aggregate_verdict IN ('pass', 'flag', 'fail')
      AND dimensions IS NOT NULL AND jsonb_typeof(dimensions) = 'object'
      AND dimensions ?& ARRAY['entailment', 'scope', 'canonical_answer', 'aliases', 'conflict', 'source_independence']
      AND dimensions - ARRAY['entailment', 'scope', 'canonical_answer', 'aliases', 'conflict', 'source_independence'] = '{}'::jsonb
      AND aggregate_verdict IS NOT NULL
      AND output_hash IS NOT NULL AND valid_until IS NOT NULL AND failure_code IS NULL)
    OR (status IN ('invalid_output', 'failed')
      AND aggregate_verdict IS NULL AND dimensions IS NULL AND output_hash IS NULL
      AND valid_until IS NULL AND failure_code IS NOT NULL AND failure_code IN (
        'invalid_output', 'reviewer_failure', 'evidence_changed', 'storage_failure'
      ))
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_review_outcomes_status_validity
  ON theme_fact_review_outcomes (status, valid_until);

DROP TRIGGER IF EXISTS theme_fact_review_attempts_immutable ON theme_fact_review_attempts;
CREATE TRIGGER theme_fact_review_attempts_immutable
  BEFORE UPDATE OR DELETE ON theme_fact_review_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();

DROP TRIGGER IF EXISTS theme_fact_review_outcomes_immutable ON theme_fact_review_outcomes;
CREATE TRIGGER theme_fact_review_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_fact_review_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
