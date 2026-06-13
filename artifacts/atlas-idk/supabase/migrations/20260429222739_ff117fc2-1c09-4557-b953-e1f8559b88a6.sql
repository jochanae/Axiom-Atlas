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