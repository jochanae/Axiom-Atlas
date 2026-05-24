import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isNeon = process.env.DATABASE_URL?.includes("neon.tech");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: isNeon ? { rejectUnauthorized: false } : undefined,
});

// Log Neon SSL status once at startup
if (isNeon) {
  console.log("[db] Neon SSL enabled (rejectUnauthorized: false)");
} else {
  console.warn("[db] DATABASE_URL does not contain neon.tech — SSL config: undefined");
}

pool.on("error", (err) => {
  console.error("[db-pool] Unexpected error on idle client — connection will be replaced:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
