-- Missing tables fix — run in Supabase SQL editor
-- These tables were added during sandbox development but never migrated to production.
-- Safe to re-run: all statements use IF NOT EXISTS.

-- 1. application_models — core DNA/genome source of truth
--    Used by: getMultipleProjectDNA() → /api/nexus/resume, /api/portfolio/intelligence
CREATE TABLE IF NOT EXISTS application_models (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL DEFAULT 1,
  identity         JSONB   NOT NULL DEFAULT '{}',
  intent           JSONB   NOT NULL DEFAULT '{}',
  pages            JSONB   NOT NULL DEFAULT '[]',
  components       JSONB   NOT NULL DEFAULT '[]',
  data             JSONB   NOT NULL DEFAULT '{"entities":[],"relationships":[]}',
  logic            JSONB   NOT NULL DEFAULT '[]',
  build_state      JSONB   NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. application_model_history — audit log for AM changes
CREATE TABLE IF NOT EXISTS application_model_history (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_version   INTEGER NOT NULL,
  field_changed   TEXT    NOT NULL,
  previous_value  JSONB,
  new_value       JSONB,
  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. project_dna — design DNA (creative principles, visual sketches, etc.)
CREATE TABLE IF NOT EXISTS project_dna (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  creative_principles JSONB NOT NULL DEFAULT '[]',
  experience_intent   JSONB NOT NULL DEFAULT '{}',
  visual_sketches     JSONB NOT NULL DEFAULT '[]',
  confidence          JSONB NOT NULL DEFAULT '{}',
  status              JSONB NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. design_plans — versioned design plans per project
CREATE TABLE IF NOT EXISTS design_plans (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL DEFAULT 1,
  status       TEXT    NOT NULL DEFAULT 'draft',
  body         JSONB   NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

-- 5. project_artifacts — build outputs and generated assets
CREATE TABLE IF NOT EXISTS project_artifacts (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  title       TEXT    NOT NULL,
  metadata    JSONB   NOT NULL DEFAULT '{}',
  payload     JSONB   NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. project_flow_canvas — flow/node canvas per project
--    Used by: computeProjectIntelligence() → /api/portfolio/intelligence
CREATE TABLE IF NOT EXISTS project_flow_canvas (
  project_id  INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  nodes       JSONB   NOT NULL DEFAULT '[]',
  edges       JSONB   NOT NULL DEFAULT '[]',
  drill_cache JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. readiness_snapshots — historical readiness score log per project
--    Used by: computeProjectReadiness() → /api/portfolio/intelligence
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
