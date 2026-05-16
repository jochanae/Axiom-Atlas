CREATE TABLE IF NOT EXISTS "atlas_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"files_changed" text[] NOT NULL,
	"commit_message" text NOT NULL,
	"branch_name" text NOT NULL,
	"pr_url" text NOT NULL,
	"outcome" text,
	"notes" text
);
