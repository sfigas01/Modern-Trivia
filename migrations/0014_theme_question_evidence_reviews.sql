-- STE-25 S8a: immutable independent question-level evidence-review attempts.
-- Existing theme_evidence_reviews and binding tables hold the seven-dimension result.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_evidence_reviews_id_revision_hash_verdict
  ON theme_evidence_reviews (id, question_revision_id, question_content_hash, verdict);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_review_binding
  ON theme_question_generation_attempts (id, candidate_id, question_revision_id, fact_revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_outcome_review_binding
  ON theme_question_generation_outcomes (attempt_id, candidate_id, question_revision_id, question_content_hash);

CREATE TABLE IF NOT EXISTS theme_question_evidence_review_attempts (
  id uuid PRIMARY KEY,
  contract_version varchar(64) NOT NULL CHECK (contract_version = 'theme-question-evidence-review-v1'),
  candidate_id uuid NOT NULL,
  question_revision_id uuid NOT NULL,
  question_content_hash varchar(64) NOT NULL CHECK (question_content_hash ~ '^[a-f0-9]{64}$'),
  generation_attempt_id uuid NOT NULL,
  fact_revision_id uuid NOT NULL REFERENCES theme_fact_revisions(id) ON DELETE RESTRICT,
  review_sequence integer NOT NULL CHECK (review_sequence > 0),
  reviewer_kind varchar(16) NOT NULL CHECK (reviewer_kind IN ('model', 'human')),
  reviewer_id varchar(255) NOT NULL,
  provider varchar(255),
  model varchar(255),
  execution_id uuid NOT NULL UNIQUE,
  review_policy_version varchar(255) NOT NULL,
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  policy_hash varchar(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  prompt_version varchar(255) NOT NULL,
  prompt_hash varchar(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_fingerprint varchar(64) NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_question_evidence_review_sequence UNIQUE (question_revision_id, review_sequence),
  CONSTRAINT uq_theme_question_evidence_review_attempt_binding
    UNIQUE (id, candidate_id, question_revision_id, question_content_hash),
  CONSTRAINT fk_theme_question_evidence_review_question
    FOREIGN KEY (question_revision_id, candidate_id, question_content_hash)
    REFERENCES theme_question_revisions (id, candidate_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_evidence_review_generation
    FOREIGN KEY (generation_attempt_id, candidate_id, question_revision_id, fact_revision_id)
    REFERENCES theme_question_generation_attempts (id, candidate_id, question_revision_id, fact_revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_evidence_review_generation_outcome
    FOREIGN KEY (generation_attempt_id, candidate_id, question_revision_id, question_content_hash)
    REFERENCES theme_question_generation_outcomes (attempt_id, candidate_id, question_revision_id, question_content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_question_evidence_review_reviewer_fields CHECK (
    (reviewer_kind = 'model' AND provider IS NOT NULL AND model IS NOT NULL)
    OR (reviewer_kind = 'human' AND provider IS NULL AND model IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_question_evidence_review_newest
  ON theme_question_evidence_review_attempts (question_revision_id, review_sequence DESC);

CREATE TABLE IF NOT EXISTS theme_question_evidence_review_outcomes (
  attempt_id uuid PRIMARY KEY REFERENCES theme_question_evidence_review_attempts(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL,
  question_revision_id uuid NOT NULL,
  question_content_hash varchar(64) NOT NULL CHECK (question_content_hash ~ '^[a-f0-9]{64}$'),
  status varchar(24) NOT NULL CHECK (status IN ('reviewed', 'invalid_output', 'failed', 'ineligible')),
  review_id uuid UNIQUE,
  verdict varchar(10),
  output_hash varchar(64) CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  failure_code varchar(64),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_question_evidence_review_outcome_attempt
    FOREIGN KEY (attempt_id, candidate_id, question_revision_id, question_content_hash)
    REFERENCES theme_question_evidence_review_attempts
      (id, candidate_id, question_revision_id, question_content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_evidence_review_outcome_review
    FOREIGN KEY (review_id, question_revision_id, question_content_hash, verdict)
    REFERENCES theme_evidence_reviews (id, question_revision_id, question_content_hash, verdict) ON DELETE RESTRICT,
  CONSTRAINT theme_question_evidence_review_outcome_fields CHECK (
    (status = 'reviewed' AND review_id IS NOT NULL AND verdict IS NOT NULL
      AND verdict IN ('pass', 'flag', 'fail')
      AND output_hash IS NOT NULL AND failure_code IS NULL)
    OR (status <> 'reviewed' AND review_id IS NULL AND verdict IS NULL AND output_hash IS NULL
      AND failure_code IS NOT NULL AND failure_code = CASE status
        WHEN 'invalid_output' THEN 'invalid_output'
        WHEN 'failed' THEN 'reviewer_failure'
        WHEN 'ineligible' THEN 'evidence_changed' END)
  )
);

DROP TRIGGER IF EXISTS theme_question_evidence_review_attempts_immutable ON theme_question_evidence_review_attempts;
CREATE TRIGGER theme_question_evidence_review_attempts_immutable
  BEFORE UPDATE OR DELETE ON theme_question_evidence_review_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_question_evidence_review_outcomes_immutable ON theme_question_evidence_review_outcomes;
CREATE TRIGGER theme_question_evidence_review_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_question_evidence_review_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
