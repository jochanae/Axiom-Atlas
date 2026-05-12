-- Add conversation grouping to the nexus Living Thread
--> statement-breakpoint
ALTER TABLE "nexus_messages" ADD COLUMN "conversation_id" text;
