import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

type HealthStatus = "ok" | "degraded" | "down";
type DependencyStatus = "ok" | "missing" | "error";

function envStatus(name: string): "ok" | "missing" {
  return process.env[name]?.trim() ? "ok" : "missing";
}

router.get("/health", async (_req, res): Promise<void> => {
  const errors: string[] = [];
  let database: DependencyStatus = "ok";

  try {
    await db.execute(sql`SELECT 1 FROM users LIMIT 1`);
  } catch (err) {
    database = "error";
    errors.push(err instanceof Error ? err.message : "Database health check failed");
  }

  const checks = {
    server: "ok" as const,
    database,
    anthropic: envStatus("ANTHROPIC_API_KEY"),
    github: envStatus("GITHUB_TOKEN"),
    stripe: envStatus("STRIPE_SECRET_KEY"),
    gemini: envStatus("GOOGLE_GEMINI_API_KEY"),
    openai: envStatus("OPENAI_API_KEY"),
  };

  const status: HealthStatus = checks.database === "error"
    ? "down"
    : Object.values(checks).some((check) => check !== "ok")
      ? "degraded"
      : "ok";

  res.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    errors,
  });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
