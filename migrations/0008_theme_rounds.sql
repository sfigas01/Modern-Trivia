-- STE-167 (lean MVP): themed games.
-- Add question provenance so on-demand, player-requested themed questions can be
-- labeled at reveal, and a per-room theme for themed game sourcing.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so both the SQL-migration path and the
-- db:push path converge on the same schema, matching migration 0007's approach.

-- Provenance for question rows. Legacy/curated content stays 'curated'; questions
-- generated for a player-chosen theme are persisted as 'player_ai'. player_ai rows
-- are ordinary approved library questions and are NOT excluded from normal play.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'curated';

-- Free-text theme for a room. NULL for ordinary category games (unchanged).
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme varchar(60);
