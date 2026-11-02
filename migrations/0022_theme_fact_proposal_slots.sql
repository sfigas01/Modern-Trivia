-- STE-167 S12B-4B: immutable bounded proposal allocation and validated proposal replay.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_preparation_jobs_id_plan_hash
  ON theme_preparation_jobs(id, plan_hash);

CREATE TABLE IF NOT EXISTS theme_proposal_slots (
  job_id uuid NOT NULL,
  plan_hash varchar(64) NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  slot_key varchar(32) NOT NULL CHECK (slot_key ~ '^proposal:[0-9]{3}$'),
  slot_ordinal integer NOT NULL CHECK (slot_ordinal BETWEEN 1 AND 100),
  source_key varchar(255) NOT NULL CHECK (source_key ~ '^wikipedia:[1-9][0-9]*$'),
  allocation_version varchar(64) NOT NULL
    CHECK (allocation_version = 'theme-proposal-slot-round-robin-v1'),
  policy_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(policy_snapshot) = 'object'
    AND octet_length(policy_snapshot::text) <= 4096
  ),
  policy_hash varchar(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, slot_key),
  UNIQUE (job_id, slot_ordinal),
  FOREIGN KEY (job_id, plan_hash)
    REFERENCES theme_preparation_jobs(id, plan_hash) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_theme_proposal_slots_source
  ON theme_proposal_slots(job_id, source_key, slot_ordinal);

CREATE TABLE IF NOT EXISTS theme_proposal_slot_outcomes (
  job_id uuid NOT NULL,
  slot_key varchar(32) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('proposed', 'withheld')),
  outcome_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(outcome_snapshot) = 'object'
    AND octet_length(outcome_snapshot::text) <= 131072
  ),
  evidence_fingerprint varchar(64) NOT NULL
    CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  provenance_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(provenance_snapshot) = 'object'
    AND octet_length(provenance_snapshot::text) <= 16384
  ),
  provenance_fingerprint varchar(64) NOT NULL
    CHECK (provenance_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_fact_key varchar(255),
  result_hash varchar(64) NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, slot_key),
  FOREIGN KEY (job_id, slot_key)
    REFERENCES theme_proposal_slots(job_id, slot_key) ON DELETE RESTRICT,
  CHECK ((
    (status = 'proposed'
      AND outcome_snapshot->>'status' = 'proposed'
      AND canonical_fact_key IS NOT NULL
      AND canonical_fact_key ~ '^fact-scope-v1:[a-f0-9]{64}$')
    OR
    (status = 'withheld'
      AND outcome_snapshot->>'status' = 'withheld'
      AND canonical_fact_key IS NULL)
  ) IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_theme_proposal_slot_outcomes_fact
  ON theme_proposal_slot_outcomes(canonical_fact_key)
  WHERE canonical_fact_key IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_theme_proposal_slot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'theme proposal slot records are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_proposal_slots_immutable ON theme_proposal_slots;
CREATE TRIGGER theme_proposal_slots_immutable
  BEFORE UPDATE OR DELETE ON theme_proposal_slots
  FOR EACH ROW EXECUTE FUNCTION reject_theme_proposal_slot_mutation();

DROP TRIGGER IF EXISTS theme_proposal_slot_outcomes_immutable
  ON theme_proposal_slot_outcomes;
CREATE TRIGGER theme_proposal_slot_outcomes_immutable
  BEFORE UPDATE OR DELETE ON theme_proposal_slot_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_theme_proposal_slot_mutation();
