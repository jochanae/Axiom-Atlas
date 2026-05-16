CREATE TABLE IF NOT EXISTS "atlas_self_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"map_json" text NOT NULL,
	"file_count" integer NOT NULL
);
