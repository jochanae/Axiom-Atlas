ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "linked_repos" text;

CREATE TABLE IF NOT EXISTS "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"project_id" integer REFERENCES "projects"("id") ON DELETE cascade,
	"session_id" integer REFERENCES "sessions"("id") ON DELETE set null,
	"type" text DEFAULT 'document' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
