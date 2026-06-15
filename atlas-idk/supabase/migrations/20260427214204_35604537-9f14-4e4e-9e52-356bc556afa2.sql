
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
