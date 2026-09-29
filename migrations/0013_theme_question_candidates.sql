-- STE-25 S7: immutable, independently reviewed fact-bound question candidates.
-- Drizzle push may create the supporting unique indexes first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_fact_review_outcome_attempt_verdict_hash
  ON theme_fact_review_outcomes (attempt_id, aggregate_verdict, output_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_candidates_exact_binding
  ON theme_candidates (id, job_id, ordinal, fact_id, fact_revision_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_revisions_candidate_binding
  ON theme_question_revisions (id, candidate_id, content_hash);

CREATE TABLE IF NOT EXISTS theme_question_generation_attempts (
  id uuid PRIMARY KEY,
  contract_version varchar(64) NOT NULL CHECK (contract_version = 'theme-question-generation-v1'),
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  candidate_id uuid NOT NULL,
  question_revision_id uuid NOT NULL,
  fact_id uuid NOT NULL,
  fact_revision_id uuid NOT NULL,
  fact_content_hash varchar(64) NOT NULL CHECK (fact_content_hash ~ '^[a-f0-9]{64}$'),
  fact_review_attempt_id uuid NOT NULL,
  fact_review_verdict varchar(8) NOT NULL DEFAULT 'pass' CHECK (fact_review_verdict = 'pass'),
  fact_review_output_hash varchar(64) NOT NULL CHECK (fact_review_output_hash ~ '^[a-f0-9]{64}$'),
  writer_kind varchar(16) NOT NULL CHECK (writer_kind IN ('model', 'human')),
  writer_id varchar(255) NOT NULL,
  provider varchar(255),
  model varchar(255),
  execution_id uuid NOT NULL UNIQUE,
  generation_policy_version varchar(255) NOT NULL,
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  policy_hash varchar(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  prompt_version varchar(255) NOT NULL,
  prompt_hash varchar(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  prompt_snapshot text NOT NULL CHECK (length(prompt_snapshot) BETWEEN 1 AND 32000),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_fingerprint varchar(64) NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  eligibility_fingerprint varchar(64) NOT NULL CHECK (eligibility_fingerprint ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_question_generation_job_ordinal UNIQUE (job_id, ordinal),
  CONSTRAINT uq_theme_question_generation_attempt_binding UNIQUE
    (id, job_id, ordinal, candidate_id, question_revision_id, fact_id, fact_revision_id,
     fact_content_hash, fact_review_attempt_id, fact_review_output_hash),
  CONSTRAINT fk_theme_question_generation_fact_revision
    FOREIGN KEY (fact_revision_id, fact_id)
    REFERENCES theme_fact_revisions(id, fact_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_generation_review_attempt
    FOREIGN KEY (fact_review_attempt_id, fact_revision_id, fact_content_hash)
    REFERENCES theme_fact_review_attempts(id, fact_revision_id, fact_content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_generation_passing_review
    FOREIGN KEY (fact_review_attempt_id, fact_review_verdict, fact_review_output_hash)
    REFERENCES theme_fact_review_outcomes(attempt_id, aggregate_verdict, output_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_question_generation_writer_fields CHECK (
    (writer_kind = 'model' AND provider IS NOT NULL AND model IS NOT NULL)
    OR (writer_kind = 'human' AND provider IS NULL AND model IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_question_generation_fact_review
  ON theme_question_generation_attempts (fact_revision_id, fact_review_attempt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_candidate_id
  ON theme_question_generation_attempts (candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_question_revision_id
  ON theme_question_generation_attempts (question_revision_id);

CREATE TABLE IF NOT EXISTS theme_question_generation_outcomes (
  attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  ordinal integer NOT NULL,
  candidate_id uuid NOT NULL,
  question_revision_id uuid NOT NULL,
  fact_id uuid NOT NULL,
  fact_revision_id uuid NOT NULL,
  fact_content_hash varchar(64) NOT NULL CHECK (fact_content_hash ~ '^[a-f0-9]{64}$'),
  fact_review_attempt_id uuid NOT NULL,
  fact_review_output_hash varchar(64) NOT NULL CHECK (fact_review_output_hash ~ '^[a-f0-9]{64}$'),
  status varchar(24) NOT NULL CHECK (status IN ('persisted', 'declined', 'invalid_output', 'ineligible', 'failed')),
  question_content_hash varchar(64) CHECK (question_content_hash IS NULL OR question_content_hash ~ '^[a-f0-9]{64}$'),
  failure_code varchar(64),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_question_generation_outcome_attempt_binding
    FOREIGN KEY (attempt_id, job_id, ordinal, candidate_id, question_revision_id, fact_id,
                 fact_revision_id, fact_content_hash, fact_review_attempt_id, fact_review_output_hash)
    REFERENCES theme_question_generation_attempts
      (id, job_id, ordinal, candidate_id, question_revision_id, fact_id, fact_revision_id,
       fact_content_hash, fact_review_attempt_id, fact_review_output_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_generation_outcome_candidate
    FOREIGN KEY (candidate_id, job_id, ordinal, fact_id, fact_revision_id, question_content_hash)
    REFERENCES theme_candidates (id, job_id, ordinal, fact_id, fact_revision_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_generation_outcome_question_revision
    FOREIGN KEY (question_revision_id, candidate_id, question_content_hash)
    REFERENCES theme_question_revisions (id, candidate_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_question_generation_outcome_fields CHECK (
    (status = 'persisted' AND question_content_hash IS NOT NULL AND failure_code IS NULL)
    OR (status = 'declined' AND question_content_hash IS NULL AND failure_code IS NOT NULL AND failure_code = 'writer_declined')
    OR (status = 'invalid_output' AND question_content_hash IS NULL AND failure_code IS NOT NULL AND failure_code = 'invalid_output')
    OR (status = 'ineligible' AND question_content_hash IS NULL AND failure_code IS NOT NULL AND failure_code = 'ineligible')
    OR (status = 'failed' AND question_content_hash IS NULL AND failure_code IS NOT NULL AND failure_code IN ('writer_failure', 'candidate_conflict'))
  )
);

DROP TRIGGER IF EXISTS theme_question_generation_attempts_immutable
  ON theme_question_generation_attempts;
CREATE TRIGGER theme_question_generation_attempts_immutable
  BEFORE UPDATE OR DELETE ON theme_question_generation_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_question_generation_outcomes_immutable
  ON theme_question_generation_outcomes;
CREATE TRIGGER theme_question_generation_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_question_generation_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
