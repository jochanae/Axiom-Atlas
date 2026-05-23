ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "parent_id" integer REFERENCES "artifacts"("id") ON DELETE set null;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;
