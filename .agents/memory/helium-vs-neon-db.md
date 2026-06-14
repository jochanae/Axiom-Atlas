---
name: Replit dev DB vs Supabase prod DB
description: Which database this Replit talks to vs which the deployed backend uses
---

This Replit's `DATABASE_URL` host is `helium`/`heliumdb` — the Replit-managed Postgres, NOT Supabase. The `executeSql` tool and the local `api-server` workflow both hit helium.

The deployed backend (Cloud Run, `axiom-atlas-689827072865.us-east1.run.app`) uses its OWN `DATABASE_URL` pointing at the live **Supabase** database. That Supabase connection string is NOT present in this Replit, so the agent cannot read or migrate the live prod DB directly.

**Why:** helium happens to contain a copy/seed of real-looking data, which makes it easy to mistake for prod. Running an `ALTER TABLE` via `executeSql` fixes helium only — the live app is unaffected.

**How to apply:** Any production schema fix must be delivered as SQL for Jochanae to run in the **Supabase SQL editor**. Write it to `supabase-migration.sql`. To verify a schema fix before handing it over, apply it to helium and test through the local api-server workflow (`localhost:80/api`) — but never assume that touched prod.

**Important:** Do NOT use FK constraints in Supabase migration SQL — they cause `relation does not exist` errors in Supabase's SQL editor even when the referenced tables exist. Use plain integer columns; Drizzle enforces relationships in code.

**Canonical incident:** "Failed to create project" was caused by a `projects.shape` column added in code but never added to Supabase. Fix = add the column in Supabase SQL editor.
