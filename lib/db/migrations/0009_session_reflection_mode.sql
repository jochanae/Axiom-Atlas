ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "reflection_mode" boolean DEFAULT false NOT NULL;
