-- Migration: Design Plans
-- Run in Supabase SQL editor — review before executing
-- Table: design_plans
-- Purpose: versioned visual + interaction design briefs per project.
-- Lifecycle: draft → proposed → committed. Multiple versions per project allowed.

CREATE TABLE IF NOT EXISTS design_plans (
  id           serial PRIMARY KEY,
  project_id   integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version      integer NOT NULL DEFAULT 1,
  status       text    NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'proposed', 'committed')),
  body         jsonb   NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_design_plans_project_id  ON design_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_design_plans_status      ON design_plans(status);
