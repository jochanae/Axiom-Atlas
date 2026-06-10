import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/artifacts?projectId=N&sessionId=N
router.get("/artifacts", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  res.json({ artifacts: [] });
});

// POST /api/artifacts
router.post("/artifacts", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const { type, title, content, projectId, sessionId } = req.body as {
    type?: string; title?: string; content?: string; projectId?: number; sessionId?: number;
  };
  if (!type || !title || !content) { res.status(400).json({ error: "type, title, content required" }); return; }
  res.json({ id: Date.now(), type, title, projectId, sessionId, createdAt: new Date().toISOString() });
});

export default router;
