-- Atlas schema restore script
-- Safe to run on Supabase — uses CREATE TABLE IF NOT EXISTS throughout.
-- Existing tables and data are NOT touched.
-- Run this in the Supabase SQL editor.

-- 1. users
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id   TEXT UNIQUE,
  name        TEXT,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'user',
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  reset_token TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  memory      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. user_sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. projects
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'committed',
  entity_type     TEXT NOT NULL DEFAULT 'project',
  memory          TEXT,
  preview_url     TEXT,
  github_token    TEXT,
  linked_repo     TEXT,
  node_state      JSONB DEFAULT '{}',
  push_history    JSONB DEFAULT '[]',
  commit_synthesis JSONB,
  shape           JSONB NOT NULL DEFAULT '{"identity":[],"constraints":[],"formats":[]}',
  last_handover_at    TIMESTAMPTZ,
  last_handover_hash  TEXT,
  last_opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  mode                TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  reflection_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  idea_mode           BOOLEAN NOT NULL DEFAULT FALSE,
  message_count       INTEGER NOT NULL DEFAULT 0,
  total_input_tokens  INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd      NUMERIC DEFAULT 0,
  total_execution_ms  INTEGER DEFAULT 0,
  run_status          TEXT,
  run_summary         TEXT,
  run_actions         JSONB,
  run_artifacts       JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. entries (decision ledger)
CREATE TABLE IF NOT EXISTS entries (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id          INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'committed',
  title               TEXT NOT NULL,
  summary             TEXT,
  details             TEXT,
  severity            TEXT NOT NULL DEFAULT 'committed',
  verb                TEXT,
  build_id            TEXT,
  touched             TEXT[],
  is_violation        BOOLEAN NOT NULL DEFAULT FALSE,
  cost_of_lesson      NUMERIC,
  deviation           BOOLEAN NOT NULL DEFAULT FALSE,
  deviation_reason    TEXT,
  catch_against_id    INTEGER,
  supersedes_id       INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  card_schema_version INTEGER DEFAULT 1,
  locked_at           TIMESTAMPTZ,
  mode                TEXT,
  source_message_id   INTEGER,
  context_what        TEXT,
  context_why         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  intent_type       TEXT,
  catch_payload     JSONB,
  execution_time_ms INTEGER,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_usd          NUMERIC(10,5),
  run_status        TEXT,
  run_summary       TEXT,
  run_actions       JSONB,
  run_artifacts     JSONB,
  image_b64         TEXT,
  image_mime_type   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. nexus_messages
CREATE TABLE IF NOT EXISTS nexus_messages (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  session_id      INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  conversation_id TEXT,
  message_type    TEXT DEFAULT 'message',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. thoughts
CREATE TABLE IF NOT EXISTS thoughts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. vault
CREATE TABLE IF NOT EXISTS vault (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  project_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  entry_count  INTEGER NOT NULL DEFAULT 0,
  tags         TEXT[],
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. gallery_images
CREATE TABLE IF NOT EXISTS gallery_images (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  project_id  INTEGER REFERENCES projects(id),
  object_path TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 11. connections
CREATE TABLE IF NOT EXISTS connections (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  label           TEXT NOT NULL,
  url             TEXT,
  token           TEXT,
  metadata        JSONB,
  status          TEXT NOT NULL DEFAULT 'linked',
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. secrets
CREATE TABLE IF NOT EXISTS secrets (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  project_name    TEXT NOT NULL DEFAULT 'General',
  label           TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. blueprints
CREATE TABLE IF NOT EXISTS blueprints (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id           INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  content              JSONB NOT NULL,
  conversation_summary TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. generation_runs
CREATE TABLE IF NOT EXISTS generation_runs (
  id             TEXT PRIMARY KEY,
  project_id     INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  prompt         TEXT NOT NULL,
  intent         TEXT NOT NULL,
  model          TEXT NOT NULL,
  status         TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ,
  duration_ms    INTEGER,
  files_changed  INTEGER NOT NULL DEFAULT 0,
  lines_added    INTEGER NOT NULL DEFAULT 0,
  lines_removed  INTEGER NOT NULL DEFAULT 0,
  summary        TEXT NOT NULL DEFAULT '',
  commit_sha     TEXT,
  pushed_to_branch TEXT
);

-- 15. generated_files
CREATE TABLE IF NOT EXISTS generated_files (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  path             TEXT NOT NULL,
  language         TEXT NOT NULL,
  bytes            INTEGER NOT NULL,
  lines            INTEGER NOT NULL,
  content          TEXT NOT NULL,
  previous_content TEXT,
  status           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);

-- 16. artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id  INTEGER REFERENCES artifacts(id) ON DELETE SET NULL,
  sources    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. scheduled_checks
CREATE TABLE IF NOT EXISTS scheduled_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 1440,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at  TIMESTAMPTZ,
  next_check_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. check_results
CREATE TABLE IF NOT EXISTS check_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES scheduled_checks(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  http_status INTEGER,
  is_healthy  BOOLEAN NOT NULL,
  issues      TEXT[] NOT NULL DEFAULT '{}',
  analysis    TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. image_versions
CREATE TABLE IF NOT EXISTS image_versions (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id        INTEGER,
  parent_version_id INTEGER,
  prompt            TEXT NOT NULL,
  image_b64         TEXT NOT NULL,
  image_mime_type   TEXT NOT NULL DEFAULT 'image/png',
  model             TEXT,
  mode              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. mcp_connections
CREATE TABLE IF NOT EXISTS mcp_connections (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  token      TEXT,
  tools      JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. project_flow_canvas
CREATE TABLE IF NOT EXISTS project_flow_canvas (
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  nodes      JSONB NOT NULL DEFAULT '[]',
  edges      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. project_forge_state
CREATE TABLE IF NOT EXISTS project_forge_state (
  project_id   INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  forged_at    TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 23. atlas_self_map
CREATE TABLE IF NOT EXISTS atlas_self_map (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  map_json   TEXT NOT NULL,
  file_count INTEGER NOT NULL
);

-- 24. atlas_incidents
CREATE TABLE IF NOT EXISTS atlas_incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_id        TEXT NOT NULL,
  files_changed     TEXT[] NOT NULL,
  commit_message    TEXT NOT NULL,
  branch_name       TEXT NOT NULL,
  pr_url            TEXT NOT NULL,
  validation_passed BOOLEAN NOT NULL DEFAULT FALSE,
  confidence        TEXT,
  blast_radius      TEXT,
  reasoning         TEXT,
  outcome           TEXT,
  notes             TEXT
);

-- 25. atlas_error_logs
CREATE TABLE IF NOT EXISTS atlas_error_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT NOT NULL,
  stack_trace   TEXT,
  route         TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  project_id    TEXT NOT NULL
);

-- 26. readiness_snapshots
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 27. invites
CREATE TABLE IF NOT EXISTS invites (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  token          TEXT NOT NULL UNIQUE,
  invited_by_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at    TIMESTAMPTZ
);

-- 28. admin_notes
CREATE TABLE IF NOT EXISTS admin_notes (
  id         SERIAL PRIMARY KEY,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 29. error_logs
CREATE TABLE IF NOT EXISTS error_logs (
  id             SERIAL PRIMARY KEY,
  message        TEXT NOT NULL,
  stack          TEXT,
  url            TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  context        TEXT,
  resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  admin_response TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 30. conversations
CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 31. home_conversations
CREATE TABLE IF NOT EXISTS home_conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  messages   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 32. messages (references conversations)
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
