ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "last_opened_at" timestamp with time zone DEFAULT now() NOT NULL;
