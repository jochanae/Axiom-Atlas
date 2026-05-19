ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "total_input_tokens" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "total_output_tokens" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "total_cost_usd" numeric DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "total_execution_ms" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "run_summary" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "run_actions" jsonb;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "run_artifacts" jsonb;
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "execution_time_ms";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "input_tokens";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "output_tokens";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "cost_usd";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "run_status";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "run_summary";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "run_actions";
--> statement-breakpoint
ALTER TABLE "nexus_messages" DROP COLUMN IF EXISTS "run_artifacts";
