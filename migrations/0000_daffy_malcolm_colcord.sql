ALTER TABLE IF EXISTS "questions" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'approved';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'questions'
  ) THEN
    UPDATE "questions" SET "status" = 'approved' WHERE "status" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE IF EXISTS "questions" ALTER COLUMN "status" SET DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE IF EXISTS "questions" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "questions" ADD COLUMN IF NOT EXISTS "ai_analysis" jsonb;
