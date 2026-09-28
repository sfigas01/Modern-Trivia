-- STE-25 S6a: immutable provenance for every accepted fact-derivation dispatch.
-- Existing fact revisions remain valid legacy rows, but cannot be retroactively
-- attached to an attempt because attempt outcomes are append-only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_theme_fact_revisions_id_hash'
      AND conrelid = 'theme_fact_revisions'::regclass
  ) THEN
    ALTER TABLE theme_fact_revisions
      ADD CONSTRAINT uq_theme_fact_revisions_id_hash UNIQUE (id, content_hash);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS theme_fact_derivation_attempts (
  id uuid PRIMARY KEY,
  contract_version varchar(64) NOT NULL
    CHECK (contract_version = 'theme-fact-derivation-provenance-v1'),
  canonical_key varchar(255) NOT NULL,
  requested_revision_id uuid NOT NULL,
  expected_latest_revision integer NOT NULL CHECK (expected_latest_revision >= 0),
  derivation_policy_version varchar(255) NOT NULL,
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  policy_hash varchar(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  prompt_version varchar(255) NOT NULL,
  prompt_hash varchar(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_fingerprint varchar(64) NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  producer_kind varchar(16) NOT NULL CHECK (producer_kind IN ('model', 'human')),
  producer_id varchar(255) NOT NULL,
  provider varchar(255),
  model varchar(255),
  execution_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_fact_derivation_attempt_revision UNIQUE (id, requested_revision_id),
  CONSTRAINT theme_fact_derivation_attempts_producer_fields CHECK (
    (producer_kind = 'model' AND provider IS NOT NULL AND model IS NOT NULL)
    OR (producer_kind = 'human' AND provider IS NULL AND model IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_derivation_attempts_fact
  ON theme_fact_derivation_attempts (canonical_key, created_at);

CREATE TABLE IF NOT EXISTS theme_fact_derivation_outcomes (
  attempt_id uuid PRIMARY KEY REFERENCES theme_fact_derivation_attempts(id) ON DELETE RESTRICT,
  outcome varchar(32) NOT NULL CHECK (
    outcome IN ('persisted', 'insufficient_evidence', 'conflicted',
                'policy_unsatisfied', 'invalid_output', 'failed')
  ),
  proposal_snapshot jsonb CHECK (
    proposal_snapshot IS NULL OR jsonb_typeof(proposal_snapshot) = 'object'
  ),
  output_hash varchar(64) CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  fact_revision_id uuid,
  fact_content_hash varchar(64) CHECK (
    fact_content_hash IS NULL OR fact_content_hash ~ '^[a-f0-9]{64}$'
  ),
  bindings_fingerprint varchar(64) CHECK (
    bindings_fingerprint IS NULL OR bindings_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  failure_code varchar(64),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_fact_derivation_outcome_revision UNIQUE (fact_revision_id),
  CONSTRAINT fk_theme_fact_derivation_outcome_attempt_revision
    FOREIGN KEY (attempt_id, fact_revision_id)
    REFERENCES theme_fact_derivation_attempts(id, requested_revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_fact_derivation_outcome_revision
    FOREIGN KEY (fact_revision_id, fact_content_hash)
    REFERENCES theme_fact_revisions(id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_fact_derivation_outcomes_fields CHECK (
    (outcome = 'persisted'
      AND proposal_snapshot IS NOT NULL AND output_hash IS NOT NULL
      AND fact_revision_id IS NOT NULL AND fact_content_hash IS NOT NULL
      AND bindings_fingerprint IS NOT NULL AND failure_code IS NULL)
    OR (outcome IN ('insufficient_evidence', 'conflicted')
      AND proposal_snapshot IS NULL AND output_hash IS NOT NULL
      AND fact_revision_id IS NULL AND fact_content_hash IS NULL
      AND bindings_fingerprint IS NULL AND failure_code IS NULL)
    OR (outcome = 'policy_unsatisfied'
      AND proposal_snapshot IS NOT NULL AND output_hash IS NOT NULL
      AND fact_revision_id IS NULL AND fact_content_hash IS NULL
      AND bindings_fingerprint IS NULL AND failure_code IS NULL)
    OR (outcome IN ('invalid_output', 'failed')
      AND proposal_snapshot IS NULL AND output_hash IS NULL
      AND fact_revision_id IS NULL AND fact_content_hash IS NULL
      AND bindings_fingerprint IS NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_derivation_outcomes_revision
  ON theme_fact_derivation_outcomes (fact_revision_id, fact_content_hash)
  WHERE fact_revision_id IS NOT NULL;

DROP TRIGGER IF EXISTS theme_fact_derivation_attempts_immutable
  ON theme_fact_derivation_attempts;
CREATE TRIGGER theme_fact_derivation_attempts_immutable
  BEFORE UPDATE OR DELETE ON theme_fact_derivation_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();

DROP TRIGGER IF EXISTS theme_fact_derivation_outcomes_immutable
  ON theme_fact_derivation_outcomes;
CREATE TRIGGER theme_fact_derivation_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_fact_derivation_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
