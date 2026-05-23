CREATE TABLE "home_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"messages" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"score" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nexus_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"session_id" integer,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"conversation_id" text,
	"message_type" text DEFAULT 'message',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"project_name" text DEFAULT 'General' NOT NULL,
	"label" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"object_path" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "atlas_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"files_changed" text[] NOT NULL,
	"commit_message" text NOT NULL,
	"branch_name" text NOT NULL,
	"pr_url" text NOT NULL,
	"validation_passed" boolean DEFAULT false NOT NULL,
	"confidence" text,
	"blast_radius" text,
	"reasoning" text,
	"outcome" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "atlas_error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"route" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atlas_self_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"map_json" text NOT NULL,
	"file_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_forge_state" (
	"project_id" integer NOT NULL,
	"forged_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_forge_state_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"conversation_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"token" text,
	"metadata" jsonb,
	"status" text DEFAULT 'linked' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "entity_type" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "linked_repos" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_opened_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reflection_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idea_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "total_input_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "total_output_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "total_cost_usd" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "total_execution_ms" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "run_summary" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "run_actions" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "run_artifacts" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "execution_time_ms" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "cost_usd" numeric(10, 5);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "run_status" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "run_summary" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "run_actions" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "run_artifacts" jsonb;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "context_what" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "context_why" text;--> statement-breakpoint
ALTER TABLE "thoughts" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "vault" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD CONSTRAINT "nexus_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD CONSTRAINT "nexus_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD CONSTRAINT "nexus_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_forge_state" ADD CONSTRAINT "project_forge_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;