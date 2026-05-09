import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, projectsTable, sessionsTable, entriesTable, readinessSnapshotsTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectSummaryParams,
  ListReadinessSnapshotsParams,
  RecordReadinessSnapshotParams,
  RecordReadinessSnapshotBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.updatedAt);
  res.json(projects.map(p => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  })));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Free tier: limit to 1 project.
  // Atlas is a single-owner tool — all projects in this DB belong to the authenticated user.
  // A per-user ownership column is not in the current schema, so total count is the correct check.
  const authUser = (req as any).authUser;
  if (authUser?.subscriptionTier === "free") {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(projectsTable);
    if (count >= 1) {
      res.status(402).json({
        error: "Free plan is limited to 1 project.",
        code: "PROJECT_LIMIT_REACHED",
      });
      return;
    }
  }

  const [project] = await db.insert(projectsTable).values(parsed.data).returning();
  res.status(201).json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { lastHandoverAt, ...rest } = parsed.data;
  const updateValues = {
    ...rest,
    ...(lastHandoverAt !== undefined
      ? { lastHandoverAt: lastHandoverAt === null ? null : new Date(lastHandoverAt) }
      : {}),
  };
  const [project] = await db.update(projectsTable).set(updateValues).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/projects/:id/summary", async (req, res): Promise<void> => {
  const params = GetProjectSummaryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;

  const [sessionCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(sessionsTable)
    .where(eq(sessionsTable.projectId, id));

  const [committedCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(entriesTable)
    .where(eq(entriesTable.projectId, id));

  const [parkedCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(entriesTable)
    .where(eq(entriesTable.projectId, id));

  const recentSession = await db
    .select({ mode: sessionsTable.mode })
    .from(sessionsTable)
    .where(eq(sessionsTable.projectId, id))
    .orderBy(sessionsTable.createdAt)
    .limit(1);

  res.json({
    projectId: id,
    sessionCount: sessionCountRow?.count ?? 0,
    committedCount: committedCountRow?.count ?? 0,
    parkedCount: parkedCountRow?.count ?? 0,
    recentMode: recentSession[0]?.mode ?? null,
  });
});

router.get("/projects/:id/readiness-snapshots", async (req, res): Promise<void> => {
  const params = ListReadinessSnapshotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const snapshots = await db
    .select()
    .from(readinessSnapshotsTable)
    .where(eq(readinessSnapshotsTable.projectId, params.data.id))
    .orderBy(desc(readinessSnapshotsTable.recordedAt))
    .limit(90);
  res.json(snapshots.map(s => ({
    ...s,
    recordedAt: s.recordedAt.toISOString(),
  })));
});

router.post("/projects/:id/readiness-snapshots", async (req, res): Promise<void> => {
  const params = RecordReadinessSnapshotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = RecordReadinessSnapshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [snapshot] = await db
    .insert(readinessSnapshotsTable)
    .values({ projectId: params.data.id, score: parsed.data.score })
    .returning();
  res.status(201).json({ ...snapshot, recordedAt: snapshot.recordedAt.toISOString() });
});

export default router;
