import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entriesTable, nexusMessagesTable, projectsTable, sessionsTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

router.get("/projects/:id/state", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      status: projectsTable.status,
      memory: projectsTable.memory,
      linkedRepo: projectsTable.linkedRepo,
      nodeState: projectsTable.nodeState,
      updatedAt: projectsTable.updatedAt,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [activeSessions, decisions, parked, parkedCountRows, recentContext] = await Promise.all([
    db
      .select({
        id: sessionsTable.id,
        title: sessionsTable.title,
        mode: sessionsTable.mode,
        status: sessionsTable.status,
        messageCount: sessionsTable.messageCount,
        reflectionMode: sessionsTable.reflectionMode,
        ideaMode: sessionsTable.ideaMode,
        updatedAt: sessionsTable.updatedAt,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, projectId))
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(1),
    db
      .select({
        id: entriesTable.id,
        title: entriesTable.title,
        summary: entriesTable.summary,
        status: entriesTable.status,
        severity: entriesTable.severity,
        createdAt: entriesTable.createdAt,
      })
      .from(entriesTable)
      .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "committed")))
      .orderBy(desc(entriesTable.createdAt))
      .limit(5),
    db
      .select({
        id: entriesTable.id,
        title: entriesTable.title,
        summary: entriesTable.summary,
        createdAt: entriesTable.createdAt,
      })
      .from(entriesTable)
      .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "parked")))
      .orderBy(desc(entriesTable.createdAt))
      .limit(5),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "parked"))),
    db
      .select({
        id: nexusMessagesTable.id,
        role: nexusMessagesTable.role,
        content: nexusMessagesTable.content,
        conversationId: nexusMessagesTable.conversationId,
        messageType: nexusMessagesTable.messageType,
        createdAt: nexusMessagesTable.createdAt,
      })
      .from(nexusMessagesTable)
      .where(eq(nexusMessagesTable.userId, userId))
      .orderBy(desc(nexusMessagesTable.createdAt))
      .limit(10),
  ]);

  const activeSession = activeSessions[0] ?? null;

  res.json({
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      memory: project.memory,
      linkedRepo: project.linkedRepo,
      updatedAt: project.updatedAt.toISOString(),
    },
    activeSession: activeSession
      ? {
          ...activeSession,
          updatedAt: activeSession.updatedAt.toISOString(),
        }
      : null,
    decisions: decisions.map((decision) => ({
      ...decision,
      createdAt: decision.createdAt.toISOString(),
    })),
    parked: parked.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    parkedCount: parkedCountRows[0]?.count ?? 0,
    forgeState: project.nodeState ?? {},
    memorySummary: project.memory,
    recentContext: recentContext.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  });
});

// PUT /api/projects/:id/nodeState — persist forge nodes from the frontend
const ForgeNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  resolved: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  details: z.string().optional(),
  meta: z.string().optional(),
  moscow: z.string().optional(),
  question: z.string().optional(),
});

const PutNodeStateBody = z.object({
  nodes: z.array(ForgeNodeSchema),
  replace: z.boolean().optional(), // if true, replaces instead of merging
});

router.put("/projects/:id/nodeState", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid project id" }); return;
  }

  const userId = (req as any).authUser.id as number;

  const parsed = PutNodeStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() }); return;
  }

  const [project] = await db
    .select({ id: projectsTable.id, nodeState: projectsTable.nodeState })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const { nodes, replace = false } = parsed.data;

  // Convert array → keyed map (same shape as chat.ts writes)
  const incoming = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const updated = replace
    ? incoming
    : { ...((project.nodeState as Record<string, unknown>) ?? {}), ...incoming };

  await db
    .update(projectsTable)
    .set({ nodeState: updated })
    .where(eq(projectsTable.id, projectId));

  res.json({ ok: true, count: nodes.length });
});

export default router;
