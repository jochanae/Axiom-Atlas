-- Migration: Project DNA
-- Run in Supabase SQL editor — review before executing
-- Table: project_dna
-- Purpose: stores creative principles, experience intent, and visual sketches per project.
-- One row per project (UNIQUE on project_id).

CREATE TABLE IF NOT EXISTS project_dna (
  id                    serial PRIMARY KEY,
  project_id            integer NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  creative_principles   jsonb   NOT NULL DEFAULT '[]',
  experience_intent     jsonb   NOT NULL DEFAULT '{}',
  visual_sketches       jsonb   NOT NULL DEFAULT '[]',
  confidence            jsonb   NOT NULL DEFAULT '{}',
  status                jsonb   NOT NULL DEFAULT '{}',
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_dna_project_id ON project_dna(project_id);
