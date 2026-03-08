CREATE TABLE "admin_roles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by" varchar
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" varchar PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" varchar NOT NULL,
	"question_text" text NOT NULL,
	"correct_answer" text NOT NULL,
	"team_name" text NOT NULL,
	"submitted_answer" text,
	"team_explanation" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolution_note" text,
	"ai_analysis" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"category" varchar NOT NULL,
	"difficulty" varchar(10) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"acceptable_answers" jsonb DEFAULT '[]'::jsonb,
	"explanation" text NOT NULL,
	"pillar" varchar(30) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text,
	"source_name" varchar,
	"status" varchar(20) DEFAULT 'approved' NOT NULL,
	"ai_analysis" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seen_questions" (
	"user_id" varchar NOT NULL,
	"question_id" varchar NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "seen_questions_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seen_questions" ADD CONSTRAINT "seen_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seen_questions" ADD CONSTRAINT "seen_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_seen_questions_user" ON "seen_questions" USING btree ("user_id");