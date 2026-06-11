import { Router, type IRouter } from "express";
import { atlasErrorLogsTable, db } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/errorlog/ingest", async (req, res): Promise<void> => {
  const { error_message, stack_trace, route, timestamp, project_id } = req.body as {
    error_message?: string;
    stack_trace?: string | null;
    route?: string;
    timestamp?: string;
    project_id?: string | number;
  };

  if (!error_message || !route || !timestamp || !project_id) {
    res.status(400).json({ error: "Missing required fields: error_message, route, timestamp, project_id" });
    return;
  }

  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    res.status(400).json({ error: "Invalid timestamp" });
    return;
  }

  await db.insert(atlasErrorLogsTable).values({
    errorMessage: error_message,
    stackTrace: stack_trace ?? null,
    route,
    timestamp: parsedTimestamp,
    projectId: String(project_id),
  });

  res.json({ received: true });
});

router.get("/errorlog/recent", async (req, res): Promise<void> => {
  const { project_id, limit } = req.query as {
    project_id?: string;
    limit?: string;
  };

  if (!project_id) {
    res.status(400).json({ error: "Missing project_id" });
    return;
  }

  const lookback = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = Math.min(parseInt(limit ?? "20", 10) || 20, 100);

  try {
    const rows = await db
      .select()
      .from(atlasErrorLogsTable)
      .where(
        sql`${atlasErrorLogsTable.projectId} = ${project_id} AND ${atlasErrorLogsTable.timestamp} >= ${lookback}`
      )
      .orderBy(desc(atlasErrorLogsTable.timestamp))
      .limit(count);

    res.json({
      projectId: project_id,
      count: rows.length,
      errors: rows.map((r) => ({
        id: r.id,
        errorMessage: r.errorMessage,
        stackTrace: r.stackTrace,
        route: r.route,
        timestamp: r.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch errors", detail: String(err) });
  }
});

export default router;
