CREATE TABLE IF NOT EXISTS question_embeddings (
  question_id varchar PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  purpose text NOT NULL,
  vector jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- db:push can create the table before SQL migrations. Install checks separately
-- so both that path and a fresh migration enforce the same invariants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'question_embeddings'::regclass AND conname = 'question_embeddings_positive_dimensions') THEN
    ALTER TABLE question_embeddings ADD CONSTRAINT question_embeddings_positive_dimensions CHECK (dimensions > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'question_embeddings'::regclass AND conname = 'question_embeddings_vector_array') THEN
    ALTER TABLE question_embeddings ADD CONSTRAINT question_embeddings_vector_array CHECK (jsonb_typeof(vector) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'question_embeddings'::regclass AND conname = 'question_embeddings_vector_length') THEN
    ALTER TABLE question_embeddings ADD CONSTRAINT question_embeddings_vector_length CHECK (
      CASE WHEN jsonb_typeof(vector) = 'array' THEN jsonb_array_length(vector) = dimensions ELSE false END
    );
  END IF;
END $$;
