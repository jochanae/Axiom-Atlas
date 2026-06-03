---
name: helium vs Neon prod DB
description: Which database this Replit talks to vs which the deployed backend uses
---

This Replit's `DATABASE_URL` host is `helium`/`heliumdb` — the Replit-managed Postgres, NOT Neon. The `executeSql` tool and the local `api-server` workflow both hit helium.

The deployed backend (Cloud Run, `axiom-atlas-689827072865.us-east1.run.app`) uses its OWN `DATABASE_URL` pointing at the live **Neon** database. That Neon connection string is NOT present in this Replit, so the agent cannot read or migrate the live prod DB directly.

**Why:** helium happens to contain a copy/seed of real-looking data (e.g. the founder account with many projects), which makes it easy to mistake for prod. Running an `ALTER TABLE` via `executeSql` fixes helium only — the live app is unaffected.

**How to apply:** Any production schema fix must be delivered as SQL for Jochanae to run in the **Neon SQL editor** (write it to `neon-migration.txt`). To *verify* a schema fix before handing it over, apply it to helium and test through the local api-server workflow (`localhost:80/api`) — but never assume that touched prod.

**Canonical incident:** "Failed to create project" was caused by the code adding a `projects.shape` jsonb column (NOT NULL, default `{identity:[],constraints:[],formats:[]}`) that was never added to Neon. Reads + inserts on projects all 500'd, cascading to briefing and home→workspace handoff. Fix = add the column on Neon.
