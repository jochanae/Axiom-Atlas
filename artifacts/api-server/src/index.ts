import http from "http";
import app from "./app";
import { db } from "@workspace/db";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { logger } from "./lib/logger";
import { initTerminalWs } from "./routes/terminalWs";

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

async function main() {
  // Fire and forget — never block startup
  initStripe().catch((err) => {
    console.warn("Stripe init skipped:", err?.message ?? err);
  });

  try {
    await migrate(db, { migrationsFolder: "../../lib/db/migrations" });
    logger.info("Migrations complete");
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
      logger.warn("Migration skipped — tables already exist in target database");
    } else {
      logger.error({ err }, "Migration failed — continuing");
    }
  }

  const server = http.createServer(app);

  // Initialize Terminal WebSocket server (node-pty is a native module — skip gracefully if unavailable)
  try {
    initTerminalWs(server);
    logger.info("Terminal WebSocket server initialized");
  } catch (err) {
    logger.warn({ err }, "Terminal WebSocket unavailable — node-pty not installed, skipping");
  }

  server.listen(port, () => {
    console.log({ port }, "Server listening");
    // Signal readiness immediately
    if (process.send) process.send("ready");
  });
}

main();
