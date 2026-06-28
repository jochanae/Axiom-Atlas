-- Migration: Project ZIP Imports
-- Run in Supabase SQL editor — review before executing
-- Table: project_zip_imports
-- Purpose: stores metadata + file tree for ZIP files imported into a project workspace.
--          One row per project (UNIQUE on project_id).

CREATE TABLE IF NOT EXISTS project_zip_imports (
  id           serial  PRIMARY KEY,
  project_id   integer NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  file_name    text    NOT NULL,
  file_count   integer NOT NULL DEFAULT 0,
  file_tree    jsonb   NOT NULL DEFAULT '[]',
  full_context text,
  imported_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_zip_imports_project_id ON project_zip_imports(project_id);
