-- STE-167 / STE-25: theme-reliability-v1 foundation.
-- Additive only: existing lean themed-game routes and tables remain untouched.

CREATE TABLE IF NOT EXISTS theme_evidence_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  requested_url text NOT NULL,
  final_url text NOT NULL,
  canonical_url text NOT NULL,
  publisher_id varchar(255) NOT NULL,
  source_class varchar(40) NOT NULL CHECK (source_class IN ('primary_official', 'primary_record', 'secondary_authoritative', 'secondary_reputable')),
  publisher varchar(255) NOT NULL,
  origin_group varchar(255) NOT NULL,
  source_policy_version varchar(255) NOT NULL,
  extractor_version varchar(255) NOT NULL,
  title text NOT NULL,
  language varchar(35) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('retrieved', 'stale', 'withdrawn', 'unreadable')),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz NOT NULL,
  published_at timestamptz,
  source_updated_at timestamptz,
  valid_until timestamptz,
  http_status integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  media_type varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_theme_evidence_documents_url_hash ON theme_evidence_documents (canonical_url, content_hash);
CREATE INDEX IF NOT EXISTS idx_theme_evidence_documents_freshness ON theme_evidence_documents (status, valid_until);

CREATE TABLE IF NOT EXISTS theme_evidence_passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  document_id uuid NOT NULL REFERENCES theme_evidence_documents(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  locator text NOT NULL,
  passage_text text NOT NULL,
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_evidence_passages_document_ordinal UNIQUE (document_id, ordinal),
  CONSTRAINT uq_theme_evidence_passages_document_hash UNIQUE (document_id, content_hash)
);

CREATE TABLE IF NOT EXISTS theme_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key varchar(255) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL REFERENCES theme_facts(id) ON DELETE RESTRICT,
  contract_version varchar(64) NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  statement text NOT NULL,
  scope jsonb NOT NULL,
  canonical_answer text NOT NULL,
  supported_aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supported_aliases) = 'array'),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  time_sensitive boolean NOT NULL DEFAULT false,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_fact_revisions_fact_revision UNIQUE (fact_id, revision),
  CONSTRAINT uq_theme_fact_revisions_fact_hash UNIQUE (fact_id, content_hash),
  CONSTRAINT uq_theme_fact_revisions_id_fact UNIQUE (id, fact_id),
  CONSTRAINT theme_fact_revisions_time_sensitive_expiry CHECK (NOT time_sensitive OR valid_until IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_revisions_freshness ON theme_fact_revisions (time_sensitive, valid_until);

CREATE TABLE IF NOT EXISTS theme_fact_evidence_passages (
  fact_revision_id uuid NOT NULL REFERENCES theme_fact_revisions(id) ON DELETE RESTRICT,
  passage_id uuid NOT NULL REFERENCES theme_evidence_passages(id) ON DELETE RESTRICT,
  support_kind varchar(20) NOT NULL CHECK (support_kind IN ('supports', 'conflicts', 'context')),
  PRIMARY KEY (fact_revision_id, passage_id)
);
CREATE INDEX IF NOT EXISTS idx_theme_fact_evidence_passages_passage ON theme_fact_evidence_passages (passage_id);

CREATE TABLE IF NOT EXISTS theme_game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  idempotency_owner_hash varchar(64) NOT NULL CHECK (idempotency_owner_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint varchar(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  room_id uuid,
  mode varchar(20) NOT NULL CHECK (mode IN ('multiplayer', 'shared_device')),
  status varchar(32) NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'preflight', 'preparing', 'awaiting_mix_consent', 'ready', 'active', 'paused', 'waiting', 'completed', 'failed', 'abandoned', 'expired')),
  theme varchar(60) NOT NULL,
  theme_slug varchar(100) NOT NULL,
  related_categories jsonb NOT NULL CHECK (jsonb_typeof(related_categories) = 'array'),
  player_count integer NOT NULL CHECK (player_count IN (2, 3, 4)),
  question_count integer NOT NULL CHECK (question_count IN (40, 60, 80)),
  themed_question_target integer NOT NULL,
  related_question_target integer NOT NULL,
  candidate_ceiling integer NOT NULL CHECK (candidate_ceiling IN (50, 75, 100)),
  opening_question_target integer NOT NULL CHECK (opening_question_target IN (16, 24, 32)),
  opening_themed_target integer NOT NULL,
  opening_related_target integer NOT NULL,
  mix_consent_status varchar(20) NOT NULL DEFAULT 'not_required' CHECK (mix_consent_status IN ('not_required', 'pending', 'accepted', 'declined')),
  accepted_themed_target integer,
  accepted_related_target integer,
  mix_decision_by_hash varchar(64),
  mix_decided_at timestamptz,
  corpus_revision integer NOT NULL DEFAULT 1,
  history_revision integer NOT NULL DEFAULT 1,
  roster_locked_at timestamptz,
  scheduling_paused_at timestamptz,
  disconnect_grace_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_game_sessions_mix_totals CHECK (themed_question_target + related_question_target = question_count AND opening_themed_target + opening_related_target = opening_question_target),
  CONSTRAINT theme_game_sessions_plan CHECK ((player_count = 2 AND question_count = 40 AND themed_question_target = 30 AND related_question_target = 10 AND candidate_ceiling = 50 AND opening_question_target = 16 AND opening_themed_target = 12 AND opening_related_target = 4) OR (player_count = 3 AND question_count = 60 AND themed_question_target = 45 AND related_question_target = 15 AND candidate_ceiling = 75 AND opening_question_target = 24 AND opening_themed_target = 18 AND opening_related_target = 6) OR (player_count = 4 AND question_count = 80 AND themed_question_target = 60 AND related_question_target = 20 AND candidate_ceiling = 100 AND opening_question_target = 32 AND opening_themed_target = 24 AND opening_related_target = 8)),
  CONSTRAINT theme_game_sessions_mix_consent CHECK ((mix_consent_status = 'accepted' AND accepted_themed_target IS NOT NULL AND accepted_related_target IS NOT NULL AND accepted_themed_target >= 0 AND accepted_related_target >= 0 AND accepted_themed_target + accepted_related_target = question_count AND mix_decision_by_hash IS NOT NULL AND mix_decision_by_hash ~ '^[a-f0-9]{64}$' AND mix_decided_at IS NOT NULL) OR (mix_consent_status <> 'accepted' AND accepted_themed_target IS NULL AND accepted_related_target IS NULL AND mix_decision_by_hash IS NULL AND mix_decided_at IS NULL)),
  CONSTRAINT theme_game_sessions_revisions_positive CHECK (corpus_revision > 0 AND history_revision > 0)
);
CREATE INDEX IF NOT EXISTS idx_theme_game_sessions_room ON theme_game_sessions (room_id);
CREATE INDEX IF NOT EXISTS idx_theme_game_sessions_status_expiry ON theme_game_sessions (status, expires_at);

CREATE TABLE IF NOT EXISTS theme_participant_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL CHECK (kind IN ('account', 'guest_browser', 'shared_device')),
  stable_key_hash varchar(64) NOT NULL CHECK (stable_key_hash ~ '^[a-f0-9]{64}$'),
  account_user_id varchar REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_participant_identities_kind_hash UNIQUE (kind, stable_key_hash),
  CONSTRAINT theme_participant_identities_account_binding CHECK ((kind = 'account' AND account_user_id IS NOT NULL) OR (kind <> 'account' AND account_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_theme_participant_identities_user ON theme_participant_identities (account_user_id);

CREATE TABLE IF NOT EXISTS theme_identity_links (
  source_identity_id uuid NOT NULL REFERENCES theme_participant_identities(id) ON DELETE RESTRICT,
  target_identity_id uuid NOT NULL REFERENCES theme_participant_identities(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_identity_id, target_identity_id),
  CONSTRAINT theme_identity_links_distinct CHECK (source_identity_id <> target_identity_id)
);

CREATE TABLE IF NOT EXISTS theme_game_participants (
  game_id uuid NOT NULL REFERENCES theme_game_sessions(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES theme_participant_identities(id) ON DELETE RESTRICT,
  room_player_id uuid,
  seat integer NOT NULL CHECK (seat BETWEEN 0 AND 3),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (game_id, identity_id),
  CONSTRAINT uq_theme_game_participants_seat UNIQUE (game_id, seat)
);
CREATE INDEX IF NOT EXISTS idx_theme_game_participants_identity ON theme_game_participants (identity_id);

CREATE TABLE IF NOT EXISTS theme_preparation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  game_id uuid NOT NULL REFERENCES theme_game_sessions(id) ON DELETE CASCADE,
  stable_key varchar(255) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'researching', 'retrieving', 'extracting', 'writing', 'reviewing', 'qa', 'semantic_check', 'reserving', 'ready', 'shortfall', 'waiting', 'completed', 'failed', 'canceled', 'expired')),
  public_stage varchar(20) NOT NULL DEFAULT 'waiting' CHECK (public_stage IN ('waiting', 'researching', 'generating', 'verifying', 'reserving', 'ready', 'paused', 'failed')),
  candidate_ceiling integer NOT NULL CHECK (candidate_ceiling IN (50, 75, 100)),
  candidates_used integer NOT NULL DEFAULT 0,
  ready_count integer NOT NULL DEFAULT 0,
  themed_ready_count integer NOT NULL DEFAULT 0,
  related_ready_count integer NOT NULL DEFAULT 0,
  last_failure jsonb,
  lease_owner varchar(255),
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_preparation_jobs_game UNIQUE (game_id),
  CONSTRAINT uq_theme_preparation_jobs_id_game UNIQUE (id, game_id),
  CONSTRAINT theme_preparation_jobs_counts CHECK (candidates_used BETWEEN 0 AND candidate_ceiling AND ready_count >= 0 AND themed_ready_count >= 0 AND related_ready_count >= 0 AND themed_ready_count + related_ready_count = ready_count)
);
CREATE INDEX IF NOT EXISTS idx_theme_preparation_jobs_status_lease ON theme_preparation_jobs (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS theme_daily_budgets (
  budget_date date PRIMARY KEY,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  limit_micros integer NOT NULL CHECK (limit_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_date date NOT NULL REFERENCES theme_daily_budgets(budget_date) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'partially_settled', 'settled', 'released', 'expired')),
  reserved_micros integer NOT NULL,
  settled_micros integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_budget_allocations_id_job UNIQUE (id, job_id),
  CONSTRAINT theme_budget_allocations_amounts CHECK (reserved_micros >= 0 AND settled_micros >= 0 AND settled_micros <= reserved_micros)
);
CREATE INDEX IF NOT EXISTS idx_theme_budget_allocations_day_status ON theme_budget_allocations (budget_date, status);
CREATE INDEX IF NOT EXISTS idx_theme_budget_allocations_job ON theme_budget_allocations (job_id);

CREATE TABLE IF NOT EXISTS theme_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id) ON DELETE CASCADE,
  allocation_id uuid,
  sequence integer NOT NULL,
  operation varchar(24) NOT NULL CHECK (operation IN ('research', 'retrieve', 'extract_fact', 'generate', 'review', 'repair', 'embed', 'semantic_check')),
  status varchar(20) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'dispatched', 'succeeded', 'failed', 'unknown', 'canceled')),
  provider varchar(255),
  model varchar(255),
  provider_request_key varchar(255) UNIQUE,
  candidate_slots_consumed integer NOT NULL DEFAULT 0,
  reserved_cost_micros integer NOT NULL DEFAULT 0,
  actual_cost_micros integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  failure jsonb,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_job_attempts_sequence UNIQUE (job_id, sequence),
  CONSTRAINT uq_theme_job_attempts_id_job UNIQUE (id, job_id),
  CONSTRAINT fk_theme_job_attempts_allocation_job FOREIGN KEY (allocation_id, job_id) REFERENCES theme_budget_allocations(id, job_id) ON DELETE RESTRICT,
  CONSTRAINT theme_job_attempts_accounting CHECK (sequence > 0 AND candidate_slots_consumed BETWEEN 0 AND 100 AND reserved_cost_micros >= 0 AND actual_cost_micros >= 0 AND actual_cost_micros <= reserved_cost_micros AND (input_tokens IS NULL OR input_tokens >= 0) AND (output_tokens IS NULL OR output_tokens >= 0))
);
CREATE INDEX IF NOT EXISTS idx_theme_job_attempts_status ON theme_job_attempts (status);

CREATE TABLE IF NOT EXISTS theme_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id) ON DELETE CASCADE,
  attempt_id uuid,
  parent_candidate_id uuid REFERENCES theme_candidates(id) ON DELETE RESTRICT,
  fact_id uuid NOT NULL REFERENCES theme_facts(id) ON DELETE RESTRICT,
  fact_revision_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'accepted', 'rejected', 'duplicate', 'superseded')),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rejection_reasons) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_candidates_job_ordinal UNIQUE (job_id, ordinal),
  CONSTRAINT fk_theme_candidates_attempt_job FOREIGN KEY (attempt_id, job_id) REFERENCES theme_job_attempts(id, job_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_candidates_fact_revision FOREIGN KEY (fact_revision_id, fact_id) REFERENCES theme_fact_revisions(id, fact_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_theme_candidates_job_status ON theme_candidates (job_id, status);

CREATE TABLE IF NOT EXISTS theme_question_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  question_id varchar REFERENCES questions(id) ON DELETE RESTRICT,
  candidate_id uuid REFERENCES theme_candidates(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_question_revisions_id_hash UNIQUE (id, content_hash),
  CONSTRAINT uq_theme_question_revisions_id_question UNIQUE (id, question_id),
  CONSTRAINT uq_theme_question_revisions_question_revision UNIQUE (question_id, revision),
  CONSTRAINT uq_theme_question_revisions_candidate UNIQUE (candidate_id),
  CONSTRAINT theme_question_revisions_owner CHECK ((question_id IS NOT NULL) <> (candidate_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS theme_evidence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version varchar(64) NOT NULL,
  question_revision_id uuid NOT NULL,
  question_content_hash varchar(64) NOT NULL CHECK (question_content_hash ~ '^[a-f0-9]{64}$'),
  review_policy_version varchar(255) NOT NULL,
  reviewer_prompt_version varchar(255) NOT NULL,
  verdict varchar(10) NOT NULL CHECK (verdict IN ('pass', 'flag', 'fail')),
  dimension_results jsonb NOT NULL CHECK (jsonb_typeof(dimension_results) = 'array' AND jsonb_array_length(dimension_results) = 7),
  reviewer_kind varchar(10) NOT NULL CHECK (reviewer_kind IN ('model', 'human')),
  reviewer_model varchar(255),
  reviewed_at timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_evidence_reviews_exact_revision FOREIGN KEY (question_revision_id, question_content_hash) REFERENCES theme_question_revisions(id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT theme_evidence_reviews_reviewer CHECK (reviewer_kind <> 'model' OR reviewer_model IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_theme_evidence_reviews_verdict_expiry ON theme_evidence_reviews (verdict, valid_until);
CREATE INDEX IF NOT EXISTS idx_theme_evidence_reviews_revision_time ON theme_evidence_reviews (question_revision_id, reviewed_at);

CREATE TABLE IF NOT EXISTS theme_evidence_review_facts (
  review_id uuid NOT NULL REFERENCES theme_evidence_reviews(id) ON DELETE RESTRICT,
  fact_revision_id uuid NOT NULL REFERENCES theme_fact_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (review_id, fact_revision_id)
);

CREATE TABLE IF NOT EXISTS theme_evidence_review_passages (
  review_id uuid NOT NULL REFERENCES theme_evidence_reviews(id) ON DELETE RESTRICT,
  passage_id uuid NOT NULL REFERENCES theme_evidence_passages(id) ON DELETE RESTRICT,
  PRIMARY KEY (review_id, passage_id)
);

CREATE TABLE IF NOT EXISTS theme_question_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES theme_game_sessions(id) ON DELETE CASCADE,
  job_id uuid,
  question_id varchar NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  question_revision_id uuid NOT NULL,
  fact_id uuid NOT NULL REFERENCES theme_facts(id) ON DELETE RESTRICT,
  fact_revision_id uuid NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('theme', 'related_backup')),
  status varchar(20) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'selected', 'displayed', 'released', 'expired')),
  corpus_revision integer NOT NULL,
  history_revision integer NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  CONSTRAINT uq_theme_question_reservations_game_question UNIQUE (game_id, question_id),
  CONSTRAINT uq_theme_question_reservations_game_fact UNIQUE (game_id, fact_id),
  CONSTRAINT uq_theme_question_reservations_id_fact UNIQUE (id, fact_id),
  CONSTRAINT fk_theme_question_reservations_job_game FOREIGN KEY (job_id, game_id) REFERENCES theme_preparation_jobs(id, game_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_reservations_question_revision FOREIGN KEY (question_revision_id, question_id) REFERENCES theme_question_revisions(id, question_id) ON DELETE RESTRICT,
  CONSTRAINT fk_theme_question_reservations_fact_revision FOREIGN KEY (fact_revision_id, fact_id) REFERENCES theme_fact_revisions(id, fact_id) ON DELETE RESTRICT,
  CONSTRAINT theme_question_reservations_revisions CHECK (corpus_revision > 0 AND history_revision > 0)
);
CREATE INDEX IF NOT EXISTS idx_theme_question_reservations_status_expiry ON theme_question_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS theme_reservation_participants (
  reservation_id uuid NOT NULL,
  identity_id uuid NOT NULL REFERENCES theme_participant_identities(id) ON DELETE RESTRICT,
  fact_id uuid NOT NULL REFERENCES theme_facts(id) ON DELETE RESTRICT,
  released_at timestamptz,
  PRIMARY KEY (reservation_id, identity_id),
  CONSTRAINT fk_theme_reservation_participants_reservation_fact FOREIGN KEY (reservation_id, fact_id) REFERENCES theme_question_reservations(id, fact_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_reservation_participants_active_fact ON theme_reservation_participants (identity_id, fact_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS theme_question_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES theme_game_sessions(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES theme_participant_identities(id) ON DELETE RESTRICT,
  question_id varchar NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  fact_id uuid REFERENCES theme_facts(id) ON DELETE RESTRICT,
  fact_revision_id uuid,
  display_key varchar(255) NOT NULL,
  displayed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_question_exposures_display UNIQUE (game_id, identity_id, display_key),
  CONSTRAINT fk_theme_question_exposures_fact_revision FOREIGN KEY (fact_revision_id, fact_id) REFERENCES theme_fact_revisions(id, fact_id) ON DELETE RESTRICT,
  CONSTRAINT theme_question_exposures_fact_binding CHECK ((fact_id IS NULL) = (fact_revision_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_theme_question_exposures_identity_time ON theme_question_exposures (identity_id, displayed_at);
CREATE INDEX IF NOT EXISTS idx_theme_question_exposures_identity_fact ON theme_question_exposures (identity_id, fact_id);
CREATE INDEX IF NOT EXISTS idx_theme_question_exposures_identity_game ON theme_question_exposures (identity_id, game_id);

-- Reviews and their exact content/evidence bindings are append-only. New facts,
-- evidence or question text require a new revision and review row.
CREATE OR REPLACE FUNCTION reject_theme_reliability_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; insert a new revision or review', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_question_revisions_immutable ON theme_question_revisions;
CREATE TRIGGER theme_question_revisions_immutable BEFORE UPDATE OR DELETE ON theme_question_revisions FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_documents_immutable ON theme_evidence_documents;
CREATE TRIGGER theme_evidence_documents_immutable BEFORE UPDATE OR DELETE ON theme_evidence_documents FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_passages_immutable ON theme_evidence_passages;
CREATE TRIGGER theme_evidence_passages_immutable BEFORE UPDATE OR DELETE ON theme_evidence_passages FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_facts_immutable ON theme_facts;
CREATE TRIGGER theme_facts_immutable BEFORE UPDATE OR DELETE ON theme_facts FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_fact_revisions_immutable ON theme_fact_revisions;
CREATE TRIGGER theme_fact_revisions_immutable BEFORE UPDATE OR DELETE ON theme_fact_revisions FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_fact_evidence_passages_immutable ON theme_fact_evidence_passages;
CREATE TRIGGER theme_fact_evidence_passages_immutable BEFORE UPDATE OR DELETE ON theme_fact_evidence_passages FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_reviews_immutable ON theme_evidence_reviews;
CREATE TRIGGER theme_evidence_reviews_immutable BEFORE UPDATE OR DELETE ON theme_evidence_reviews FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_review_facts_immutable ON theme_evidence_review_facts;
CREATE TRIGGER theme_evidence_review_facts_immutable BEFORE UPDATE OR DELETE ON theme_evidence_review_facts FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_review_passages_immutable ON theme_evidence_review_passages;
CREATE TRIGGER theme_evidence_review_passages_immutable BEFORE UPDATE OR DELETE ON theme_evidence_review_passages FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
