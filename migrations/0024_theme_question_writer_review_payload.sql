-- STE-303: preserve the structured writer decision for owner-attended human evaluation.
ALTER TABLE theme_question_generation_outcomes
  ADD COLUMN IF NOT EXISTS writer_output jsonb;

ALTER TABLE theme_candidates
  ADD COLUMN IF NOT EXISTS qa_review jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'theme_question_generation_outcome_writer_output'
      AND conrelid = 'theme_question_generation_outcomes'::regclass
  ) THEN
    ALTER TABLE theme_question_generation_outcomes
      ADD CONSTRAINT theme_question_generation_outcome_writer_output
      CHECK (writer_output IS NULL OR jsonb_typeof(writer_output) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'theme_candidates_qa_review_object'
      AND conrelid = 'theme_candidates'::regclass
  ) THEN
    ALTER TABLE theme_candidates
      ADD CONSTRAINT theme_candidates_qa_review_object
      CHECK (qa_review IS NULL OR jsonb_typeof(qa_review) = 'object');
  END IF;
END $$;
