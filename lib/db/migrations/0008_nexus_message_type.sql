ALTER TABLE "nexus_messages" ADD COLUMN IF NOT EXISTS "message_type" text DEFAULT 'message';
