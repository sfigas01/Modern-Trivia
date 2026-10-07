-- STE-25 S10: one immutable final approval binds a pending candidate to an
-- ordinary library question and its separately owned revision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_candidates_id_content_hash
  ON theme_candidates (id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_revisions_library_binding
  ON theme_question_revisions (id, question_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_question_evidence_outcome_approval_binding
  ON theme_question_evidence_review_outcomes
    (attempt_id, candidate_id, question_revision_id, question_content_hash, review_id, verdict);

CREATE TABLE IF NOT EXISTS theme_question_approvals (
  id uuid PRIMARY KEY,
  contract_version varchar(64) NOT NULL
    CHECK (contract_version = 'theme-question-approval-v1'),
  candidate_id uuid NOT NULL UNIQUE,
  question_revision_id uuid NOT NULL UNIQUE,
  question_content_hash varchar(64) NOT NULL
    CHECK (question_content_hash ~ '^[a-f0-9]{64}$'),
  generation_attempt_id uuid NOT NULL UNIQUE,
  evidence_attempt_id uuid NOT NULL UNIQUE,
  evidence_review_id uuid NOT NULL,
  evidence_verdict varchar(10) NOT NULL DEFAULT 'pass' CHECK (evidence_verdict = 'pass'),
  evidence_fingerprint varchar(64) NOT NULL
    CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  qa_policy_version varchar(255) NOT NULL,
  qa_evaluated_at timestamptz NOT NULL,
  corpus_revision varchar(255) NOT NULL,
  corpus_hash varchar(64) NOT NULL CHECK (corpus_hash ~ '^[a-f0-9]{64}$'),
  library_question_id varchar(255) NOT NULL UNIQUE REFERENCES questions(id) ON DELETE RESTRICT,
  library_revision_id uuid NOT NULL UNIQUE,
  source_document_id uuid NOT NULL REFERENCES theme_evidence_documents(id) ON DELETE RESTRICT,
  source_url text NOT NULL,
  source_name varchar(255) NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_question_approval_candidate
    FOREIGN KEY (candidate_id, question_content_hash)
    REFERENCES theme_candidates (id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_approval_generation
    FOREIGN KEY (generation_attempt_id, candidate_id, question_revision_id, question_content_hash)
    REFERENCES theme_question_generation_outcomes
      (attempt_id, candidate_id, question_revision_id, question_content_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_approval_evidence
    FOREIGN KEY (evidence_attempt_id, candidate_id, question_revision_id,
                 question_content_hash, evidence_review_id, evidence_verdict)
    REFERENCES theme_question_evidence_review_outcomes
      (attempt_id, candidate_id, question_revision_id, question_content_hash,
       review_id, verdict) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_approval_library_revision
    FOREIGN KEY (library_revision_id, library_question_id, question_content_hash)
    REFERENCES theme_question_revisions (id, question_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_question_approval_required_text CHECK (
    length(trim(qa_policy_version)) > 0 AND length(trim(corpus_revision)) > 0
    AND length(trim(source_url)) > 0 AND length(trim(source_name)) > 0
  )
);

DROP TRIGGER IF EXISTS theme_question_approvals_immutable ON theme_question_approvals;
CREATE TRIGGER theme_question_approvals_immutable
  BEFORE UPDATE OR DELETE ON theme_question_approvals
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
