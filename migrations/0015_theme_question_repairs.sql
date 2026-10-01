-- STE-25 S9: one bounded repair child and a durable provisional re-review result.
ALTER TABLE theme_question_generation_attempts
  ADD COLUMN IF NOT EXISTS parent_candidate_id uuid,
  ADD COLUMN IF NOT EXISTS parent_question_revision_id uuid,
  ADD COLUMN IF NOT EXISTS parent_question_content_hash varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_repair_parent
  ON theme_question_generation_attempts (parent_candidate_id)
  WHERE parent_candidate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_repair_binding
  ON theme_question_generation_attempts (id, parent_candidate_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_theme_question_generation_repair_parent_revision') THEN
    ALTER TABLE theme_question_generation_attempts
      ADD CONSTRAINT fk_theme_question_generation_repair_parent_revision
      FOREIGN KEY (parent_question_revision_id, parent_candidate_id, parent_question_content_hash)
      REFERENCES theme_question_revisions (id, candidate_id, content_hash) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theme_question_generation_repair_binding') THEN
    ALTER TABLE theme_question_generation_attempts
      ADD CONSTRAINT theme_question_generation_repair_binding CHECK (
        (parent_candidate_id IS NULL AND parent_question_revision_id IS NULL AND parent_question_content_hash IS NULL)
        OR
        (parent_candidate_id IS NOT NULL AND parent_question_revision_id IS NOT NULL
          AND parent_question_content_hash IS NOT NULL
          AND parent_question_content_hash ~ '^[a-f0-9]{64}$'
          AND parent_candidate_id <> candidate_id
          AND parent_question_revision_id <> question_revision_id)
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS theme_question_generation_attempts_immutable
  ON theme_question_generation_attempts;
CREATE TRIGGER theme_question_generation_attempts_immutable
  BEFORE UPDATE OR DELETE ON theme_question_generation_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();

ALTER TABLE theme_question_generation_outcomes
  DROP CONSTRAINT IF EXISTS theme_question_generation_outcome_fields;
ALTER TABLE theme_question_generation_outcomes
  ADD CONSTRAINT theme_question_generation_outcome_fields CHECK (
    (status = 'persisted' AND question_content_hash IS NOT NULL AND failure_code IS NULL)
    OR (status = 'declined' AND question_content_hash IS NULL
      AND failure_code IS NOT NULL AND failure_code = 'writer_declined')
    OR (status = 'invalid_output' AND question_content_hash IS NULL
      AND failure_code IS NOT NULL AND failure_code = 'invalid_output')
    OR (status = 'ineligible' AND question_content_hash IS NULL
      AND failure_code IS NOT NULL AND failure_code = 'ineligible')
    OR (status = 'failed' AND question_content_hash IS NULL
      AND failure_code IS NOT NULL
      AND failure_code IN ('writer_failure', 'candidate_conflict', 'repair_unchanged'))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_generation_outcome_review_binding
  ON theme_question_generation_outcomes
    (attempt_id, candidate_id, question_revision_id, question_content_hash);

CREATE TABLE IF NOT EXISTS theme_question_repair_outcomes (
  generation_attempt_id uuid PRIMARY KEY,
  parent_candidate_id uuid NOT NULL UNIQUE,
  candidate_id uuid,
  question_revision_id uuid,
  question_content_hash varchar(64),
  status varchar(24) NOT NULL CHECK (status IN ('passed', 'withheld', 'declined', 'invalid_output', 'failed', 'ineligible')),
  stage varchar(16) NOT NULL CHECK (stage IN ('generation', 'evidence', 'qa')),
  reason varchar(64) NOT NULL,
  evidence_review_attempt_id uuid,
  evidence_review_id uuid,
  evidence_fingerprint varchar(64),
  qa_policy_version varchar(255),
  qa_evaluated_at timestamptz,
  corpus_revision varchar(255),
  corpus_hash varchar(64),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_question_repair_generation
    FOREIGN KEY (generation_attempt_id, parent_candidate_id)
    REFERENCES theme_question_generation_attempts (id, parent_candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_repair_generation_outcome
    FOREIGN KEY (generation_attempt_id, candidate_id, question_revision_id, question_content_hash)
    REFERENCES theme_question_generation_outcomes
      (attempt_id, candidate_id, question_revision_id, question_content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_repair_evidence_attempt
    FOREIGN KEY (evidence_review_attempt_id, candidate_id, question_revision_id, question_content_hash)
    REFERENCES theme_question_evidence_review_attempts
      (id, candidate_id, question_revision_id, question_content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_question_repair_fields CHECK (
    (stage = 'generation' AND status IN ('declined', 'invalid_output', 'failed', 'ineligible')
      AND candidate_id IS NULL AND question_revision_id IS NULL AND question_content_hash IS NULL
      AND evidence_review_attempt_id IS NULL AND evidence_review_id IS NULL
      AND evidence_fingerprint IS NULL AND qa_policy_version IS NULL AND qa_evaluated_at IS NULL
      AND corpus_revision IS NULL AND corpus_hash IS NULL)
    OR
    (stage = 'evidence' AND status = 'withheld'
      AND candidate_id IS NOT NULL AND question_revision_id IS NOT NULL
      AND question_content_hash IS NOT NULL
      AND question_content_hash ~ '^[a-f0-9]{64}$' AND evidence_review_attempt_id IS NOT NULL
      AND qa_policy_version IS NULL AND qa_evaluated_at IS NULL
      AND corpus_revision IS NULL AND corpus_hash IS NULL)
    OR
    (stage = 'qa' AND status IN ('passed', 'withheld')
      AND candidate_id IS NOT NULL AND question_revision_id IS NOT NULL
      AND question_content_hash ~ '^[a-f0-9]{64}$' AND evidence_review_attempt_id IS NOT NULL
      AND question_content_hash IS NOT NULL AND evidence_review_id IS NOT NULL
      AND evidence_fingerprint IS NOT NULL AND evidence_fingerprint ~ '^[a-f0-9]{64}$'
      AND qa_policy_version IS NOT NULL AND qa_evaluated_at IS NOT NULL
      AND (corpus_hash IS NULL OR corpus_hash ~ '^[a-f0-9]{64}$'))
  )
);

DROP TRIGGER IF EXISTS theme_question_repair_outcomes_immutable
  ON theme_question_repair_outcomes;
CREATE TRIGGER theme_question_repair_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_question_repair_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
