CREATE TABLE IF NOT EXISTS "scheduled_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "interval_minutes" integer DEFAULT 1440 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_checked_at" timestamp with time zone,
  "next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "check_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL REFERENCES "scheduled_checks"("id") ON DELETE CASCADE,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "http_status" integer,
  "is_healthy" boolean NOT NULL,
  "issues" text[] DEFAULT '{}' NOT NULL,
  "analysis" text,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_checks_next_check_at_idx" ON "scheduled_checks"("next_check_at") WHERE "is_active" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "check_results_project_id_idx" ON "check_results"("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "check_results_schedule_id_idx" ON "check_results"("schedule_id");
