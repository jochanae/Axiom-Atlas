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