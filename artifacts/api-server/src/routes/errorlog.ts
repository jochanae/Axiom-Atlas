import { Router, type IRouter } from "express";
import { atlasErrorLogsTable, db } from "@workspace/db";

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

export default router;
