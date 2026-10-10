-- STE-25 S11A: durable room admission, stable history subjects and account ownership.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme_preparation_game_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_theme_preparation_game_id_theme_game_sessions_id_fk' AND conrelid = 'rooms'::regclass) THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_theme_preparation_game_id_theme_game_sessions_id_fk
      FOREIGN KEY (theme_preparation_game_id) REFERENCES theme_game_sessions(id) ON DELETE RESTRICT;
  END IF;
END $$;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS theme_identity_id uuid
  REFERENCES theme_participant_identities(id) ON DELETE RESTRICT;
ALTER TABLE theme_game_sessions ADD COLUMN IF NOT EXISTS generation_owner_user_id varchar
  REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_game_sessions_active_room
  ON theme_game_sessions(room_id)
  WHERE room_id IS NOT NULL AND status NOT IN ('completed','failed','abandoned','expired');
CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_identity_account
  ON theme_participant_identities(account_user_id) WHERE kind = 'account';

CREATE OR REPLACE FUNCTION protect_theme_generation_owner() RETURNS trigger AS $$
BEGIN
  IF OLD.generation_owner_user_id IS DISTINCT FROM NEW.generation_owner_user_id
    AND OLD.generation_owner_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'theme generation owner is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS theme_generation_owner_immutable ON theme_game_sessions;
CREATE TRIGGER theme_generation_owner_immutable BEFORE UPDATE ON theme_game_sessions
  FOR EACH ROW EXECUTE FUNCTION protect_theme_generation_owner();
