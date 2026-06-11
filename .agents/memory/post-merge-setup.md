---
name: Post-merge setup pattern
description: Why the post-merge script only runs pnpm install and not drizzle-kit migrate
---

## Rule
`scripts/post-merge.sh` only runs `pnpm install --frozen-lockfile`. It does NOT run any Drizzle migration or push command.

## Why
The dev database (Replit-managed Helium Postgres) was bootstrapped with `drizzle-kit push`, not migration files. The `__drizzle_migrations` table has no entries. Running `drizzle-kit migrate` in post-merge causes it to replay ALL migrations from 0000 — hitting `42P07` (relation already exists) for tables like `projects`.

## How schema changes get applied in dev
The API server's startup code (`artifacts/api-server/src/index.ts`) calls `migrate(db, { migrationsFolder: "../../lib/db/migrations" })`. It catches `42P07` and logs a warning — this is expected and harmless. After a merge, workflow reconciliation restarts the server, which applies any new migration files at that point.

## Production (Neon)
Neon schema changes are applied manually via the Neon SQL editor using the `neon-migration.txt` copy-pasteable file that accompanies schema changes. Do not run migrations against Neon from this environment.
