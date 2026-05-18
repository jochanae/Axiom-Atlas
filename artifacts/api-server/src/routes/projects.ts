import { Router, type IRouter } from "express";
import { eq, sql, desc, and, isNotNull, inArray } from "drizzle-orm";
import { db, projectsTable, sessionsTable, entriesTable, readinessSnapshotsTable, blueprintsTable } from "@workspace/db";
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

type MapNode = {
  id: string;
  label: string;
  subType: "SPRINT" | "DECISION" | "BLOCKER" | "OPEN_QUESTION" | "OPPORTUNITY" | "RISK" | "BLUEPRINT" | "NEXT_STEP";
  status?: string;
  description?: string;
};

type BlueprintContent = {
  opportunity?: unknown;
  risks?: unknown;
  openQuestions?: unknown;
  nextSteps?: unknown;
};

function asBlueprintContent(value: unknown): BlueprintContent {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as BlueprintContent
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

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
    .orderBy(desc(projectsTable.updatedAt));

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

  if (authUser?.subscriptionTier === "free" && authUser?.role !== "super_admin") {
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
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      entityType: parsed.data.entity_type ?? "project",
      userId,
    })
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

router.get("/projects/:id/map-nodes", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const projectId = params.data.id;
  const [project] = await db
    .select({ id: projectsTable.id, entityType: projectsTable.entityType })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const entityType = project.entityType === "idea" ? "idea" : "project";
  const nodes: MapNode[] = [];

  if (entityType === "project") {
    const [sprints, decisions, blockers, openQuestions] = await Promise.all([
      db
        .select({ id: entriesTable.id, title: entriesTable.title, status: entriesTable.status })
        .from(entriesTable)
        .where(and(
          eq(entriesTable.projectId, projectId),
          sql`(upper(${entriesTable.mode}) = 'BUILD' OR lower(${entriesTable.title}) LIKE '%sprint%')`,
        )),
      db
        .select({ id: entriesTable.id, title: entriesTable.title })
        .from(entriesTable)
        .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "committed"))),
      db
        .select({ id: entriesTable.id, title: entriesTable.title, status: entriesTable.status })
        .from(entriesTable)
        .where(and(
          eq(entriesTable.projectId, projectId),
          eq(entriesTable.status, "committed"),
          sql`(lower(${entriesTable.title}) LIKE '%block%' OR lower(${entriesTable.severity}) = 'blocker')`,
        )),
      db
        .select({ id: entriesTable.id, title: entriesTable.title })
        .from(entriesTable)
        .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "parked")))
        .orderBy(desc(entriesTable.createdAt))
        .limit(5),
    ]);

    nodes.push(
      ...sprints.map((entry): MapNode => ({
        id: `sprint-${entry.id}`,
        label: entry.title,
        subType: "SPRINT",
        status: entry.status,
      })),
      ...decisions.map((entry): MapNode => ({
        id: `decision-${entry.id}`,
        label: entry.title,
        subType: "DECISION",
        status: "completed",
      })),
      ...blockers.map((entry): MapNode => ({
        id: `blocker-${entry.id}`,
        label: entry.title,
        subType: "BLOCKER",
        status: entry.status,
      })),
      ...openQuestions.map((entry): MapNode => ({
        id: `open-question-${entry.id}`,
        label: entry.title,
        subType: "OPEN_QUESTION",
        status: "backlog",
      })),
    );
  } else {
    const [blueprint] = await db
      .select({ id: blueprintsTable.id, title: blueprintsTable.title, content: blueprintsTable.content })
      .from(blueprintsTable)
      .where(and(eq(blueprintsTable.projectId, projectId), eq(blueprintsTable.userId, userId)))
      .orderBy(desc(blueprintsTable.createdAt))
      .limit(1);

    if (blueprint) {
      const content = asBlueprintContent(blueprint.content);
      if (typeof content.opportunity === "string" && content.opportunity.trim().length > 0) {
        nodes.push({
          id: `opp-${projectId}`,
          label: "The Opportunity",
          subType: "OPPORTUNITY",
          description: content.opportunity,
        });
      }

      nodes.push(
        ...stringArray(content.risks).map((risk, index): MapNode => ({
          id: `risk-${index}`,
          label: risk,
          subType: "RISK",
          status: "active",
        })),
        ...stringArray(content.openQuestions).map((question, index): MapNode => ({
          id: `oq-${index}`,
          label: question,
          subType: "OPEN_QUESTION",
          status: "backlog",
        })),
        {
          id: `bp-${blueprint.id}`,
          label: blueprint.title,
          subType: "BLUEPRINT",
          status: "completed",
        },
        ...stringArray(content.nextSteps).map((step, index): MapNode => ({
          id: `ns-${index}`,
          label: step,
          subType: "NEXT_STEP",
          status: "backlog",
        })),
      );
    }
  }

  res.json({ projectId, entityType, nodes });
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

router.post("/projects/:id/memories", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser.id as number;
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    tier?: "episodic" | "foundational" | "contextual";
    summary?: string;
  };
  const transcript = (body.messages ?? [])
    .slice(-20)
    .map((m) => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`)
    .join("\n\n");
  const summary = (body.summary?.trim() || transcript.slice(0, 1200) || "Home conversation imported.").trim();
  const tier = body.tier === "foundational" ? 1 : body.tier === "contextual" ? 4 : 3;

  let existing: { v: 2; entries: Array<Record<string, unknown>> } = { v: 2, entries: [] };
  try {
    const parsed = project.memory ? JSON.parse(project.memory) : null;
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) existing = parsed;
  } catch {
    existing = { v: 2, entries: [] };
  }

  const next = {
    v: 2,
    entries: [
      ...existing.entries,
      {
        tier,
        text: `Home conversation handoff: ${summary}`,
        createdAt: new Date().toISOString(),
        retrievalCount: 0,
        lastRetrievedAt: null,
      },
    ],
  };

  const [updated] = await db
    .update(projectsTable)
    .set({ memory: JSON.stringify(next) })
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
    .returning();

  res.json(serializeProject(updated, true));
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
