import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";

const router = Router();

router.get("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const userId = (req as any).authUser.id as number;
  const [project] = await db
    .select({ forgedAt: projectsTable.forgedAt, dismissedAt: projectsTable.dismissedAt })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  res.json({
    forged: !!project?.forgedAt,
    dismissed: !!project?.dismissedAt,
    forgedAt: project?.forgedAt?.toISOString() ?? null,
    dismissedAt: project?.dismissedAt?.toISOString() ?? null,
  });
});

router.post("/projects/:projectId/forge-state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const userId = (req as any).authUser.id as number;
  const { action } = req.body as { action: "forged" | "dismissed" };
  const update =
    action === "forged"
      ? { forgedAt: new Date() }
      : { dismissedAt: new Date() };
  await db
    .update(projectsTable)
    .set(update)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));
  const [project] = await db
    .select({ forgedAt: projectsTable.forgedAt, dismissedAt: projectsTable.dismissedAt })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  res.json({
    forged: !!project?.forgedAt,
    dismissed: !!project?.dismissedAt,
    forgedAt: project?.forgedAt?.toISOString() ?? null,
    dismissedAt: project?.dismissedAt?.toISOString() ?? null,
  });
});

export default router;
