CREATE TABLE IF NOT EXISTS "atlas_error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"route" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"project_id" text NOT NULL
);
