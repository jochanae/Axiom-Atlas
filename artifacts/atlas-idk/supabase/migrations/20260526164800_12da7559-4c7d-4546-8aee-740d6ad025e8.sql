-- Drop the old constraint BEFORE updating data.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

-- Add new columns.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS surface_mode text NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS shape jsonb NOT NULL DEFAULT '{"v":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS working_title text,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz;

-- Backfill status vocabulary.
UPDATE public.projects
  SET status = 'committed'
  WHERE status NOT IN ('shaping', 'committed', 'archived');

UPDATE public.projects
  SET committed_at = COALESCE(committed_at, created_at)
  WHERE status = 'committed' AND committed_at IS NULL;

-- Update new-user trigger to use new vocabulary.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.projects (user_id, name, status, surface_mode, committed_at)
  VALUES (NEW.id, 'First Project', 'committed', 'operational', now());

  RETURN NEW;
END;
$function$;

-- New constraints.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('shaping', 'committed', 'archived'));

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_surface_mode_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_surface_mode_check
  CHECK (surface_mode IN ('ambient', 'operational'));

CREATE INDEX IF NOT EXISTS projects_user_status_idx
  ON public.projects (user_id, status);
