CREATE TABLE IF NOT EXISTS question_embeddings (
  question_id varchar PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  purpose text NOT NULL,
  vector jsonb NOT NULL CHECK (jsonb_typeof(vector) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_array_length(vector) = dimensions)
);
