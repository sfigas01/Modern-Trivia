-- STE-199: Add DB-level CHECK constraint on questions.category
-- Prerequisite: migration 0001_migrate_legacy_categories.sql (STE-198) must have run first
-- to normalize all legacy category strings to the canonical 6 values.
-- Running this migration before STE-198 will fail if any non-canonical rows exist.
--
-- Idempotent: the DO block skips the ALTER TABLE if the constraint already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'questions'
      AND constraint_name = 'questions_category_check'
  ) THEN
    ALTER TABLE "questions"
      ADD CONSTRAINT "questions_category_check"
      CHECK (
        "category" IN (
          'History & Geography',
          'Science & Nature',
          'Sports',
          'Entertainment & Pop Culture',
          'Food & Culture',
          'Technology'
        )
      );
  END IF;
END $$;
