import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { bustResumeCache } from "./nexus";
import { db, projectsTable, sessionsTable, entriesTable, readinessSnapshotsTable, blueprintsTable, projectFlowCanvasTable, artifactsTable, nexusMessagesTable, applicationModelsTable } from "@workspace/db";
import { getProjectDNA, getOrCreateProjectDNA } from "../lib/projectDNA";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { createProjectForUser, ensureProjectSchema, ProjectLimitReachedError } from "../lib/projectCreation";
import { pushAtlasMdToRepo } from "../lib/projectMemory";
import { ensureProjectWorkspaceDir } from "../lib/projectWorkspace";
import { cloneRepoBackground } from "../lib/workspaceHydration";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  TouchProjectParams,
  ListRecentProjectsQueryParams,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    lastOpenedAt: p.lastOpenedAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function latestProjectActivityIso(projectUpdatedAt: Date, latestEntryAt?: string | null): string {
  if (!latestEntryAt) return projectUpdatedAt.toISOString();
  const entryTime = new Date(latestEntryAt).getTime();
  if (!Number.isFinite(entryTime) || entryTime <= projectUpdatedAt.getTime()) {
    return projectUpdatedAt.toISOString();
  }
  return new Date(entryTime).toISOString();
}

router.use("/projects", async (_req, _res, next) => {
  try {
    await ensureProjectSchema();
    next();
  } catch (error) {
    next(error);
  }
});

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
        latestEntryAt: sql<string | null>`max(greatest(${entriesTable.createdAt}, ${entriesTable.updatedAt}))::text`,
      })
      .from(entriesTable)
      .where(inArray(entriesTable.projectId, projectIds))
      .groupBy(entriesTable.projectId);
    entryStatsMap = new Map(entryStats.map(s => [s.projectId, { entryCount: s.entryCount, latestEntryAt: s.latestEntryAt }]));
  }

  res.json(projects
    .map(p => {
      const entryStats = entryStatsMap.get(p.id);
      return {
        ...serializeProject(p, false),
        updatedAt: latestProjectActivityIso(p.updatedAt, entryStats?.latestEntryAt),
        latestSnapshotScore: scoreMap.get(p.id) ?? null,
        entryCount: entryStats?.entryCount ?? 0,
        latestEntryAt: entryStats?.latestEntryAt ?? null,
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const authUser = (req as any).authUser;

  try {
    const project = await createProjectForUser({
      userId,
      authUser,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      entityType: parsed.data.entity_type ?? "project",
      status: parsed.data.status,
    });
    // Auto-initialize local workspace directory so Files tab works without GitHub
    void ensureProjectWorkspaceDir(project.id).catch(() => {/* non-fatal */});
    res.status(201).json(serializeProject(project, true));
  } catch (error) {
    if (error instanceof ProjectLimitReachedError) {
      res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
      return;
    }
    throw error;
  }
});

router.get("/projects/recent", async (req, res): Promise<void> => {
  const parsed = ListRecentProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const withinHours = parsed.data.withinHours ?? 48;
  const projects = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      status: projectsTable.status,
      lastOpenedAt: (projectsTable as any).lastOpenedAt,
    })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.userId, userId),
      sql`${(projectsTable as any).lastOpenedAt} >= now() - (${withinHours}::int * interval '1 hour')`,
    ))
    .orderBy(desc((projectsTable as any).lastOpenedAt))
    .limit(20);

  res.json({
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      last_opened_at: project.lastOpenedAt.toISOString(),
    })),
  });
});

router.post("/projects/:projectId/touch", async (req, res): Promise<void> => {
  const params = TouchProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const [project] = await db
    .update(projectsTable)
    .set({ lastOpenedAt: sql`now()` })
    .where(and(eq(projectsTable.id, params.data.projectId), eq(projectsTable.userId, userId)))
    .returning({ id: projectsTable.id });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
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
    .select({ id: projectsTable.id, entityType: (projectsTable as any).entityType })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const entityType = (project as any).entityType === "idea" ? "idea" : "project";
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

router.post("/projects/:id/activate", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id, 10);
  if (Number.isNaN(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const userId = (req as any).authUser.id as number;

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (project.status === "committed") {
    const [[amRow], [session]] = await Promise.all([
      db.select({ id: applicationModelsTable.id })
        .from(applicationModelsTable)
        .where(eq(applicationModelsTable.projectId, projectId))
        .limit(1),
      db.select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.projectId, projectId))
        .limit(1),
    ]);
    if (amRow && session) {
      res.json(serializeProject(project, true));
      return;
    }
    // Fall through — committed but hollow; create missing records below
  }

  try {
    const [existingAm] = await db
      .select({ id: applicationModelsTable.id })
      .from(applicationModelsTable)
      .where(eq(applicationModelsTable.projectId, projectId))
      .limit(1);

    if (!existingAm) {
      await getOrCreateProjectDNA(projectId);
    }

    const [existingSession] = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, projectId))
      .limit(1);

    let seedSessionId = existingSession?.id ?? null;
    if (!seedSessionId) {
      const [newSession] = await db
        .insert(sessionsTable)
        .values({ projectId, title: "Session 1", status: "active" })
        .returning({ id: sessionsTable.id });
      seedSessionId = newSession?.id ?? null;
    }

    const [existingEntry] = await db
      .select({ id: entriesTable.id })
      .from(entriesTable)
      .where(eq(entriesTable.projectId, projectId))
      .limit(1);

    if (!existingEntry && seedSessionId) {
      await db.insert(entriesTable).values({
        projectId,
        sessionId: seedSessionId,
        title: "Project activated.",
        summary: project.linkedRepo
          ? `Workspace opened from GitHub repo: ${project.linkedRepo.replace(/^github:\/\//, "")}`
          : "Workspace initialized.",
        status: "committed",
        severity: "committed",
        mode: "decide",
      });
    }

    const [updated] = await db
      .update(projectsTable)
      .set({ status: "committed" })
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Event 1 — fire Atlas Memory refresh on activation (fire-and-forget, non-blocking)
    pushAtlasMdToRepo(projectId, userId, req.log).catch(() => {});

    // Hydrate workspace: clone linked repo if workspace dir is empty (fire-and-forget)
    if (project.linkedRepo) {
      cloneRepoBackground(projectId, userId, req.log).catch(() => {});
    }

    res.json(serializeProject(updated, true));
  } catch (err) {
    req.log?.error({ err }, "activate error");
    res.status(500).json({ error: "Activation failed" });
  }
});

// POST /api/projects/create-and-activate — create a committed workspace in one shot
// Used by Atlas when the user makes an explicit "Build X" request from Global Insight.
// Returns a fully committed project (genome + session seeded) so NAVIGATE_TO can fire
// immediately without any secondary activation step.
router.post("/projects/create-and-activate", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const { name, description, buildIntent } = req.body as { name?: unknown; description?: unknown; buildIntent?: unknown };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    // 1. Create project row with committed status from the start
    const [project] = await db
      .insert(projectsTable)
      .values({
        userId,
        name: name.trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        status: "committed",
      })
      .returning();

    if (!project) {
      res.status(500).json({ error: "Failed to create project" });
      return;
    }

    const projectId = project.id;

    // 2. Seed Application Model (canonical DNA store)
    await getOrCreateProjectDNA(projectId);

    // 3. Seed session — carry the build intent so workspace Atlas knows what to build
    const buildIntentStr = typeof buildIntent === "string" && buildIntent.trim() ? buildIntent.trim() : null;
    const [session] = await db
      .insert(sessionsTable)
      .values({ projectId, title: "Session 1", status: "active", buildIntent: buildIntentStr })
      .returning({ id: sessionsTable.id });

    // 4. Seed activation entry
    if (session?.id) {
      await db.insert(entriesTable).values({
        projectId,
        sessionId: session.id,
        title: "Project created.",
        summary: "Workspace initialized from Global Insight build request.",
        status: "committed",
        severity: "committed",
        mode: "decide",
      });
    }

    // Fire-and-forget memory refresh (non-blocking)
    pushAtlasMdToRepo(projectId, userId, req.log).catch(() => {});

    res.status(201).json(serializeProject(project, true));
  } catch (err) {
    req.log?.error({ err }, "create-and-activate error");
    res.status(500).json({ error: "Failed to create and activate project" });
  }
});

// POST /api/projects/:id/refresh-atlas-memory — Event 3: manual "Refresh Atlas Memory"
router.post("/projects/:id/refresh-atlas-memory", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id, 10);
  if (Number.isNaN(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const userId = (req as any).authUser.id as number;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    await pushAtlasMdToRepo(projectId, userId, req.log);
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "refresh-atlas-memory error");
    res.status(500).json({ error: "Failed to refresh Atlas Memory" });
  }
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

router.get("/projects/:id/greeting", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [[project], genome] = await Promise.all([
    db
      .select({
        name: projectsTable.name,
        linkedRepo: projectsTable.linkedRepo,
        memory: projectsTable.memory,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId))),
    getProjectDNA(id),
  ]);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // Parse linked repo name
  let repoName: string | null = null;
  if (project.linkedRepo) {
    try {
      const parsed = JSON.parse(project.linkedRepo as string);
      repoName = typeof parsed === "string" ? parsed : (parsed.fullName ?? null);
    } catch {
      repoName = project.linkedRepo as string;
    }
  }

  // Count sessions + fetch active session's buildIntent
  const [[{ sessionCount }], activeSessionRows] = await Promise.all([
    db
      .select({ sessionCount: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, id)),
    db
      .select({ buildIntent: sessionsTable.buildIntent, messageCount: sessionsTable.messageCount })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.projectId, id), eq(sessionsTable.status, "active")))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(1),
  ]);

  // If the active session has a buildIntent and no messages yet, hand straight back to the
  // workspace — it will auto-send this as a user message through /api/chat so the
  // BUILD_HANDOFF fires and Atlas starts writing FILE_EDIT blocks immediately.
  const activeBuildIntent = activeSessionRows[0]?.buildIntent ?? null;
  const activeMessageCount = activeSessionRows[0]?.messageCount ?? 1;
  if (activeBuildIntent && activeMessageCount === 0) {
    res.json({ buildIntent: activeBuildIntent });
    return;
  }

  const ageMs = Date.now() - new Date(project.createdAt).getTime();
  const isFreshBootstrap = !!repoName && ageMs < 60 * 60 * 1000 && sessionCount <= 1;

  // Build shaping layer lines from genome
  const shapingLines: string[] = [];
  if (genome?.wedge) shapingLines.push(genome.wedge);
  else if (genome?.purpose) shapingLines.push(genome.purpose);
  if (genome?.audience) shapingLines.push(`For: ${genome.audience}`);
  if (genome?.differentiator) shapingLines.push(`Edge: ${genome.differentiator}`);
  const firstOpenQ = Array.isArray(genome?.openQuestions) ? (genome.openQuestions as string[])[0] : undefined;
  if (firstOpenQ) shapingLines.push(`Open: ${firstOpenQ}`);

  const hasShaping = shapingLines.length > 0;

  let message: string;

  if (isFreshBootstrap) {
    message = `Scaffold's live. I pushed a React + Vite + Tailwind base to \`${repoName}\` — \`src/App.tsx\`, \`vite.config.ts\`, \`tailwind.config.js\`, and 7 more files. Open the StackBlitz tab to see it.\n\nWhat are we building?`;
  } else if (repoName && hasShaping) {
    message = `What are we working on today?`;
  } else if (repoName) {
    message = `What are we working on today?`;
  } else if (hasShaping) {
    message = `${project.name}.\n\n${shapingLines.join("\n")}\n\nWhat are we building today?`;
  } else if (!repoName && ageMs < 2 * 60 * 60 * 1000 && sessionCount <= 1) {
    message = `I've created ${project.name}.\n\nWe don't need to define everything right now — that's what this space is for.\n\nTell me where your head is today. Are we exploring an idea, solving a problem, designing something new, or refining something that already exists?`;
  } else {
    message = `${project.name} — what are we working on?`;
  }

  res.json({ message });
});

router.get("/projects/:id/flow", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  const [canvas] = await db
    .select()
    .from(projectFlowCanvasTable)
    .where(eq(projectFlowCanvasTable.projectId, id));
  if (!canvas) {
    res.json({ nodes: [], edges: [] });
    return;
  }
  res.json({ nodes: canvas.nodes, edges: canvas.edges });
});

router.put("/projects/:id/flow", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  const { nodes, edges } = req.body as { nodes?: unknown[]; edges?: unknown[] };
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    res.status(400).json({ error: "nodes and edges must be arrays" });
    return;
  }
  await db
    .insert(projectFlowCanvasTable)
    .values({ projectId: id, nodes, edges })
    .onConflictDoUpdate({
      target: projectFlowCanvasTable.projectId,
      set: { nodes, edges, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

// ── Drill cache: persisted sub-node expansions keyed by nodeId:lens ──────────

router.get("/projects/:id/flow/drill-cache", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  const [canvas] = await db
    .select({ drillCache: projectFlowCanvasTable.drillCache })
    .from(projectFlowCanvasTable)
    .where(eq(projectFlowCanvasTable.projectId, id));
  res.json(canvas?.drillCache ?? {});
});

// ── Flow hydration (AI-powered from conversation history) ─────────────────────

router.post("/projects/:id/flow/hydrate", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI not configured on this server" });
    return;
  }

  const [[proj], genome, messages] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId))),
    getProjectDNA(id),
    db.select({ role: nexusMessagesTable.role, content: nexusMessagesTable.content })
      .from(nexusMessagesTable)
      .where(and(
        eq(nexusMessagesTable.projectId, id),
        sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
        sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
      ))
      .orderBy(desc(nexusMessagesTable.createdAt))
      .limit(60),
  ]);

  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  const realMessages = messages.filter(m => m.content && m.content.trim().length > 10);

  // Build genome context regardless of message count — used for both full and genome-only hydration
  const contextParts: string[] = [];
  if (genome?.purpose) contextParts.push(`Purpose: ${genome.purpose}`);
  if (genome?.stage) contextParts.push(`Stage: ${genome.stage}`);
  if (genome?.audience) contextParts.push(`Audience: ${genome.audience}`);
  if (genome?.identity) contextParts.push(`Identity: ${genome.identity}`);
  const constraints = (genome?.constraints as string[] | null) ?? [];
  const openQuestions = (genome?.openQuestions as string[] | null) ?? [];
  if (constraints.length > 0) contextParts.push(`Constraints: ${constraints.join("; ")}`);
  if (openQuestions.length > 0) contextParts.push(`Open questions: ${openQuestions.join("; ")}`);

  const hasGenomeData = contextParts.length > 0;

  if (realMessages.length < 3 && !hasGenomeData) {
    res.status(422).json({
      error: "Not enough context to hydrate. Have a few conversations with Atlas about this project first.",
    });
    return;
  }

  const projectContext = hasGenomeData ? `\nProject context:\n${contextParts.join("\n")}` : "";

  // Most-recent last, capped for context window
  const recent = [...realMessages].reverse().slice(-40);
  const formattedConversation = recent
    .map(m => `${m.role === "user" ? "You" : "Atlas"}: ${m.content.trim()}`)
    .join("\n\n");

  const conversationSection = realMessages.length >= 3
    ? `\nHere is the conversation history between the user and Atlas (their strategic thinking partner):\n\n${formattedConversation}\n\nBased on this conversation, generate a strategic flow map as a JSON object. Extract SPECIFIC goals, requirements, blockers, decisions, and priorities that were actually discussed — not generic placeholders.`
    : `\nNo conversation history is available yet. Generate a strategic flow map based on the project context above. Create SPECIFIC, plausible goals, requirements, and next steps tailored to the project's identity and purpose — not generic placeholders.`;

  const prompt = `You are building a strategic flow map for a project named "${proj.name}".${projectContext}${conversationSection}

Return ONLY a valid JSON object (no explanation, no markdown fences) with this structure:
{
  "nodes": [
    {
      "id": "goal",
      "label": "Short label (3-6 words, project-specific)",
      "type": "goal",
      "resolved": false,
      "x": 0,
      "y": 0,
      "details": "One sentence framing what winning looks like",
      "strategicAnswer": "Include only if clearly stated in the conversation"
    }
  ],
  "edges": [
    { "id": "e-goal-node1", "from": "goal", "to": "node1" }
  ]
}

Node types: goal, requirement, blocker, priority, decision, sprint, wont
Rules:
- Include EXACTLY ONE node with type "goal" and id "goal"
- Include 4-8 satellite nodes grounded in what was actually discussed
- If a decision or answer was clearly stated in the conversation, set resolved: true and include strategicAnswer
- Connect every satellite node to "goal" via an edge; add edges between related nodes too
- x and y are ignored — layout is auto-computed
- Labels must be specific to this project (e.g. "Stripe integration" not "Open decision")`;

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let aiText: string;
  try {
    const response = await anthropicClient.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    aiText = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  } catch (err) {
    req.log.error({ err }, "Flow hydrate: Anthropic call failed");
    res.status(502).json({ error: "AI service unavailable — try again in a moment" });
    return;
  }

  const jsonMatch = aiText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    req.log.error({ aiText }, "Flow hydrate: no JSON in AI response");
    res.status(502).json({ error: "AI returned an unexpected response — try again" });
    return;
  }

  let parsed: { nodes?: unknown[]; edges?: unknown[] };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { nodes?: unknown[]; edges?: unknown[] };
  } catch {
    req.log.error({ aiText }, "Flow hydrate: JSON parse failed");
    res.status(502).json({ error: "AI returned malformed JSON — try again" });
    return;
  }

  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    res.status(502).json({ error: "AI did not return valid nodes — try again" });
    return;
  }

  const hasGoal = (parsed.nodes as Array<{ type?: unknown }>).some(n => n.type === "goal");
  if (!hasGoal) {
    res.status(502).json({ error: "AI flow map is missing a goal node — try again" });
    return;
  }

  res.json({
    nodes: parsed.nodes,
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    source: "conversations",
    messageCount: realMessages.length,
  });
});

// ── Resume artifact ───────────────────────────────────────────────────────────

router.get("/projects/:id/resume", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [[proj], [existing]] = await Promise.all([
    db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId))),
    db
      .select()
      .from(artifactsTable)
      .where(and(eq(artifactsTable.projectId, id), eq(artifactsTable.type, "resume")))
      .orderBy(desc(artifactsTable.updatedAt))
      .limit(1),
  ]);
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  // Return existing artifact if present
  if (existing) { res.json({ artifact: existing }); return; }

  // No resume artifact yet — auto-generate one from DNA so the workspace
  // empty state (resumeBrief) is never null for a project with shaping data.
  const genome = await getProjectDNA(id);

  const hasShaping = genome && (genome.purpose || genome.wedge || genome.audience);
  if (!hasShaping) { res.json({ artifact: null }); return; }

  const clarityScore: number = genome.confidenceScore ?? 0;
  const openQuestions = genome.openQuestions ?? [];

  function suggestedBuildFromGenome(score: number, intent: boolean, audience: boolean): string {
    if (!intent) return "Start by defining your core intent";
    if (score < 30) return "Landing Page — begin with presence";
    if (!audience) return "Landing Page — clarify who this is for";
    if (score < 50) return "Database Schema — structure your data model";
    if (score < 65) return "Web App — your foundation is ready";
    return "Full Web App — you have everything needed";
  }

  const threadSummary = genome.wedge
    ? `${genome.wedge}${genome.differentiator ? ` — ${genome.differentiator}` : ""}${genome.audience ? ` Built for ${genome.audience}.` : ""}`
    : genome.purpose
      ? `${proj.name} is ${genome.purpose}${genome.audience ? `, built for ${genome.audience}` : ""}.`
      : `${proj.name} — still being shaped.`;

  const brief = {
    generatedAt: new Date().toISOString(),
    projectName: proj.name,
    clarityScore,
    intent: genome.purpose ?? null,
    audience: genome.audience ?? null,
    tone: genome.coreEmotion ?? null,
    openQuestions,
    suggestedFirstBuild: suggestedBuildFromGenome(clarityScore, !!genome.purpose, !!genome.audience),
    threadSummary,
    fromConversation: false,
  };

  const content = JSON.stringify(brief);
  const title = `Resume — ${proj.name}`;
  const [inserted] = await db
    .insert(artifactsTable)
    .values({ projectId: id, userId, type: "resume", title, content, status: "active", pinned: true })
    .returning();

  res.json({ artifact: inserted ?? null });
});

router.post("/projects/:id/append-thread", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [proj] = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  // Accept a Nexus conversation snapshot from the client.
  const bodyMessages = Array.isArray((req.body as Record<string, unknown>)?.messages)
    ? ((req.body as Record<string, unknown>).messages as Array<{ role: string; content: string }>)
    : [];

  // Persist the conversation transcript to nexusMessagesTable so it survives
  // page refresh and gives the workspace AI full context on subsequent turns.
  // Only write if there are no existing nexus messages for this project yet
  // (idempotent — prevents duplicates if append-thread is called twice).
  if (bodyMessages.length > 0) {
    const [existingMsg] = await db
      .select({ id: nexusMessagesTable.id })
      .from(nexusMessagesTable)
      .where(and(eq(nexusMessagesTable.projectId, id), eq(nexusMessagesTable.userId, userId)))
      .limit(1);

    if (!existingMsg) {
      const convId = randomUUID();
      const validMessages = bodyMessages.filter(
        (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
      );
      if (validMessages.length > 0) {
        await db.insert(nexusMessagesTable).values(
          validMessages.map((m) => ({
            userId,
            projectId: id,
            conversationId: convId,
            role: m.role,
            content: m.content.trim(),
          })),
        );
      }
    }
  }

  const genomeRow = await getProjectDNA(id);

  const clarityScore: number = genomeRow?.confidenceScore ?? 0;
  const hasIntent = Boolean(genomeRow?.purpose);
  const hasAudience = Boolean(genomeRow?.audience);

  function suggestedBuildFromText(text: string): string | null {
    const t = text.toLowerCase();
    if (t.includes("landing page")) return "Landing Page — begin with presence";
    if (t.includes("mobile app") || t.includes("ios") || t.includes("android")) return "Mobile App — bring it to the device";
    if (t.includes("investor") || t.includes("pitch deck")) return "Investor Deck — make the case";
    if (t.includes("beta") || t.includes("waitlist") || t.includes("early access")) return "Beta Program — validate with real users";
    if (t.includes("web app") || t.includes("dashboard") || t.includes("platform")) return "Web App — your foundation is ready";
    if (t.includes("database") || t.includes("schema") || t.includes("data model")) return "Database Schema — structure your data model";
    return null;
  }

  function suggestedBuildFromGenome(score: number, intent: boolean, audience: boolean): string {
    if (!intent) return "Start by defining your core intent";
    if (score < 30) return "Landing Page — begin with presence";
    if (!audience) return "Landing Page — clarify who this is for";
    if (score < 50) return "Database Schema — structure your data model";
    if (score < 65) return "Web App — your foundation is ready";
    return "Full Web App — you have everything needed";
  }

  const openQuestions = Array.isArray(genomeRow?.openQuestions) ? genomeRow.openQuestions as string[] : [];

  // Derive thread summary: prefer the last substantive assistant message from the
  // conversation snapshot, then fall back to genome-derived narrative.
  const lastAssistantMsg = bodyMessages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 40);

  const conversationText = bodyMessages.map((m) => m.content).join(" ");

  const threadSummary = lastAssistantMsg
    ? lastAssistantMsg.content.trim().slice(0, 600)
    : hasIntent
      ? `${proj.name} is ${genomeRow?.purpose ?? "a project in development"}${genomeRow?.audience ? `, built for ${String(genomeRow.audience)}` : ""}${genomeRow?.coreEmotion ? `, with a ${String(genomeRow.coreEmotion)} tone` : ""}.`
      : `${proj.name} is still being defined. Continue the conversation to build clarity.`;

  const suggestedFirstBuild =
    (conversationText ? suggestedBuildFromText(conversationText) : null) ??
    suggestedBuildFromGenome(clarityScore, hasIntent, hasAudience);

  const brief = {
    generatedAt: new Date().toISOString(),
    projectName: proj.name,
    clarityScore,
    intent: genomeRow?.purpose ?? null,
    audience: genomeRow?.audience ?? null,
    tone: genomeRow?.coreEmotion ?? null,
    openQuestions,
    suggestedFirstBuild,
    threadSummary,
    fromConversation: bodyMessages.length > 0,
  };

  const content = JSON.stringify(brief);
  const title = `Resume — ${proj.name}`;

  const [existing] = await db
    .select({ id: artifactsTable.id })
    .from(artifactsTable)
    .where(and(eq(artifactsTable.projectId, id), eq(artifactsTable.type, "resume")))
    .orderBy(desc(artifactsTable.updatedAt))
    .limit(1);

  let artifact;
  if (existing) {
    const [updated] = await db
      .update(artifactsTable)
      .set({ content, title, updatedAt: new Date() })
      .where(eq(artifactsTable.id, existing.id))
      .returning();
    artifact = updated;
  } else {
    const [inserted] = await db
      .insert(artifactsTable)
      .values({ projectId: id, userId, type: "resume", title, content, status: "active", pinned: true })
      .returning();
    artifact = inserted;
  }

  // Invalidate the resume cache so the workspace opens with fresh context,
  // not the pre-append snapshot. Fixes: "still being defined" showing after append.
  bustResumeCache(userId);

  res.json({ ok: true, artifact, brief });
});

// ── POST /api/projects/:id/editorial — Atlas editorial analysis ───────────────
router.post("/:id/editorial", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { text } = req.body as { text?: string };
  if (!text || text.trim().length < 10) {
    res.status(400).json({ error: "Text must be at least 10 characters" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI not configured on this server" });
    return;
  }

  const [[proj], genome] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId))),
    getProjectDNA(id),
  ]);

  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  const contextParts: string[] = [];
  if (genome?.purpose)        contextParts.push(`Purpose: ${genome.purpose}`);
  if (genome?.audience)       contextParts.push(`Audience: ${genome.audience}`);
  if (genome?.stage)          contextParts.push(`Stage: ${genome.stage}`);
  if (genome?.identity)       contextParts.push(`Identity: ${genome.identity}`);
  if (genome?.wedge)          contextParts.push(`Wedge: ${genome.wedge}`);
  if (genome?.differentiator) contextParts.push(`Edge: ${genome.differentiator}`);

  const projectContext = contextParts.length > 0
    ? `\nProject context — "${proj.name}":\n${contextParts.join("\n")}`
    : `\nProject: "${proj.name}"`;

  const systemPrompt = `You are Atlas — a world-class developmental editor and writing partner. Your job is to give the writer honest, specific, actionable editorial feedback that protects their voice while ruthlessly optimizing for clarity, structure, and impact.

Analyze the submitted text and return a structured report with exactly these four sections. Use these headers verbatim:

## ✦ VOICE FINGERPRINT

## ✦ ARCHITECTURE REVIEW

## ✦ THE TRIMMER

## ✦ COGNITIVE LOAD

Section instructions:

VOICE FINGERPRINT: Characterize this writer's specific style — sentence length patterns, vocabulary register (formal/casual/technical), pacing, any distinctive phrases or tics. Then flag passages where the voice becomes inconsistent or slips into a different register. Format flagged items as:
"quoted passage"
→ what's happening and why it disrupts the voice

ARCHITECTURE REVIEW: Map the structural skeleton of the piece. Identify the core argument or narrative purpose, how the sections are organized, and the quality of transitions. Flag: abandoned threads, conclusions that introduce new arguments, unsupported claims, or structural dead-ends. Format:
"quoted passage"
→ the structural problem and what to do

THE TRIMMER: List the specific phrases, sentences, or clauses to cut or compress. Target ruthlessly: passive voice constructions, filler words (actually, basically, just, very, really, quite, sort of), nominalization bloat (e.g. "make a decision" → "decide"), ideas that repeat without adding, and hedging that weakens the point. Format:
"quoted passage"
→ cut/compress instruction with one-line rationale

COGNITIVE LOAD: Identify where a reader will disengage, skim, or get lost. This includes: dense paragraphs with too many ideas, unexplained jargon, abrupt context shifts, and sentences that require re-reading. Format:
"quoted passage"
→ specific fix (break into bullets / add analogy / define term / shorten / restructure)

Rules:
- Every observation MUST quote the exact passage it refers to, verbatim, in quotation marks
- Never give generic advice — all feedback must be specific to this document
- Adapt your register to the writer's voice — suggest edits in their style, not yours
- If a section genuinely has no significant issues, write "No issues found." and move on — don't invent problems
- Focus on the 2–4 most important observations per section, not an exhaustive list
- Be direct and honest. The writer hired a great editor, not a cheerleader
${projectContext}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const writeSSE = (event: object) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
  };

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = await anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Please analyze this text:\n\n${text.trim()}` }],
    });

    let accumulated = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        writeSSE({ type: "token", token: event.delta.text });
      }
    }

    writeSSE({ type: "done", content: accumulated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    writeSSE({ type: "error", error: msg });
  } finally {
    res.end();
  }
});

// ── Atlas Review Engine ────────────────────────────────────────────────────────
// Unified context-hydrated judgment endpoint.
// Each profile declares what it needs and how to build its system prompt.
// The /editorial route above is kept as a backward-compat alias.

type ReviewContextKey = "genome" | "decisions";

interface ReviewContext {
  projectName: string;
  genome?: {
    purpose?: string | null;
    audience?: string | null;
    stage?: string | null;
    identity?: string | null;
    wedge?: string | null;
    differentiator?: string | null;
  } | null;
  decisions?: Array<{
    title: string;
    summary?: string | null;
    contextWhat?: string | null;
    contextWhy?: string | null;
    createdAt: Date;
  }>;
}

interface ReviewProfileConfig {
  requiredContext: ReviewContextKey[];
  maxTokens: number;
  buildSystemPrompt: (ctx: ReviewContext) => string;
}

function buildGenomeBlock(ctx: ReviewContext): string {
  const g = ctx.genome;
  if (!g) return "";
  const lines: string[] = [];
  if (g.purpose)        lines.push(`Purpose: ${g.purpose}`);
  if (g.audience)       lines.push(`Audience: ${g.audience}`);
  if (g.stage)          lines.push(`Stage: ${g.stage}`);
  if (g.identity)       lines.push(`Identity: ${g.identity}`);
  if (g.wedge)          lines.push(`Wedge: ${g.wedge}`);
  if (g.differentiator) lines.push(`Edge: ${g.differentiator}`);
  return lines.length ? `\nProject Genome — "${ctx.projectName}":\n${lines.join("\n")}` : `\nProject: "${ctx.projectName}"`;
}

const REVIEW_PROFILES: Record<string, ReviewProfileConfig> = {
  editorial: {
    requiredContext: ["genome"],
    maxTokens: 2000,
    buildSystemPrompt: (ctx) => {
      return `You are Atlas — a world-class developmental editor and writing partner. Your job is to give the writer honest, specific, actionable editorial feedback that protects their voice while ruthlessly optimizing for clarity, structure, and impact.

Analyze the submitted text and return a structured report with exactly these four sections. Use these headers verbatim:

## ✦ VOICE FINGERPRINT

## ✦ ARCHITECTURE REVIEW

## ✦ THE TRIMMER

## ✦ COGNITIVE LOAD

Section instructions:

VOICE FINGERPRINT: Characterize this writer's specific style — sentence length patterns, vocabulary register (formal/casual/technical), pacing, any distinctive phrases or tics. Then flag passages where the voice becomes inconsistent or slips into a different register. Format flagged items as:
"quoted passage"
→ what's happening and why it disrupts the voice

ARCHITECTURE REVIEW: Map the structural skeleton of the piece. Identify the core argument or narrative purpose, how the sections are organized, and the quality of transitions. Flag: abandoned threads, conclusions that introduce new arguments, unsupported claims, or structural dead-ends. Format:
"quoted passage"
→ the structural problem and what to do

THE TRIMMER: List the specific phrases, sentences, or clauses to cut or compress. Target ruthlessly: passive voice constructions, filler words (actually, basically, just, very, really, quite, sort of), nominalization bloat (e.g. "make a decision" → "decide"), ideas that repeat without adding, and hedging that weakens the point. Format:
"quoted passage"
→ cut/compress instruction with one-line rationale

COGNITIVE LOAD: Identify where a reader will disengage, skim, or get lost. This includes: dense paragraphs with too many ideas, unexplained jargon, abrupt context shifts, and sentences that require re-reading. Format:
"quoted passage"
→ specific fix (break into bullets / add analogy / define term / shorten / restructure)

Rules:
- Every observation MUST quote the exact passage it refers to, verbatim, in quotation marks
- Never give generic advice — all feedback must be specific to this document
- Adapt your register to the writer's voice — suggest edits in their style, not yours
- If a section genuinely has no significant issues, write "No issues found." and move on — don't invent problems
- Focus on the 2–4 most important observations per section, not an exhaustive list
- Be direct and honest. The writer hired a great editor, not a cheerleader
${buildGenomeBlock(ctx)}`;
    },
  },

  strategy: {
    requiredContext: ["genome", "decisions"],
    maxTokens: 2500,
    buildSystemPrompt: (ctx) => {
      const genomeBlock = buildGenomeBlock(ctx);

      const decisionBlock = ctx.decisions && ctx.decisions.length > 0
        ? `\nDecision Ledger (${ctx.decisions.length} most recent decisions):\n${ctx.decisions.map((d, i) => {
            const date = new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const parts = [`${i + 1}. [${date}] ${d.title}`];
            if (d.contextWhat) parts.push(`   What: ${d.contextWhat}`);
            if (d.contextWhy)  parts.push(`   Why: ${d.contextWhy}`);
            if (d.summary)     parts.push(`   Note: ${d.summary}`);
            return parts.join("\n");
          }).join("\n\n")}`
        : "\nDecision Ledger: No recorded decisions yet.";

      return `You are Atlas — acting as a strategic partner with full memory of this project's history. Your job is to evaluate whether this document is coherent with the project's established identity, past decisions, and strategic direction. You are not editing prose — you are auditing strategic integrity.

Analyze the submitted text and return a report with exactly these four sections. Use these headers verbatim:

## ✦ STRATEGIC COHERENCE

## ✦ TEMPORAL CONTRADICTIONS

## ✦ MISSING ASSUMPTIONS

## ✦ RISKS & OPPORTUNITIES

Section instructions:

STRATEGIC COHERENCE: Evaluate whether the text aligns with the project's genome — its stated purpose, audience, identity, and differentiator. Flag passages that drift from or contradict the established positioning. Format:
"quoted passage"
→ how this conflicts with [specific genome field] and what to do

TEMPORAL CONTRADICTIONS: Cross-reference the text against the Decision Ledger. If any passage conflicts with, undermines, or ignores a recorded decision, call it out explicitly — name the decision and its date. Format:
"quoted passage"
→ conflicts with the [Date] decision to [decision title]. Reconcile or update the ledger.

MISSING ASSUMPTIONS: Identify claims, assertions, or directions in the text that rest on unstated assumptions or that lack grounding in the project's established context. These are strategic fragility points. Format:
"quoted passage"
→ unstated assumption: [what this requires to be true that hasn't been established]

RISKS & OPPORTUNITIES: Flag strategic risks introduced by the text's direction, and identify any positioning opportunities the text hints at but doesn't fully develop. Format each as either:
⚠ Risk: [quoted passage] → [what could go wrong]
✦ Opportunity: [quoted passage] → [what could be developed]

Rules:
- Every finding MUST quote the exact passage it refers to
- When citing a decision, always include its date from the ledger
- If a section has no significant issues, write "No issues found." — never invent problems
- Focus on the 2–4 most important findings per section
- Your role is strategic, not linguistic. Do not comment on grammar, style, or prose unless it directly affects strategic clarity
${genomeBlock}${decisionBlock}`;
    },
  },
};

router.post("/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { text, profile = "editorial" } = req.body as { text?: string; profile?: string };
  if (!text || text.trim().length < 10) {
    res.status(400).json({ error: "Text must be at least 10 characters" });
    return;
  }

  const profileConfig = REVIEW_PROFILES[profile];
  if (!profileConfig) {
    res.status(400).json({ error: `Unknown review profile: "${profile}". Valid profiles: ${Object.keys(REVIEW_PROFILES).join(", ")}` });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI not configured on this server" });
    return;
  }

  const [[proj]] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId))),
  ]);

  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }

  // ── Context hydration ────────────────────────────────────────────────────────
  const ctx: ReviewContext = { projectName: proj.name };

  await Promise.all(profileConfig.requiredContext.map(async (key) => {
    if (key === "genome") {
      ctx.genome = await getProjectDNA(id);
    }

    if (key === "decisions") {
      ctx.decisions = await db.select({
        title: entriesTable.title,
        summary: entriesTable.summary,
        contextWhat: entriesTable.contextWhat,
        contextWhy: entriesTable.contextWhy,
        createdAt: entriesTable.createdAt,
      })
        .from(entriesTable)
        .where(and(eq(entriesTable.projectId, id), eq(entriesTable.type, "Decision")))
        .orderBy(desc(entriesTable.createdAt))
        .limit(30);
    }
  }));

  const systemPrompt = profileConfig.buildSystemPrompt(ctx);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const writeSSE = (event: object) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
  };

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = await anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: profileConfig.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: `Please analyze this text:\n\n${text.trim()}` }],
    });

    let accumulated = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        writeSSE({ type: "token", token: event.delta.text });
      }
    }

    writeSSE({ type: "done", content: accumulated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Review failed";
    writeSSE({ type: "error", error: msg });
  } finally {
    res.end();
  }
});

export default router;
