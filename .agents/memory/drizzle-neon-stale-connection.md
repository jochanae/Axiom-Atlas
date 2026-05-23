---
name: Drizzle + Neon stale connection bug
description: Drizzle ORM prepared statement cache fails when Neon closes idle connections — causes 500 on any route that hits DB after ~5 min idle
---

## The Rule
Always configure pg.Pool with keepAlive + idleTimeoutMillis when connecting to Neon. Wrap every Drizzle query in try/catch with a safe default return.

**Why:** Neon closes idle PostgreSQL connections after ~5 minutes. Drizzle's `NodePgPreparedQuery.queryWithCache` caches prepared statements per connection. When Neon kills a connection and Drizzle reuses a stale pool slot, the cached statement no longer exists on the new connection — the query throws "Failed query" and the route returns 500. Routes that benefit from HTTP 304 caching (projects, auth) appear to work because they never hit the DB; uncached routes (entries, forge-state) always fail.

**How to apply:**
- `lib/db/src/index.ts`: `new Pool({ keepAlive: true, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })`
- All routes: wrap `await db.select()...` in try/catch; return `[]` or `{}` default instead of propagating the 500
- Symptom: "Failed query: select..." in Drizzle logs + 500 on workspace open on EVERY project
