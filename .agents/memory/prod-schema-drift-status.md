---
name: Prod DB schema drift — status model & masked Drizzle errors
description: Why "Failed to create project" happened; the real cause was a status CHECK constraint, not a missing column.
---

# "Failed to create project" — real cause was a status CHECK constraint, not `shape`

The deployed backend (Cloud Run, built from GitHub `jochanae/Axiom-Atlas` main) was **older** than the
production Neon DB (`crimson-block` endpoint, db `neondb`). The DB had drifted ahead to a newer data model.

- Prod `projects` has CHECK `projects_status_check` allowing only `shaping | committed | archived`.
- The backend insert (`POST /api/projects`) does NOT set `status`, so it falls back to the **column default**,
  which was `'active'` — an invalid value → `23514 violates check constraint "projects_status_check"`.
- Prod also has extra columns the code doesn't know about: `surface_mode` (CHECK `ambient|operational`),
  `working_title`, `committed_at`, `linked_repos`, and `shape` default `{"v":1}` (not the code's `{identity,...}`).

**Fix applied (DB-only, no redeploy):** `ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'shaping';`
New inserts now default to a valid status; existing 10 projects (`committed`) untouched. The project list
endpoint does not filter by status, so new `shaping` projects still appear. Verified end-to-end: live Cloud Run
`POST /api/projects` → 201 with `status:"shaping"`.

**Why:** the `shape`-column theory was a red herring. Drizzle's thrown error `message` only prints the failing
SQL (which lists every column incl. `shape`); the actual Postgres `cause` (the constraint violation) is NOT in
the HTML `<pre>` the user saw. Never trust the Drizzle "Failed query: insert ... shape ..." string as the cause.

**How to apply / debug next time:** connect directly to the EXACT prod connection string (request it as a secret,
e.g. `PROD_DATABASE_URL`), then **reproduce the real insert inside `BEGIN ... ROLLBACK`** to read the true pg
`code`/`message`/`detail`. This Replit's own `DATABASE_URL` is helium (Replit-managed), NOT prod Neon — you
cannot reach prod from `executeSql`.

**Latent risk:** if anyone runs `drizzle push` from this repo against prod, the code schema (status default
`'active'`, no status check, different `shape` default) will reintroduce the mismatch. The backend code and the
prod schema/frontend model are out of sync; aligning the code to `shaping/committed/archived` is the real long-term fix.
