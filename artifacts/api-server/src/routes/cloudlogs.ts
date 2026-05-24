import { Router } from "express";
import { Logging } from "@google-cloud/logging";
import { logger } from "../lib/logger";

const router = Router();

router.get("/admin/logs/cloudrun", async (req, res): Promise<void> => {
  try {
    const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credJson) {
      res.status(503).json({ error: "Cloud logging not configured" });
      return;
    }

    const credentials = JSON.parse(credJson);
    const logging = new Logging({ credentials, 
      projectId: credentials.project_id });

    const [entries] = await logging.getEntries({
      filter: `resource.type="cloud_run_revision" 
        AND resource.labels.service_name="axiom-atlas"`,
      orderBy: "timestamp desc",
      pageSize: 50,
    });

    const lines = entries.map(e => ({
      timestamp: e.metadata.timestamp,
      severity: e.metadata.severity,
      message: e.data ?? e.metadata.textPayload ?? 
        JSON.stringify(e.metadata.jsonPayload ?? "")
    }));

    res.json({ lines });
  } catch (err) {
    logger.error({ err }, "Failed to fetch Cloud Run logs");
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

export default router;
