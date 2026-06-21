CREATE TYPE "public"."room_status" AS ENUM ('lobby', 'active', 'finished', 'abandoned');
--> statement-breakpoint
CREATE TYPE "public"."room_phase" AS ENUM ('LOBBY', 'QUESTION', 'REVEAL', 'ROUND_SCORE', 'GAME_OVER');
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(5) NOT NULL,
	"status" "room_status" DEFAULT 'lobby' NOT NULL,
	"phase" "room_phase" DEFAULT 'LOBBY' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"host_player_id" uuid,
	"category" varchar(80) NOT NULL,
	"num_rounds" integer NOT NULL,
	"question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_question_index" integer DEFAULT 0 NOT NULL,
	"active_player_id" uuid,
	"current_attempt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "room_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"nickname" varchar(20) NOT NULL,
	"token" varchar(128) NOT NULL,
	"join_order" integer NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"last_round_delta" integer DEFAULT 0 NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "room_players_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_player_id_room_players_id_fk" FOREIGN KEY ("host_player_id") REFERENCES "public"."room_players"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_active_player_id_room_players_id_fk" FOREIGN KEY ("active_player_id") REFERENCES "public"."room_players"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_room_players_room" ON "room_players" USING btree ("room_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_room_players_room_nickname_ci" ON "room_players" USING btree ("room_id", lower("nickname"));
