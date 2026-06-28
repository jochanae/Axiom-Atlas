import { Router, type IRouter } from "express";
import { db, projectArtifactsTable, projectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export { logProjectArtifact } from "../lib/artifactLog";

const router: IRouter = Router();

// GET /api/projects/:id/artifacts
// Returns all artifacts for this project in reverse chronological order.
// Optional ?type= filter to scope to a specific artifact type.
router.get("/projects/:id/artifacts", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const projectId = Number(req.params.id);
    if (!projectId || isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!proj) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const typeFilter = typeof req.query.type === "string" ? req.query.type : undefined;

    const rows = await db
      .select()
      .from(projectArtifactsTable)
      .where(
        typeFilter
          ? and(
              eq(projectArtifactsTable.projectId, projectId),
              eq(projectArtifactsTable.type, typeFilter),
            )
          : eq(projectArtifactsTable.projectId, projectId),
      )
      .orderBy(desc(projectArtifactsTable.createdAt));

    res.json({
      artifacts: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        type: r.type,
        version: r.version,
        title: r.title,
        metadata: r.metadata,
        payload: r.payload,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GET /projects/:id/artifacts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
