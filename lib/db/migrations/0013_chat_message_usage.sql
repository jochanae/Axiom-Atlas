ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "execution_time_ms" integer;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "output_tokens" integer;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(10,5);
