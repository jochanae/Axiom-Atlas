import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, sessionsTable, chatMessagesTable } from "@workspace/db";
import {
  CreateSessionBody,
  CreateSessionParams,
  GetSessionParams,
  DeleteSessionParams,
  ListSessionsParams,
  ListMessagesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects/:projectId/sessions", async (req, res): Promise<void> => {
  const params = ListSessionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.projectId, params.data.projectId))
    .orderBy(sessionsTable.updatedAt);
  res.json(sessions.map(s => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  })));
});

router.post("/projects/:projectId/sessions", async (req, res): Promise<void> => {
  const params = CreateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { seedMessage, seedIntentType, ...sessionFields } = parsed.data;
  const [session] = await db.insert(sessionsTable).values({
    projectId: params.data.projectId,
    ...sessionFields,
  }).returning();
  if (seedMessage && seedMessage.trim().length > 0) {
    await db.insert(chatMessagesTable).values({
      sessionId: session.id,
      role: "assistant",
      content: seedMessage,
      intentType: seedIntentType ?? "handover_snapshot",
    });
    await db
      .update(sessionsTable)
      .set({ messageCount: sql`${sessionsTable.messageCount} + 1` })
      .where(eq(sessionsTable.id, session.id));
  }
  res.status(201).json({
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, params.data.id))
    .orderBy(chatMessagesTable.createdAt);
  res.json({
    session: {
      ...session,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    },
    messages: messages.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/sessions/:sessionId/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, params.data.sessionId))
    .orderBy(chatMessagesTable.createdAt);
  res.json(messages.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  })));
});

export default router;
