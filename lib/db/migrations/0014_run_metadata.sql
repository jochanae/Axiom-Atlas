ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "run_status" text;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "run_summary" text;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "run_actions" jsonb;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "run_artifacts" jsonb;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "execution_time_ms" integer;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "output_tokens" integer;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(10,5);
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "run_status" text;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "run_summary" text;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "run_actions" jsonb;
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "run_artifacts" jsonb;
