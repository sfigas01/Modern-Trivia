-- Migrate the remaining legacy category values that 0001 does not cover.
-- These labels exist in the production questions table but were missing from
-- 0001_migrate_legacy_categories.sql, so they survive the 0001 cleanup and would
-- make 0002_category_check_constraint.sql fail on startup ("check constraint
-- violated by some row"), crashing the app before it can serve requests.
--
-- Numbered "0001a" ON PURPOSE so the runner applies it AFTER 0001 but BEFORE 0002.
-- server/lib/migrate.ts sorts filenames lexicographically: "0001_" < "0001a_" <
-- "0002_". The CHECK constraint in 0002 must not run until every legacy value has
-- been normalized to one of the 6 canonical categories.
--
-- Source: shared/constants/categories.ts LEGACY_CATEGORY_MAP
-- Idempotent: canonical values are excluded by the WHERE clause, so re-running is safe.
UPDATE "questions"
SET "category" = CASE LOWER("category")
  WHEN 'baseball'              THEN 'Sports'
  WHEN 'tv shows'             THEN 'Entertainment & Pop Culture'
  WHEN 'harry potter'         THEN 'Entertainment & Pop Culture'
  WHEN 'harry potter universe' THEN 'Entertainment & Pop Culture'
  WHEN 'musical instruments'  THEN 'Entertainment & Pop Culture'
  WHEN 'music history'        THEN 'Entertainment & Pop Culture'
  WHEN 'characters'           THEN 'Entertainment & Pop Culture'
  WHEN 'general'              THEN 'Science & Nature'
  ELSE "category"
END
WHERE "category" NOT IN (
  'History & Geography',
  'Science & Nature',
  'Sports',
  'Entertainment & Pop Culture',
  'Food & Culture',
  'Technology'
);
