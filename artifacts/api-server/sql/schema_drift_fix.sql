-- Schema drift fix — run in Supabase SQL editor BEFORE deploying staging to production.
-- All statements use IF NOT EXISTS / safe defaults so re-running is harmless.
-- This adds columns that exist in the Drizzle schema but are missing from the live DB.
-- Without these, db.select().from(table) throws "column does not exist" on every query.

-- ─── entries ─────────────────────────────────────────────────────────────────
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS context_what      text,
  ADD COLUMN IF NOT EXISTS context_why       text,
  ADD COLUMN IF NOT EXISTS enrichment_json   jsonb,
  ADD COLUMN IF NOT EXISTS am_field          text;

-- ─── projects ────────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS forged_at             timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS project_type          text,
  ADD COLUMN IF NOT EXISTS app_build_succeeded   boolean,
  ADD COLUMN IF NOT EXISTS app_source_file_count integer;

-- ─── nexus_messages ──────────────────────────────────────────────────────────
ALTER TABLE nexus_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ─── sessions ────────────────────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS build_intent jsonb;

-- ─── project_flow_canvas ─────────────────────────────────────────────────────
ALTER TABLE project_flow_canvas
  ADD COLUMN IF NOT EXISTS drill_cache jsonb;
