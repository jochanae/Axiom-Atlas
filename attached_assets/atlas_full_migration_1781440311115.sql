-- ============================================
-- FILE: 20260427214204_35604537-9f14-4e4e-9e52-356bc556afa2.sql
-- ============================================

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Superseded','Violated')),
  cost_of_lesson numeric,
  is_violation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bought_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_decision_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  financial_cost numeric,
  time_cost numeric,
  description text
);

CREATE INDEX idx_ledger_entries_project ON public.ledger_entries(project_id);
CREATE INDEX idx_ledger_entries_created ON public.ledger_entries(created_at DESC);
CREATE INDEX idx_bought_lessons_decision ON public.bought_lessons(linked_decision_id);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bought_lessons ENABLE ROW LEVEL SECURITY;

-- Phase 1: single-operator system, open access (no auth scope per Phase 1 spec)
CREATE POLICY "public_all_projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_ledger" ON public.ledger_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_lessons" ON public.bought_lessons FOR ALL USING (true) WITH CHECK (true);


-- ============================================
-- FILE: 20260428002443_edd5f0d9-125c-4c4c-bfa7-916fd281783d.sql
-- ============================================

-- ============ updated_at helper ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Add user_id to phase 1 tables ============
ALTER TABLE public.projects ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_entries ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.bought_lessons ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old public policies
DROP POLICY IF EXISTS public_all_projects ON public.projects;
DROP POLICY IF EXISTS public_all_ledger ON public.ledger_entries;
DROP POLICY IF EXISTS public_all_lessons ON public.bought_lessons;

-- Owner-only policies
CREATE POLICY "projects_owner_all" ON public.projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ledger_owner_all" ON public.ledger_entries FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lessons_owner_all" ON public.bought_lessons FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Make user_id required going forward (existing rows will be cleared by signup; phase 1 had no auth)
DELETE FROM public.bought_lessons;
DELETE FROM public.ledger_entries;
DELETE FROM public.projects;
ALTER TABLE public.projects ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.ledger_entries ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.bought_lessons ALTER COLUMN user_id SET NOT NULL;

-- ============ sessions ============
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New session',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_owner_all" ON public.sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX sessions_project_idx ON public.sessions(project_id);

-- ============ workspace_nodes ============
CREATE TABLE public.workspace_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nodes_owner_all" ON public.workspace_nodes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER nodes_updated_at BEFORE UPDATE ON public.workspace_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX nodes_session_idx ON public.workspace_nodes(session_id);
CREATE INDEX nodes_project_idx ON public.workspace_nodes(project_id);

-- ============ recommendations ============
CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  definition TEXT,
  benefit TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recs_owner_all" ON public.recommendations FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX recs_session_idx ON public.recommendations(session_id);

-- ============ chat_messages ============
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  intent_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msgs_owner_all" ON public.chat_messages FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX msgs_session_idx ON public.chat_messages(session_id, created_at);

-- ============ Auto-create profile + default project on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.projects (user_id, name, status)
  VALUES (NEW.id, 'First Project', 'Active');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================
-- FILE: 20260428002509_6b410806-e6cd-4f6a-9390-5662e8a2e293.sql
-- ============================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;


-- ============================================
-- FILE: 20260429160122_caf09932-44e9-4aec-aa24-ab3cd8772962.sql
-- ============================================
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS mode text DEFAULT 'think';

-- ============================================
-- FILE: 20260429172323_b5ff217f-ea20-492f-b021-c243e7a08a76.sql
-- ============================================
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS extracted_from_session_id uuid REFERENCES public.sessions(id) NULL;

-- ============================================
-- FILE: 20260429201143_a4b2b7af-e0ea-4d96-a1c6-397b030ffd75.sql
-- ============================================
CREATE TABLE IF NOT EXISTS public.parked_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  label text NOT NULL,
  source_context text,
  kind text CHECK (kind IN ('term','suggestion','decision','tool','other')) DEFAULT 'other',
  status text CHECK (status IN ('parked','resolved','dismissed')) DEFAULT 'parked',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.parked_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parked_items_owner_all" ON public.parked_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_parked_items_user_status ON public.parked_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_parked_items_session ON public.parked_items(session_id);

-- ============================================
-- FILE: 20260429222739_ff117fc2-1c09-4557-b953-e1f8559b88a6.sql
-- ============================================
CREATE TABLE public.knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  slug text NOT NULL UNIQUE,
  category text NOT NULL,
  one_liner text NOT NULL,
  why_it_comes_up text,
  what_it_means text,
  reversibility text,
  reversibility_label text,
  common_mistake text,
  what_to_do_next text,
  frequency text,
  status text NOT NULL DEFAULT 'seeded',
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all entries (shared knowledge base)
CREATE POLICY "knowledge_entries_read_authenticated"
  ON public.knowledge_entries
  FOR SELECT
  TO authenticated
  USING (true);

-- No client-side write policies; seeding/curation happens via service role
CREATE INDEX idx_knowledge_entries_category ON public.knowledge_entries(category);
CREATE INDEX idx_knowledge_entries_slug ON public.knowledge_entries(slug);

-- ============================================
-- FILE: 20260430025530_60c8e2d8-42e3-4020-b784-d6c5ba88f63a.sql
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.project_compass (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  audience TEXT,
  aesthetics TEXT,
  seed_material TEXT,
  has_attachment BOOLEAN NOT NULL DEFAULT false,
  attachment_hint TEXT,
  compass_md TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_compass ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compass_owner_all"
ON public.project_compass
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_project_compass_project ON public.project_compass(project_id);

CREATE TRIGGER update_project_compass_updated_at
BEFORE UPDATE ON public.project_compass
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- FILE: 20260430031938_46330c7a-ddc0-4616-9f10-a754fa7df47f.sql
-- ============================================
ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS recommendations_project_kind_status_idx
  ON public.recommendations (project_id, kind, status);

-- ============================================
-- FILE: 20260430120600_b4115bf0-9906-4c3a-8f63-1473a0f102e4.sql
-- ============================================
-- CommitCard data foundation

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS committed_card_id uuid REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_payload jsonb,
  ADD COLUMN IF NOT EXISTS card_schema_version integer;

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'committed',
  ADD COLUMN IF NOT EXISTS verb text,
  ADD COLUMN IF NOT EXISTS build_id text,
  ADD COLUMN IF NOT EXISTS card_schema_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_severity_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_severity_check
  CHECK (severity IN ('blocker', 'parked', 'committed', 'neutral'));

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_verb_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_verb_check
  CHECK (verb IS NULL OR verb IN ('new', 'bug', 'perf', 'note', 'wip', 'audit', 'merge'));

ALTER TABLE public.parked_items
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'parked',
  ADD COLUMN IF NOT EXISTS verb text,
  ADD COLUMN IF NOT EXISTS card_schema_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.parked_items
  DROP CONSTRAINT IF EXISTS parked_items_severity_check;
ALTER TABLE public.parked_items
  ADD CONSTRAINT parked_items_severity_check
  CHECK (severity IN ('blocker', 'parked', 'committed', 'neutral'));

ALTER TABLE public.parked_items
  DROP CONSTRAINT IF EXISTS parked_items_verb_check;
ALTER TABLE public.parked_items
  ADD CONSTRAINT parked_items_verb_check
  CHECK (verb IS NULL OR verb IN ('new', 'bug', 'perf', 'note', 'wip', 'audit', 'merge'));

CREATE INDEX IF NOT EXISTS chat_messages_committed_card_idx
  ON public.chat_messages(committed_card_id)
  WHERE committed_card_id IS NOT NULL;

-- ============================================
-- FILE: 20260430122839_a91ea333-3067-4d33-b2f0-5bb027920cf0.sql
-- ============================================
-- Unified Entries table — single source of truth for both Ledger and Parking Lot.
-- Ledger view = filter status='committed'. Parking Lot view = filter status='parked'.
-- Reopen creates a new draft entry linked back via supersedes_id; original stays locked.

CREATE TABLE public.entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid,

  -- The single discriminator. status is the only thing that decides view.
  status text NOT NULL DEFAULT 'parked', -- 'committed' | 'parked' | 'draft' | 'archived'

  -- Card payload fields (mirror CommitCard v1)
  title text NOT NULL,
  summary text,
  details text,
  severity text NOT NULL DEFAULT 'parked', -- RAG: blocker | parked | committed | neutral
  verb text, -- new | bug | perf | note | wip | audit | merge | plan
  build_id text,
  touched jsonb,

  -- Provenance + audit trail
  source_message_id uuid,            -- chat_messages.id that produced this entry
  card_schema_version integer NOT NULL DEFAULT 1,
  is_violation boolean NOT NULL DEFAULT false,
  cost_of_lesson numeric,

  -- Reopen lineage: a reopened entry references the locked original.
  supersedes_id uuid REFERENCES public.entries(id) ON DELETE SET NULL,

  -- Lock flag — once committed, the row is immutable except for status->archived.
  locked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entries_status_chk CHECK (status IN ('committed','parked','draft','archived')),
  CONSTRAINT entries_severity_chk CHECK (severity IN ('blocker','parked','committed','neutral'))
);

CREATE INDEX entries_user_status_idx ON public.entries(user_id, status, created_at DESC);
CREATE INDEX entries_project_status_idx ON public.entries(project_id, status);

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY entries_owner_all ON public.entries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER entries_set_updated_at
  BEFORE UPDATE ON public.entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce immutability on locked (committed) rows.
-- Only status->archived and updated_at are allowed to change after lock.
CREATE OR REPLACE FUNCTION public.entries_enforce_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Allow archiving and timestamp tick only.
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.details IS DISTINCT FROM OLD.details
       OR NEW.severity IS DISTINCT FROM OLD.severity
       OR NEW.verb IS DISTINCT FROM OLD.verb
       OR NEW.build_id IS DISTINCT FROM OLD.build_id
       OR NEW.touched IS DISTINCT FROM OLD.touched
       OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
       OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'Entry % is locked (committed). Reopen it to create a new draft instead of editing.', OLD.id;
    END IF;
    -- Only status transitions committed -> archived are allowed on a locked row.
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'Locked entry % can only be archived. Use Reopen to create a successor.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entries_lock_guard
  BEFORE UPDATE ON public.entries
  FOR EACH ROW
  EXECUTE FUNCTION public.entries_enforce_lock();

-- Auto-stamp locked_at when status flips to 'committed'
CREATE OR REPLACE FUNCTION public.entries_stamp_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'committed' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entries_stamp_lock_trg
  BEFORE INSERT OR UPDATE ON public.entries
  FOR EACH ROW
  EXECUTE FUNCTION public.entries_stamp_lock();

-- Backfill from ledger_entries -> committed entries
INSERT INTO public.entries (
  id, user_id, project_id, session_id, status, title, summary, details,
  severity, verb, build_id, source_message_id, card_schema_version,
  is_violation, cost_of_lesson, locked_at, created_at, updated_at
)
SELECT
  le.id,
  le.user_id,
  le.project_id,
  le.extracted_from_session_id,
  'committed',
  le.title,
  COALESCE(le.description, ''),
  NULL,
  COALESCE(NULLIF(le.severity, ''), 'committed'),
  le.verb,
  le.build_id,
  NULL,
  COALESCE(le.card_schema_version, 1),
  COALESCE(le.is_violation, false),
  le.cost_of_lesson,
  le.created_at,
  le.created_at,
  le.created_at
FROM public.ledger_entries le
ON CONFLICT (id) DO NOTHING;

-- Backfill from parked_items -> parked entries
INSERT INTO public.entries (
  id, user_id, project_id, session_id, status, title, summary, details,
  severity, verb, card_schema_version, created_at, updated_at
)
SELECT
  pi.id,
  pi.user_id,
  COALESCE(pi.project_id, (SELECT id FROM public.projects WHERE user_id = pi.user_id ORDER BY created_at LIMIT 1)),
  pi.session_id,
  'parked',
  pi.label,
  COALESCE(pi.source_context, ''),
  NULL,
  COALESCE(NULLIF(pi.severity, ''), 'parked'),
  pi.verb,
  COALESCE(pi.card_schema_version, 1),
  pi.created_at,
  pi.created_at
FROM public.parked_items pi
WHERE pi.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Mark old tables as legacy (read-only). We keep them dormant for one release.
COMMENT ON TABLE public.ledger_entries IS 'LEGACY (read-only). Migrated to public.entries with status=committed. Do not write.';
COMMENT ON TABLE public.parked_items IS 'LEGACY (read-only). Migrated to public.entries with status=parked. Do not write.';

-- Tighten chat_messages.committed_card_id to point at entries (it already is uuid; just document)
COMMENT ON COLUMN public.chat_messages.committed_card_id IS 'References public.entries.id when this AI turn has been committed/parked into an entry.';


-- ============================================
-- FILE: 20260430141028_2c802ee8-2c5d-4a35-8433-aa58c882b974.sql
-- ============================================
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS surfaced_memories jsonb;

-- ============================================
-- FILE: 20260430161124_00a31ffe-2500-4836-9ba8-efedc8e19883.sql
-- ============================================
-- Storage bucket for user-attached files
INSERT INTO storage.buckets (id, name, public) VALUES ('project-assets', 'project-assets', true);

-- RLS policies for the bucket: users can only access their own folder
CREATE POLICY "Users can view own project assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own project assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own project assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Table to track AI-generated code files
CREATE TABLE public.generated_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid,
  filename text NOT NULL,
  language text NOT NULL DEFAULT 'tsx',
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  parent_id uuid REFERENCES public.generated_files(id),
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generated_files_owner_all" ON public.generated_files
FOR ALL USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_generated_files_updated_at
BEFORE UPDATE ON public.generated_files
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_generated_files_project ON public.generated_files(project_id, status);
CREATE INDEX idx_generated_files_session ON public.generated_files(session_id);

-- ============================================
-- FILE: 20260430172847_909bc7fd-daa1-4028-9d70-5e8ee98e35f1.sql
-- ============================================

-- Collaboration: project invitations and comments
CREATE TABLE public.project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'editor',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_owner_all" ON public.project_invitations
  FOR ALL TO public
  USING (auth.uid() = invited_by)
  WITH CHECK (auth.uid() = invited_by);

CREATE TABLE public.session_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_owner_all" ON public.session_comments
  FOR ALL TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_comments;


-- ============================================
-- FILE: 20260430221943_40cfe484-da89-4e28-a2f6-a59fe0fdeeea.sql
-- ============================================
ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS mode text DEFAULT NULL;

-- ============================================
-- FILE: 20260430230701_95d06575-a42f-4260-862e-754fc2a80c15.sql
-- ============================================
CREATE TABLE public.build_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL,
  session_id UUID,
  state TEXT NOT NULL DEFAULT 'idle',
  label TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.build_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "build_states_owner_all"
ON public.build_states
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_build_states_session ON public.build_states (session_id, created_at DESC);
CREATE INDEX idx_build_states_project ON public.build_states (project_id, created_at DESC);

-- ============================================
-- FILE: 20260501004309_4e25b530-cb6f-41e7-8017-817bf08a3b10.sql
-- ============================================
ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS output_guard_violation text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS output_guard_repaired boolean DEFAULT false;

-- ============================================
-- FILE: 20260502001643_346ca432-61ae-4e3b-9b7f-3005f9d0c95c.sql
-- ============================================

-- Decision Catch Engine — Phase A schema additions

-- 1) Entries: deviation tracking + catch linkage
ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS deviation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deviation_reason TEXT,
  ADD COLUMN IF NOT EXISTS catch_against_id UUID;

CREATE INDEX IF NOT EXISTS entries_catch_against_idx
  ON public.entries(catch_against_id)
  WHERE catch_against_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entries_deviation_idx
  ON public.entries(user_id, deviation)
  WHERE deviation = true;

-- 2) chat_messages: carry the structured catch payload alongside prose
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS decision_catch JSONB;

-- The locked-row trigger on entries already guards mutations after locked_at.
-- Deviation/catch fields are intentionally outside that guard list — they
-- describe the *relationship* between entries, not the entry's own decision.
-- The existing entries_enforce_lock() trigger explicitly enumerates which
-- columns are protected; the new columns are not in that list and so are
-- safely mutable on locked rows (needed when a successor proceeds-anyway
-- and we set the original's relationship metadata).


-- ============================================
-- FILE: 20260502003739_4085b848-569c-4ac2-95f2-e036014403c6.sql
-- ============================================
-- Purge auto-written process noise from the Decision Ledger.
-- These rows were created by client-side auto-writes that violated
-- POSITIONING.md's rule that the Ledger updates only on Commit or
-- Proceed Anyway. The auto-writes have been removed in src/routes/index.tsx.
-- This deletes the historical pollution so the Decision Catch substrate
-- is clean. Conservative filter: only machine-written titles.
DELETE FROM public.entries
WHERE status = 'committed'
  AND (
    (verb = 'note'  AND title LIKE 'Thought for%')
    OR
    (verb = 'build' AND title LIKE 'Applied Patch%')
  );

-- ============================================
-- FILE: 20260526164800_12da7559-4c7d-4546-8aee-740d6ad025e8.sql
-- ============================================
-- Drop the old constraint BEFORE updating data.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

-- Add new columns.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS surface_mode text NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS shape jsonb NOT NULL DEFAULT '{"v":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS working_title text,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz;

-- Backfill status vocabulary.
UPDATE public.projects
  SET status = 'committed'
  WHERE status NOT IN ('shaping', 'committed', 'archived');

UPDATE public.projects
  SET committed_at = COALESCE(committed_at, created_at)
  WHERE status = 'committed' AND committed_at IS NULL;

-- Update new-user trigger to use new vocabulary.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.projects (user_id, name, status, surface_mode, committed_at)
  VALUES (NEW.id, 'First Project', 'committed', 'operational', now());

  RETURN NEW;
END;
$function$;

-- New constraints.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('shaping', 'committed', 'archived'));

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_surface_mode_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_surface_mode_check
  CHECK (surface_mode IN ('ambient', 'operational'));

CREATE INDEX IF NOT EXISTS projects_user_status_idx
  ON public.projects (user_id, status);


