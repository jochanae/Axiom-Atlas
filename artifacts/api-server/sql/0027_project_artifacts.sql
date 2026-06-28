-- Migration: Project Artifacts
-- Run in Supabase SQL editor — review before executing
-- Table: project_artifacts
-- Purpose: versioned log of everything Atlas has generated for a project
--          (design plans, blueprint snapshots, build outputs, visual sketches).

CREATE TABLE IF NOT EXISTS project_artifacts (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        text    NOT NULL
    CHECK (type IN ('design_plan', 'blueprint_snapshot', 'build_output', 'visual_sketch')),
  version     integer NOT NULL DEFAULT 1,
  title       text    NOT NULL,
  metadata    jsonb   NOT NULL DEFAULT '{}',
  payload     jsonb   NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_artifacts_project_id ON project_artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_type       ON project_artifacts(type);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_created_at ON project_artifacts(created_at DESC);
