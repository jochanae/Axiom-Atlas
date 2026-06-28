-- Migration: Application Models + History
-- Run in Supabase SQL editor — review before executing
-- Tables: application_models, application_model_history

CREATE TABLE IF NOT EXISTS application_models (
  id            serial PRIMARY KEY,
  project_id    integer NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  version       integer NOT NULL DEFAULT 1,
  identity      jsonb   NOT NULL DEFAULT '{}',
  intent        jsonb   NOT NULL DEFAULT '{}',
  pages         jsonb   NOT NULL DEFAULT '[]',
  components    jsonb   NOT NULL DEFAULT '[]',
  data          jsonb   NOT NULL DEFAULT '{"entities":[],"relationships":[]}',
  logic         jsonb   NOT NULL DEFAULT '[]',
  build_state   jsonb   NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_models_project_id ON application_models(project_id);

CREATE TABLE IF NOT EXISTS application_model_history (
  id              serial PRIMARY KEY,
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_version   integer NOT NULL,
  field_changed   text    NOT NULL,
  previous_value  jsonb,
  new_value       jsonb,
  reason          text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_model_history_project_id ON application_model_history(project_id);
CREATE INDEX IF NOT EXISTS idx_application_model_history_changed_at  ON application_model_history(changed_at DESC);
