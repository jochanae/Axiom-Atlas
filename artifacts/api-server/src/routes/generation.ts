import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, generatedFilesTable, generationRunsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

function serializeGenerationRun(run: typeof generationRunsTable.$inferSelect) {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

function serializeGeneratedFile(file: typeof generatedFilesTable.$inferSelect) {
  return {
    ...file,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Verify that a project exists and is owned by the given userId.
async function projectBelongsToUser(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

// Verify that a generation run exists under the requested project.
async function generationRunBelongsToProject(runId: string, projectId: number): Promise<boolean> {
  const rows = await db
    .select({ id: generationRunsTable.id })
    .from(generationRunsTable)
    .where(and(eq(generationRunsTable.id, runId), eq(generationRunsTable.projectId, projectId)))
    .limit(1);
  return rows.length > 0;
}

router.get("/projects/:projectId/generation-runs", async (req, res): Promise<void> => {
  const projectId = parsePositiveInteger(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = rawLimit === undefined ? 20 : parsePositiveInteger(String(rawLimit));
  if (!limit) { res.status(400).json({ error: "Invalid limit" }); return; }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const runs = await db
    .select()
    .from(generationRunsTable)
    .where(eq(generationRunsTable.projectId, projectId))
    .orderBy(desc(generationRunsTable.startedAt))
    .limit(limit);

  res.json({ runs: runs.map(serializeGenerationRun) });
});

router.get("/projects/:projectId/generation-runs/:runId/files", async (req, res): Promise<void> => {
  const projectId = parsePositiveInteger(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  if (!(await generationRunBelongsToProject(req.params.runId, projectId))) {
    res.status(404).json({ error: "Generation run not found" }); return;
  }

  const files = await db
    .select()
    .from(generatedFilesTable)
    .where(eq(generatedFilesTable.runId, req.params.runId));

  res.json({ files: files.map(serializeGeneratedFile) });
});

export default router;
