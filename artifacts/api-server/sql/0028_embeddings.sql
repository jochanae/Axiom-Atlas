-- Migration: Vector Embeddings
-- Run in Supabase SQL editor — review before executing
-- Table: embeddings
--
-- ⚠️  REQUIRES pgvector extension.
-- Enable it first in Supabase: Database → Extensions → search "vector" → enable.
-- If already enabled, the CREATE EXTENSION line is safe to run again (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
  id           serial  PRIMARY KEY,
  entity_type  text    NOT NULL,
  entity_id    integer NOT NULL,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   integer,
  content      text    NOT NULL,
  embedding    vector(1536),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS embeddings_entity_uniq
  ON embeddings(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_id    ON embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_project_id ON embeddings(project_id);

-- Optional: IVFFlat index for approximate nearest-neighbor search.
-- Only create this after the table has ≥1000 rows, otherwise it hurts performance.
-- Run manually when ready:
--   CREATE INDEX embeddings_ivfflat_idx ON embeddings
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
