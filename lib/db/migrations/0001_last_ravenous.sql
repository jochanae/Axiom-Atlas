CREATE TABLE "thoughts" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"project_name" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"name" text,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"subscription_tier" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"url" text,
	"user_id" integer,
	"context" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"admin_response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"invited_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "node_state" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "push_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_handover_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_handover_hash" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "deviation_reason" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "catch_against_id" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "card_schema_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;