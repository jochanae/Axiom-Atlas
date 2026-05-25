-- Fix: add columns that exist in schema but not in Neon production
-- These were added to users.ts but never had a migration applied

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "terminal_safety" text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS "reset_token" text,
  ADD COLUMN IF NOT EXISTS "reset_token_expires_at" timestamp with time zone;
