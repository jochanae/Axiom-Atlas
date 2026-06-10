import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Auto-create error_reports table if it doesn't exist
async function ensureTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS error_reports (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        app_name TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        stack TEXT,
        url TEXT,
        severity TEXT NOT NULL DEFAULT 'error',
        context JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS error_reports_project_id_idx ON error_reports (project_id, created_at DESC)
    `);
  } catch (err) {
    logger.warn({ err }, "error_reports table setup failed — continuing");
  }
}

void ensureTable();

// POST /api/errors/report — accept error from any app, no session required
// Apps authenticate with x-atlas-key header matching ATLAS_REPORTING_KEY env var
router.post("/errors/report", async (req, res): Promise<void> => {
  try {
    const apiKey = req.headers["x-atlas-key"];
    const expectedKey = process.env.ATLAS_REPORTING_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      res.status(401).json({ error: "Invalid reporting key" });
      return;
    }

    const { projectId, appName, message, stack, url, severity = "error", context } = req.body as {
      projectId?: number;
      appName?: string;
      message?: string;
      stack?: string;
      url?: string;
      severity?: string;
      context?: Record<string, unknown>;
    };

    if (!projectId || !message) {
      res.status(400).json({ error: "projectId and message are required" });
      return;
    }

    await db.execute(sql`
      INSERT INTO error_reports (project_id, app_name, message, stack, url, severity, context)
      VALUES (
        ${projectId},
        ${appName ?? ""},
        ${message},
        ${stack ?? null},
        ${url ?? null},
        ${severity},
        ${context ? JSON.stringify(context) : null}
      )
    `);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "error report failed");
    res.status(500).json({ error: "Failed to store error report" });
  }
});

// GET /api/projects/:projectId/errors — recent errors for a project (session auth)
router.get("/projects/:projectId/errors", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const rows = await db.execute(sql`
      SELECT id, app_name, message, stack, url, severity, context, created_at
      FROM error_reports
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const errors = Array.isArray(rows)
      ? rows
      : (rows as any).rows ?? [];

    res.json({ errors });
  } catch (err) {
    logger.error({ err }, "fetch errors failed");
    res.status(500).json({ errors: [] });
  }
});

export default router;
