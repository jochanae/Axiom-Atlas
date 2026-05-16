import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, projectForgeStateTable } from "@workspace/db";

const router = Router();

router.get("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
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
});

router.post("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const { action } = req.body as { action: "forged" | "dismissed" };
  const update =
    action === "forged"
      ? { forgedAt: new Date() }
      : { dismissedAt: new Date() };
  await db
    .insert(projectForgeStateTable)
    .values({ projectId, ...update })
    .onConflictDoUpdate({
      target: projectForgeStateTable.projectId,
      set: update,
    });
  const rows = await db
    .select()
    .from(projectForgeStateTable)
    .where(eq(projectForgeStateTable.projectId, projectId))
    .limit(1);
  res.json(rows[0]);
});

export default router;
