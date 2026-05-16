ALTER TABLE "atlas_incidents" ADD COLUMN IF NOT EXISTS "confidence" text;
--> statement-breakpoint
ALTER TABLE "atlas_incidents" ADD COLUMN IF NOT EXISTS "blast_radius" text;
--> statement-breakpoint
ALTER TABLE "atlas_incidents" ADD COLUMN IF NOT EXISTS "reasoning" text;
