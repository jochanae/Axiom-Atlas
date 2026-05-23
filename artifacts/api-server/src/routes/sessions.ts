import { Router, type IRouter } from "express";
import { eq, sql, and, desc, ne, lt } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db, sessionsTable, chatMessagesTable, projectsTable } from "@workspace/db";
import {
  CreateSessionBody,
  CreateSessionParams,
  GetSessionParams,
  DeleteSessionParams,
  ListSessionsParams,
  ListMessagesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const UpdateSessionTitleBody = z.object({
  title: z.string(),
});

// ── Minimal memory types (mirrors chat.ts) ───────────────────────────────────
interface MemoryEntry {
  tier: 1 | 2 | 3 | 4 | 5;
  text: string;
  createdAt: string;
  retrievalCount: number;
  lastRetrievedAt: string | null;
}
interface MemoryStore { v: 2; entries: MemoryEntry[]; }

function parseMemoryStore(raw: string | null): MemoryStore {
  if (!raw) return { v: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) return parsed as MemoryStore;
    return { v: 2, entries: [] };
  } catch { return { v: 2, entries: [] }; }
}

function appendSessionSummary(store: MemoryStore, text: string): MemoryStore {
  const entry: MemoryEntry = {
    tier: 3, text,
    createdAt: new Date().toISOString(),
    retrievalCount: 0,
    lastRetrievedAt: null,
  };
  return { ...store, entries: [...store.entries, entry] };
}

function serializeMessage(m: typeof chatMessagesTable.$inferSelect) {
  return {
    ...m,
    costUsd: m.costUsd == null ? null : Number(m.costUsd),
    createdAt: m.createdAt.toISOString(),
  };
}

// ── Background session summarizer ─────────────────────────────────────────────
// Finds the most recent unsummarized session for a project and writes a T3
// memory entry + T5 marker. Fire-and-forget — never awaited by callers.

const SUMMARIZE_MIN_MESSAGES = 3; // skip trivially short sessions
const SUMMARIZED_MARKER_PREFIX = "SESSION_SUMMARIZED:";

function isSessionSummarized(store: MemoryStore, sessionId: number): boolean {
  const marker = `${SUMMARIZED_MARKER_PREFIX}${sessionId}`;
  return store.entries.some((e) => e.text === marker);
}

function appendSummaryAndMarker(
  store: MemoryStore,
  sessionId: number,
  summaryText: string,
  now: Date
): MemoryStore {
  const marker = `${SUMMARIZED_MARKER_PREFIX}${sessionId}`;
  const t3: MemoryEntry = {
    tier: 3, text: summaryText,
    createdAt: now.toISOString(), retrievalCount: 0, lastRetrievedAt: null,
  };
  const t5: MemoryEntry = {
    tier: 5, text: marker,
    createdAt: now.toISOString(), retrievalCount: 0, lastRetrievedAt: null,
  };
  return { v: 2, entries: [...store.entries, t3, t5] };
}

async function summarizePreviousSession(
  projectId: number,
  excludeSessionId: number
): Promise<void> {
  try {
    // Find the most recent session with enough messages (not the one just created)
    const [prev] = await db
      .select({ id: sessionsTable.id, messageCount: sessionsTable.messageCount, updatedAt: sessionsTable.updatedAt })
      .from(sessionsTable)
      .where(and(
        eq(sessionsTable.projectId, projectId),
        ne(sessionsTable.id, excludeSessionId),
        lt(sessionsTable.messageCount, 1000), // safety cap
      ))
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(1);

    if (!prev || prev.messageCount < SUMMARIZE_MIN_MESSAGES) return;

    // Load project memory and check if already summarized
    const [proj] = await db
      .select({ memory: projectsTable.memory })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    const store = parseMemoryStore(proj?.memory ?? null);
    if (isSessionSummarized(store, prev.id)) return; // already done

    // Fetch messages
    const rows = await db
      .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, prev.id))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(30);

    const assistantCount = rows.filter((m) => m.role === "assistant").length;
    if (assistantCount < 2) return; // not enough substance

    const transcript = rows.reverse()
      .map((m) => `${m.role === "user" ? "You" : "Atlas"}: ${m.content.slice(0, 600)}`)
      .join("\n\n");

    // Generate summary
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const aiRes = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 220,
      messages: [{
        role: "user",
        content: `You are the memory layer of Atlas, a strategic AI partner for founders. Write a 2-3 sentence session summary covering: (1) what was discussed or decided, (2) any key tensions or open questions, (3) the logical next step. Be specific. Past tense. No markdown, no bullets.\n\nSession transcript:\n${transcript}`,
      }],
    });

    const rawSummary = (aiRes.content[0] as { type: "text"; text: string }).text.trim();
    const label = new Date(prev.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const summaryText = `[Session ${label}] ${rawSummary}`;

    const now = new Date();
    const updatedStore = appendSummaryAndMarker(store, prev.id, summaryText, now);
    await db
      .update(projectsTable)
      .set({ memory: JSON.stringify(updatedStore) })
      .where(eq(projectsTable.id, projectId));
  } catch {
    // Swallow — this is background work, never block the main flow
  }
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

// Resolve the projectId for a session and verify ownership.
async function sessionBelongsToUser(sessionId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .innerJoin(projectsTable, eq(sessionsTable.projectId, projectsTable.id))
    .where(and(eq(sessionsTable.id, sessionId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

router.get("/projects/:projectId/sessions", async (req, res): Promise<void> => {
  const params = ListSessionsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(params.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
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
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(params.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
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

  // Fire-and-forget: summarize the previous session in the background.
  // Runs after the response is sent so it never blocks session creation.
  void summarizePreviousSession(params.data.projectId, session.id);
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Session not found" }); return;
  }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
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
    messages: messages.map(serializeMessage),
  });
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateSessionTitleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const userId = (req as any).authUser.id as number;
  const [session] = await db
    .update(sessionsTable)
    .set({ title: parsed.data.title })
    .where(and(
      eq(sessionsTable.id, params.data.id),
      sql`exists (
        select 1
        from ${projectsTable}
        where ${projectsTable.id} = ${sessionsTable.projectId}
          and ${projectsTable.userId} = ${userId}
      )`,
    ))
    .returning({ id: sessionsTable.id, title: sessionsTable.title });

  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  res.json(session);
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Session not found" }); return;
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/sessions/:id/reflection-mode", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const enabled = (req.body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled boolean is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [session] = await db
    .update(sessionsTable)
    .set({ reflectionMode: enabled })
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  res.json({
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
});

router.post("/sessions/:id/idea-mode", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const enabled = (req.body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled boolean is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [session] = await db
    .update(sessionsTable)
    .set({ ideaMode: enabled })
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  res.json({
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
});

router.get("/sessions/:sessionId/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.sessionId, userId))) {
    res.status(404).json({ error: "Session not found" }); return;
  }
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, params.data.sessionId))
    .orderBy(chatMessagesTable.createdAt);
  res.json(messages.map(serializeMessage));
});

// POST /sessions/:id/summarize — write a session memory snapshot to project memory.
// Called automatically by the frontend when the user navigates away (visibilitychange).
router.post("/sessions/:id/summarize", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await sessionBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Session not found" }); return;
  }

  // Load session to get projectId
  const [session] = await db.select({ projectId: sessionsTable.projectId })
    .from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // Load last 30 messages (most recent first, then reverse for chronological)
  const rows = await db
    .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, params.data.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(30);

  const assistantCount = rows.filter(m => m.role === "assistant").length;
  if (assistantCount < 2) { res.json({ ok: true, skipped: "too few messages" }); return; }

  const transcript = rows.reverse()
    .map(m => `${m.role === "user" ? "You" : "Atlas"}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  // Load current project memory
  const [project] = await db
    .select({ memory: projectsTable.memory })
    .from(projectsTable)
    .where(eq(projectsTable.id, session.projectId))
    .limit(1);
  const store = parseMemoryStore(project?.memory ?? null);

  // Ask Claude Haiku to write a tight session summary
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const aiRes = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `You are the memory layer of Atlas, a strategic AI partner. Write a 2-3 sentence session summary covering: (1) what was discussed or built, (2) any decisions made, (3) the logical next step. Be specific. Past tense. No markdown, no bullets.\n\nSession:\n${transcript}`,
    }],
  });

  const rawSummary = (aiRes.content[0] as { type: "text"; text: string }).text.trim();
  const label = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const summaryText = `[Session ${label}] ${rawSummary}`;

  // Check if already summarized (idempotent)
  if (isSessionSummarized(store, params.data.id)) {
    res.json({ ok: true, skipped: "already summarized" });
    return;
  }

  const updatedStore = appendSummaryAndMarker(store, params.data.id, summaryText, new Date());
  await db
    .update(projectsTable)
    .set({ memory: JSON.stringify(updatedStore) })
    .where(eq(projectsTable.id, session.projectId));

  res.json({ ok: true, summary: summaryText });
});

export default router;
