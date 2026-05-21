---
name: Migration path & Drizzle error handling
description: Correct migration folder path and robust catch for "already exists" errors on dev DB startup
---

Drizzle migrate call in `artifacts/api-server/src/index.ts` must use `../../lib/db/migrations`, not `./drizzle`. The `./drizzle` folder does not exist — migrations output goes to `lib/db/migrations/` per `lib/db/drizzle.config.ts`.

The "already exists" catch must check `err.cause.code === "42P07"` (Postgres duplicate_table) in addition to string matching, because `_DrizzleQueryError` wraps the Postgres error in `err.cause` and the top-level `err.message` may not always include the cause text.

**Why:** Dev DB schema is managed via `pnpm --filter @workspace/db run push` (no migration tracking rows). When Drizzle runs all migrations from scratch against an already-populated DB, every CREATE TABLE throws 42P07. The server must treat this as a no-op and continue.

**How to apply:** Any time the server fails on startup with `Can't find meta/_journal.json` → fix the path. Any time it fails with `relation already exists` → fix the catch to include `pgCode === "42P07"`.
