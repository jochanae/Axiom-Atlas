ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "image_b64" text;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "image_mime_type" text;
