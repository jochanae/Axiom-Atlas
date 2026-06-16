-- Migration: create blueprints and artifacts tables
-- Run this in the Supabase SQL editor (production database)
-- Note: no FK REFERENCES clauses — add via Supabase dashboard if needed

-- Blueprints
CREATE TABLE IF NOT EXISTS blueprints (
  id                    serial      PRIMARY KEY,
  project_id            integer     NOT NULL,
  user_id               integer     NOT NULL,
  session_id            integer,
  title                 text        NOT NULL,
  content               jsonb       NOT NULL,
  conversation_summary  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blueprints_project_id_idx ON blueprints(project_id);
CREATE INDEX IF NOT EXISTS blueprints_user_id_idx    ON blueprints(user_id);

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id          serial      PRIMARY KEY,
  project_id  integer     NOT NULL,
  user_id     integer     NOT NULL,
  session_id  integer,
  type        text        NOT NULL,
  title       text        NOT NULL,
  content     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'draft',
  pinned      boolean     NOT NULL DEFAULT false,
  parent_id   integer,
  sources     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_project_id_idx ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS artifacts_user_id_idx    ON artifacts(user_id);
