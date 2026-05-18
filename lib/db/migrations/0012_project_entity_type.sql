ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "entity_type" text DEFAULT 'project' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_entity_type_check" CHECK ("entity_type" IN ('project', 'idea'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
