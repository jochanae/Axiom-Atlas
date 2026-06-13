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
