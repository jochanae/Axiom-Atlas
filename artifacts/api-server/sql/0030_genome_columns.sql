-- Migration: Extend project_genome with missing columns
-- Run in Supabase SQL editor — review before executing
--
-- Migration 0022 created project_genome with a minimal column set.
-- The sandbox genome schema adds 7 new columns. This adds them safely.
-- All use ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE project_genome
  ADD COLUMN IF NOT EXISTS format            text,
  ADD COLUMN IF NOT EXISTS surface_strategy  text,
  ADD COLUMN IF NOT EXISTS wedge             text,
  ADD COLUMN IF NOT EXISTS differentiator    text,
  ADD COLUMN IF NOT EXISTS stack             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS protected_areas   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_extracted_at timestamptz;
