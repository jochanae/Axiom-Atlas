-- Nexus Mode Backend Refactor
-- Nexus is a global MODE (environment state), not a project entity.
-- Remove the fake isNexus project column, create the Living Thread table,
-- and delete any legacy Nexus/Nexium project rows.
--> statement-breakpoint
DELETE FROM projects WHERE name IN ('Nexus', 'Nexium');
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "is_nexus";
--> statement-breakpoint
CREATE TABLE "nexus_messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "nexus_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
