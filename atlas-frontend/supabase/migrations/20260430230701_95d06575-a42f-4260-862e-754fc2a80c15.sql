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