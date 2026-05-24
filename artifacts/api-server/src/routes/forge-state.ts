import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, projectForgeStateTable } from "@workspace/db";

const router = Router();

router.get("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  try {
    const rows = await db
      .select()
      .from(projectForgeStateTable)
      .where(eq(projectForgeStateTable.projectId, projectId))
      .limit(1);
    const row = rows[0];
    res.json({
      forged: !!row?.forgedAt,
      dismissed: !!row?.dismissedAt,
      forgedAt: row?.forgedAt?.toISOString() ?? null,
      dismissedAt: row?.dismissedAt?.toISOString() ?? null,
    });
  } catch {
    res.json({ forged: false, dismissed: false, forgedAt: null, dismissedAt: null });
  }
});

router.post("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const { action } = req.body as { action: "forged" | "dismissed" };
  const update =
    action === "forged"
      ? { forgedAt: new Date() }
      : { dismissedAt: new Date() };
  try {
    await db
      .insert(projectForgeStateTable)
      .values({ projectId, ...update })
      .onConflictDoUpdate({
        target: projectForgeStateTable.projectId,
        set: update,
      });
    try {
      const rows = await db
        .select()
        .from(projectForgeStateTable)
        .where(eq(projectForgeStateTable.projectId, projectId))
        .limit(1);
      res.json(rows[0] ?? { forged: false, dismissed: false });
    } catch {
      res.json({ forged: action === "forged", dismissed: action === "dismissed" });
    }
  } catch {
    res.status(500).json({ error: "Failed to update forge state" });
  }
});

export default router;
