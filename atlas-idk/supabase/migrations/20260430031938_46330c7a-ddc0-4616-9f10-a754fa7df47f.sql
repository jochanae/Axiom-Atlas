ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS recommendations_project_kind_status_idx
  ON public.recommendations (project_id, kind, status);