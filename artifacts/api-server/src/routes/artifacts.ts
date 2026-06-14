import { Router, type IRouter } from "express";
import { db, artifactsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/artifacts?projectId=N
router.get("/artifacts", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  if (!projectId || isNaN(projectId)) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(artifactsTable)
      .where(and(eq(artifactsTable.projectId, projectId), eq(artifactsTable.userId, userId)))
      .orderBy(desc(artifactsTable.createdAt))
      .limit(50);
    res.json({ artifacts: rows });
  } catch {
    res.json({ artifacts: [] });
  }
});

// POST /api/artifacts — save an exported artifact
router.post("/artifacts", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const { type, title, content, projectId, sessionId, pinned, sources } = req.body as {
    type?: string;
    title?: string;
    content?: string;
    projectId?: number;
    sessionId?: number;
    pinned?: boolean;
    sources?: unknown;
  };

  if (!type || !title || !content || !projectId) {
    res.status(400).json({ error: "type, title, content, projectId are required" });
    return;
  }

  try {
    const [artifact] = await db
      .insert(artifactsTable)
      .values({
        type,
        title,
        content,
        projectId,
        userId,
        sessionId: sessionId ?? null,
        status: "draft",
        pinned: pinned ?? false,
        sources: sources ?? null,
      })
      .returning();
    res.status(201).json({ artifact });
  } catch (err) {
    res.status(500).json({ error: "Failed to save artifact" });
  }
});

// PATCH /api/artifacts/:id — pin / status update
router.patch("/artifacts/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const id = Number(req.params.id);
  const { pinned, status } = req.body as { pinned?: boolean; status?: string };

  try {
    const [updated] = await db
      .update(artifactsTable)
      .set({
        ...(pinned !== undefined ? { pinned } : {}),
        ...(status !== undefined ? { status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(artifactsTable.id, id), eq(artifactsTable.userId, userId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ artifact: updated });
  } catch {
    res.status(500).json({ error: "Failed to update artifact" });
  }
});

export default router;
