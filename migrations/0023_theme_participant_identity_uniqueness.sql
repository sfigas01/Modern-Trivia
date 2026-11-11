-- Repair databases where the reliability foundation table predated migration 0009.
-- In those databases CREATE TABLE IF NOT EXISTS could not add the table-level
-- constraint, leaving identity upserts without a conflict arbiter.
--
-- Fresh databases already have an index with this name from the original UNIQUE
-- constraint, so this is a no-op there. If historical duplicate rows exist, the
-- migration fails without changing data instead of choosing an identity to delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_participant_identities_kind_hash
  ON theme_participant_identities (kind, stable_key_hash);
