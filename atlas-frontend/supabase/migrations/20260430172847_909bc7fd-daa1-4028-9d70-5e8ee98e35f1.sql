
-- Collaboration: project invitations and comments
CREATE TABLE public.project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'editor',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_owner_all" ON public.project_invitations
  FOR ALL TO public
  USING (auth.uid() = invited_by)
  WITH CHECK (auth.uid() = invited_by);

CREATE TABLE public.session_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_owner_all" ON public.session_comments
  FOR ALL TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_comments;
