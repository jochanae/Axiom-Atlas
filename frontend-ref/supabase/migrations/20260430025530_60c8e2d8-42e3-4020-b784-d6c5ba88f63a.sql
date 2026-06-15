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