-- Migration: create blueprints and artifacts tables
-- Run this in the Neon SQL editor (production database)

-- Blueprints
CREATE TABLE IF NOT EXISTS blueprints (
  id          serial      PRIMARY KEY,
  project_id  integer     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     integer     NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  session_id  integer              REFERENCES sessions(id) ON DELETE SET NULL,
  title       text        NOT NULL,
  content     jsonb       NOT NULL,
  conversation_summary text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blueprints_project_id_idx ON blueprints(project_id);
CREATE INDEX IF NOT EXISTS blueprints_user_id_idx    ON blueprints(user_id);

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id          serial      PRIMARY KEY,
  project_id  integer     NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  user_id     integer     NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  session_id  integer              REFERENCES sessions(id)  ON DELETE SET NULL,
  type        text        NOT NULL,
  title       text        NOT NULL,
  content     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'draft',
  pinned      boolean     NOT NULL DEFAULT false,
  parent_id   integer              REFERENCES artifacts(id) ON DELETE SET NULL,
  sources     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_project_id_idx ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS artifacts_user_id_idx    ON artifacts(user_id);
