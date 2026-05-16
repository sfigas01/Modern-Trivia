-- Migrate legacy category values to the 6 canonical categories.
-- Source: shared/constants/categories.ts LEGACY_CATEGORY_MAP
-- Idempotent: canonical values are excluded by the WHERE clause, so re-running is safe.
UPDATE "questions"
SET "category" = CASE LOWER("category")
  WHEN 'geography'       THEN 'History & Geography'
  WHEN 'history'         THEN 'History & Geography'
  WHEN 'government'      THEN 'History & Geography'
  WHEN 'science'         THEN 'Science & Nature'
  WHEN 'nature'          THEN 'Science & Nature'
  WHEN 'space'           THEN 'Science & Nature'
  WHEN 'general knowledge' THEN 'Science & Nature'
  WHEN 'sports'          THEN 'Sports'
  WHEN 'entertainment'   THEN 'Entertainment & Pop Culture'
  WHEN 'movies'          THEN 'Entertainment & Pop Culture'
  WHEN 'pop culture'     THEN 'Entertainment & Pop Culture'
  WHEN 'music'           THEN 'Entertainment & Pop Culture'
  WHEN 'food'            THEN 'Food & Culture'
  WHEN 'culture'         THEN 'Food & Culture'
  WHEN 'art'             THEN 'Food & Culture'
  WHEN 'literature'      THEN 'Food & Culture'
  WHEN 'technology'      THEN 'Technology'
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
