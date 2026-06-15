
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
