-- Add the persisted contract for optional multiplayer dispute voting.
-- All changes are additive and keep legacy solo dispute rows valid.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'room_phase'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.room_phase'::regtype
      AND enumlabel = 'DISPUTE_VOTE'
  ) THEN
    ALTER TYPE "public"."room_phase" ADD VALUE 'DISPUTE_VOTE';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."dispute_outcome" AS ENUM ('approved', 'rejected', 'tied', 'expired', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE IF EXISTS "rooms"
  ADD COLUMN IF NOT EXISTS "opponent_dispute_voting_enabled" boolean DEFAULT false;
--> statement-breakpoint
UPDATE "rooms"
SET "opponent_dispute_voting_enabled" = false
WHERE "opponent_dispute_voting_enabled" IS NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "rooms"
  ALTER COLUMN "opponent_dispute_voting_enabled" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "rooms"
  ALTER COLUMN "opponent_dispute_voting_enabled" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "rooms"
  ADD COLUMN IF NOT EXISTS "active_dispute_id" varchar(255);
--> statement-breakpoint
ALTER TABLE IF EXISTS "rooms"
  ADD COLUMN IF NOT EXISTS "current_dispute_vote" jsonb;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "room_id" uuid;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "room_code" varchar(5);
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "attempt_key" varchar(255);
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "disputing_player_id" uuid;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "disputing_player_name" varchar(20);
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "voting_enabled" boolean DEFAULT false;
--> statement-breakpoint
UPDATE "disputes"
SET "voting_enabled" = false
WHERE "voting_enabled" IS NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ALTER COLUMN "voting_enabled" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ALTER COLUMN "voting_enabled" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "eligible_voter_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "threshold" integer;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "outcome" "public"."dispute_outcome";
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "original_points_delta" integer;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "final_points_delta" integer;
--> statement-breakpoint
ALTER TABLE IF EXISTS "disputes"
  ADD COLUMN IF NOT EXISTS "decided_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_disputes_attempt_key"
  ON "disputes" USING btree ("attempt_key")
  WHERE "attempt_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispute_ballots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" varchar(255) NOT NULL,
  "voter_player_id" uuid NOT NULL,
  "voter_player_name" varchar(20) NOT NULL,
  "approve" boolean NOT NULL,
  "cast_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dispute_ballots_dispute"
  ON "dispute_ballots" USING btree ("dispute_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispute_ballots_dispute_voter"
  ON "dispute_ballots" USING btree ("dispute_id", "voter_player_id");
