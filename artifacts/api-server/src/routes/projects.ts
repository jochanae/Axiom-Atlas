import { Router, type IRouter } from "express";
import { eq, sql, desc, and, isNotNull, inArray } from "drizzle-orm";
import { db, projectsTable, sessionsTable, entriesTable, readinessSnapshotsTable } from "@workspace/db";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
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

// Strip GitHub token from outbound project objects — never expose it in list responses.
// The token is returned in single-project GET only (owner-scoped via tenant isolation).
function serializeProject(p: typeof projectsTable.$inferSelect, includeToken = false) {
  const { githubToken, ...rest } = p;
  const plainToken = githubToken ? decryptToken(githubToken) : null;
  return {
    ...rest,
    hasGithubToken: !!githubToken,
    ...(includeToken ? { githubToken: plainToken } : {}),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/projects", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;

  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(projectsTable.updatedAt);

  let latestScores: Array<{ projectId: number; score: number }> = [];
  try {
    latestScores = await db
      .select({
        projectId: readinessSnapshotsTable.projectId,
        score: readinessSnapshotsTable.score,
      })
      .from(readinessSnapshotsTable)
      .where(
        sql`id IN (
          SELECT DISTINCT ON (project_id) id
          FROM readiness_snapshots
          ORDER BY project_id, recorded_at DESC, id DESC
        )`
      );
  } catch {
    // Table may not exist in test environments — gracefully skip snapshot scores
  }

  const scoreMap = new Map(latestScores.map(s => [s.projectId, s.score]));

  const projectIds = projects.map(p => p.id);
  let entryStatsMap = new Map<number, { entryCount: number; latestEntryAt: string | null }>();
  if (projectIds.length > 0) {
    const entryStats = await db
      .select({
        projectId: entriesTable.projectId,
        entryCount: sql<number>`count(*)::int`,
        latestEntryAt: sql<string | null>`max(created_at)::text`,
      })
      .from(entriesTable)
      .where(inArray(entriesTable.projectId, projectIds))
      .groupBy(entriesTable.projectId);
    entryStatsMap = new Map(entryStats.map(s => [s.projectId, { entryCount: s.entryCount, latestEntryAt: s.latestEntryAt }]));
  }

  res.json(projects.map(p => ({
    ...serializeProject(p, false),
    latestSnapshotScore: scoreMap.get(p.id) ?? null,
    entryCount: entryStatsMap.get(p.id)?.entryCount ?? 0,
    latestEntryAt: entryStatsMap.get(p.id)?.latestEntryAt ?? null,
  })));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const authUser = (req as any).authUser;

  if (authUser?.subscriptionTier === "free") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId));
    if (count >= 1) {
      res.status(402).json({
        error: "Free plan is limited to 1 project.",
        code: "PROJECT_LIMIT_REACHED",
      });
      return;
    }
  }

  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, userId })
    .returning();

  // Auto-propagate GitHub token from any existing project of this user
  if (!project.githubToken) {
    const [sibling] = await db
      .select({ githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(and(eq(projectsTable.userId, userId), isNotNull(projectsTable.githubToken)))
      .limit(1);
    if (sibling?.githubToken) {
      await db
        .update(projectsTable)
        .set({ githubToken: sibling.githubToken })
        .where(eq(projectsTable.id, project.id));
      project.githubToken = sibling.githubToken;
    }
  }

  res.status(201).json(serializeProject(project, true));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = (req as any).authUser.id as number;
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Single-project GET includes the token for the authenticated owner
  res.json(serializeProject(project, true));
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
  const userId = (req as any).authUser.id as number;
  const { lastHandoverAt, githubToken: rawToken, ...rest } = parsed.data;
  const updateValues = {
    ...rest,
    ...(lastHandoverAt !== undefined
      ? { lastHandoverAt: lastHandoverAt === null ? null : new Date(lastHandoverAt) }
      : {}),
    ...(rawToken !== undefined
      ? { githubToken: rawToken === null ? null : encryptToken(rawToken) }
      : {}),
  };
  const [project] = await db
    .update(projectsTable)
    .set(updateValues)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(serializeProject(project, true));
});

router.post("/projects/:id/clone", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser.id as number;
  const [source] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Project not found" }); return; }
  const [clone] = await db.insert(projectsTable).values({
    name: `${source.name} (Copy)`,
    description: source.description ?? undefined,
    userId, // clone belongs to the same user; token is intentionally NOT copied
  }).returning();
  const entries = await db.select().from(entriesTable).where(eq(entriesTable.projectId, id));
  if (entries.length > 0) {
    await db.insert(entriesTable).values(entries.map(e => ({
      projectId: clone.id,
      title: e.title,
      summary: e.summary,
      details: e.details,
      status: e.status,
      severity: e.severity,
      verb: e.verb,
      mode: e.mode,
    })));
  }
  res.status(201).json(serializeProject(clone, false));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = (req as any).authUser.id as number;
  await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  res.sendStatus(204);
});

router.get("/projects/:id/summary", async (req, res): Promise<void> => {
  const params = GetProjectSummaryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const userId = (req as any).authUser.id as number;

  // Verify ownership first
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

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
  const userId = (req as any).authUser.id as number;
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

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
  const userId = (req as any).authUser.id as number;
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  const [snapshot] = await db
    .insert(readinessSnapshotsTable)
    .values({ projectId: params.data.id, score: parsed.data.score })
    .returning();
  res.status(201).json({ ...snapshot, recordedAt: snapshot.recordedAt.toISOString() });
});

export default router;
