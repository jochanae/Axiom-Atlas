import app from "./app";
import { db } from "@workspace/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "./lib/logger";
import { spawn } from "node:child_process";
import { startScheduledChecksWorker } from "./lib/scheduledChecksWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe() {
  try {
    const { runMigrations } = await import('stripe-replit-sync');
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for Stripe');

    logger.info('Initializing Stripe schema...');
    await runMigrations({ databaseUrl } as Parameters<typeof runMigrations>[0]);
    logger.info('Stripe schema ready');

    const { getStripeSync } = await import('./stripeClient');
    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
    logger.info('Stripe webhook configured');

    stripeSync.syncBackfill()
      .then(() => logger.info('Stripe backfill complete'))
      .catch((err: any) => logger.error({ err }, 'Stripe backfill error'));
  } catch (err: any) {
    logger.error({ err }, 'Stripe init failed — continuing without Stripe');
  }
}

// Run drizzle-kit push as a child process to sync schema with the live database.
// This is the production equivalent of `pnpm --filter @workspace/db run push`.
// It runs on every startup so the database schema never falls behind the code.
async function pushSchema(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping schema push");
    return;
  }

  return new Promise((resolve) => {
    const child = spawn("npx", [
      "drizzle-kit",
      "push",
      "--config", "../../lib/db/drizzle.config.ts",
    ], {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) {
        logger.info("Schema push: applied cleanly");
      } else {
        logger.warn({ code, stdout: stdout.trim(), stderr: stderr.trim() }, "Schema push: non-zero exit — server will start anyway");
      }
      resolve();
    });

    child.on("error", (err) => {
      logger.warn({ err }, "Schema push: spawn failed — server will start anyway");
      resolve();
    });
  });
}

async function main() {
  // Fire and forget — never block startup
  initStripe().catch((err) => {
    console.warn("Stripe init skipped:", err?.message ?? err);
  });

  // Sync schema before starting. Never block on failure.
  pushSchema().catch((err) => {
    logger.warn({ err }, "Schema push threw — server will start anyway");
  });

  try {
    await migrate(db, { migrationsFolder: "../../lib/db/migrations" });
    logger.info("Boot migrate: applied cleanly (fresh/empty database).");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const causeMessage = (err instanceof Error && (err as any).cause instanceof Error)
      ? (err as any).cause.message as string
      : "";
    const pgCode = (err as any)?.cause?.code ?? (err as any)?.code ?? "";
    const isDuplicateTable =
      message.includes("already exists") ||
      causeMessage.includes("already exists") ||
      pgCode === "42P07";
    if (isDuplicateTable) {
      // Live database schema is managed by drizzle-kit push, so duplicate tables are expected.
      logger.warn("Boot migrate: skipped — schema is managed by drizzle-kit push, not migration files. Expected on the live database; not an error.");
    } else {
      logger.error({ err }, "Migration failed");
      throw err;
    }
  }

  app.listen(port, () => {
    console.log({ port }, "Server listening");
    // Signal readiness immediately
    if (process.send) process.send("ready");
    // Start background worker for scheduled health checks
    startScheduledChecksWorker();
  });
}

main();
