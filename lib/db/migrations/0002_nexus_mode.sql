-- Nexus Mode Backend Refactor
-- Nexus is a global MODE (environment state), not a project entity.
-- Clean up legacy Nexus project rows by their flag before dropping the column,
-- then create the per-user Living Thread table.
--> statement-breakpoint
DELETE FROM projects WHERE is_nexus = true;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "is_nexus";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nexus_messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "nexus_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
