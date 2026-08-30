-- STE-273: room-wide seen-question tracking for multiplayer selection.
-- Capture each player's identity/history on their row so question selection at
-- room start can union every participant's seen history, not just the host's.
-- Both columns are additive and nullable, so existing rooms/players stay valid.
--
--   user_id        - authenticated user id for signed-in players (null for guests)
--   guest_seen_ids - snapshot of a guest's locally-seen question ids at join time
ALTER TABLE IF EXISTS "room_players"
  ADD COLUMN IF NOT EXISTS "user_id" varchar;
--> statement-breakpoint
ALTER TABLE IF EXISTS "room_players"
  ADD COLUMN IF NOT EXISTS "guest_seen_ids" text[];
