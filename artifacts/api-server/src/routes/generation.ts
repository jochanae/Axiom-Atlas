import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, generatedFiles, generationRuns, projectsTable } from "@workspace/db";

const router: IRouter = Router();

// Verify that a project exists and is owned by the given userId.
async function projectBelongsToUser(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

function serializeGenerationRun(run: typeof generationRuns.$inferSelect) {
  return {
    id: run.id,
    projectId: run.projectId,
    userId: run.userId,
    prompt: run.prompt,
    intent: run.intent,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.durationMs,
    filesChanged: run.filesChanged,
    linesAdded: run.linesAdded,
    linesRemoved: run.linesRemoved,
    summary: run.summary,
    commitSha: run.commitSha,
    pushedToBranch: run.pushedToBranch,
  };
}

function serializeGeneratedFile(file: typeof generatedFiles.$inferSelect) {
  return {
    id: file.id,
    runId: file.runId,
    path: file.path,
    language: file.language,
    bytes: file.bytes,
    lines: file.lines,
    content: file.content,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    status: file.status,
    previousContent: file.previousContent,
  };
}

router.get("/projects/:projectId/generation-runs", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const rows = await db
    .select()
    .from(generationRuns)
    .where(eq(generationRuns.projectId, projectId))
    .orderBy(desc(generationRuns.startedAt))
    .limit(20);

  res.json(rows.map(serializeGenerationRun));
});

router.get("/projects/:projectId/generation-runs/:runId/files", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const [run] = await db
    .select({ id: generationRuns.id })
    .from(generationRuns)
    .where(and(eq(generationRuns.id, req.params.runId), eq(generationRuns.projectId, projectId)))
    .limit(1);
  if (!run) { res.status(404).json({ error: "Generation run not found" }); return; }

  const rows = await db
    .select()
    .from(generatedFiles)
    .where(eq(generatedFiles.runId, req.params.runId))
    .orderBy(asc(generatedFiles.path));

  res.json(rows.map(serializeGeneratedFile));
});

export default router;
