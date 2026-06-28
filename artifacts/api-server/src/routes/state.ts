import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entriesTable, nexusMessagesTable, projectsTable, sessionsTable } from "@workspace/db";

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
      forgedAt: projectsTable.forgedAt,
      dismissedAt: projectsTable.dismissedAt,
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
        reflectionMode: (sessionsTable as any).reflectionMode,
        ideaMode: (sessionsTable as any).ideaMode,
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
    forgeState: {
      forged: !!project.forgedAt,
      dismissed: !!project.dismissedAt,
      forgedAt: project.forgedAt?.toISOString() ?? null,
      dismissedAt: project.dismissedAt?.toISOString() ?? null,
    },
    memorySummary: project.memory,
    recentContext: recentContext.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  });
});

export default router;
