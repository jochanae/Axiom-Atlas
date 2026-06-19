-- Migration: Project Genome & typed Object System
-- Run in Supabase SQL editor

-- 1. Add type column to entries (defaults to 'Decision' for existing rows)
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'Decision';

ALTER TABLE entries
  ADD CONSTRAINT IF NOT EXISTS entries_type_check
  CHECK (type IN ('Idea','Goal','Blocker','Decision','Audience','Feature','Risk','Insight'));

-- 2. Create project_genome table
CREATE TABLE IF NOT EXISTS project_genome (
  id                serial PRIMARY KEY,
  project_id        integer NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  purpose           text,
  core_emotion      text,
  audience          text,
  identity          text,
  constraints       text[] NOT NULL DEFAULT '{}',
  open_questions    text[] NOT NULL DEFAULT '{}',
  stage             text NOT NULL DEFAULT 'Think'
    CHECK (stage IN ('Think','Shape','Decide','Workspace','Strategize','Build','Operate','Evolve')),
  confidence_score  integer NOT NULL DEFAULT 0
    CHECK (confidence_score >= 0 AND confidence_score <= 100),
  last_evolved_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3. Index for fast project lookup
CREATE INDEX IF NOT EXISTS idx_project_genome_project_id ON project_genome(project_id);

-- 4. Seed blank Genome rows for existing projects that don't have one yet
INSERT INTO project_genome (project_id)
SELECT id FROM projects
WHERE id NOT IN (SELECT project_id FROM project_genome)
ON CONFLICT (project_id) DO NOTHING;
