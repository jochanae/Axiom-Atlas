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