CREATE TABLE IF NOT EXISTS "image_versions" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "message_id" integer,
  "parent_version_id" integer,
  "prompt" text NOT NULL,
  "image_b64" text NOT NULL,
  "image_mime_type" text NOT NULL DEFAULT 'image/png',
  "model" text,
  "mode" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
