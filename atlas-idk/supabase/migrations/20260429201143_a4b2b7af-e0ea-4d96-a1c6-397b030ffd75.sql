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