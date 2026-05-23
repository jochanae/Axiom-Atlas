import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { artifactsTable, db, projectsTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();

const ListArtifactsQuery = z.object({
  projectId: z.coerce.number().int().positive(),
});

const CreateArtifactBody = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive().optional().nullable(),
  type: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  sources: z.unknown().optional().nullable(),
});

const ArtifactParams = z.object({
  id: z.coerce.number().int().positive(),
});

const UpdateArtifactBody = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  sources: z.unknown().optional().nullable(),
}).refine((body) => Object.keys(body).length > 0, {
  message: "At least one field is required",
});

function serializeArtifact(row: typeof artifactsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function projectBelongsToUser(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

async function sessionBelongsToProject(sessionId: number, projectId: number): Promise<boolean> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.projectId, projectId)))
    .limit(1);
  return rows.length > 0;
}

router.get("/artifacts", async (req, res): Promise<void> => {
  const parsed = ListArtifactsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(parsed.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const artifacts = await db
    .select()
    .from(artifactsTable)
    .where(and(
      eq(artifactsTable.userId, userId),
      eq(artifactsTable.projectId, parsed.data.projectId),
    ))
    .orderBy(desc(artifactsTable.createdAt))
    .limit(50);

  res.json(artifacts.map(serializeArtifact));
});

router.post("/artifacts", async (req, res): Promise<void> => {
  const parsed = CreateArtifactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(parsed.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const sessionId = parsed.data.sessionId ?? null;
  if (sessionId && !(await sessionBelongsToProject(sessionId, parsed.data.projectId))) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [artifact] = await db
    .insert(artifactsTable)
    .values({
      userId,
      projectId: parsed.data.projectId,
      sessionId,
      type: parsed.data.type,
      title: parsed.data.title,
      content: parsed.data.content,
      sources: parsed.data.sources ?? null,
    })
    .returning();

  res.status(201).json(serializeArtifact(artifact));
});

router.patch("/artifacts/:id", async (req, res): Promise<void> => {
  const params = ArtifactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateArtifactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateValues: {
    title?: string;
    content?: string;
    status?: string;
    sources?: unknown;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (parsed.data.title !== undefined) updateValues.title = parsed.data.title;
  if (parsed.data.content !== undefined) updateValues.content = parsed.data.content;
  if (parsed.data.status !== undefined) updateValues.status = parsed.data.status;
  if (Object.prototype.hasOwnProperty.call(parsed.data, "sources")) {
    updateValues.sources = parsed.data.sources ?? null;
  }

  const userId = (req as any).authUser.id as number;
  const [artifact] = await db
    .update(artifactsTable)
    .set(updateValues)
    .where(and(eq(artifactsTable.id, params.data.id), eq(artifactsTable.userId, userId)))
    .returning();

  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  res.json(serializeArtifact(artifact));
});

router.delete("/artifacts/:id", async (req, res): Promise<void> => {
  const params = ArtifactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const [artifact] = await db
    .delete(artifactsTable)
    .where(and(eq(artifactsTable.id, params.data.id), eq(artifactsTable.userId, userId)))
    .returning({ id: artifactsTable.id });

  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
