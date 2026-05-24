import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { eq, and, sql, desc, getTableColumns } from "drizzle-orm";
import { db, entriesTable, projectsTable } from "@workspace/db";
import {
  CreateEntryBody,
  CreateEntryParams,
  UpdateEntryBody,
  UpdateEntryParams,
  DeleteEntryParams,
  ListEntriesParams,
  ListEntriesQueryParams,
  ReopenEntryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type EntryContextResponse = {
  whatItMeans: string;
  whyItComesUp: string;
};

function serializeEntry(e: typeof entriesTable.$inferSelect) {
  return {
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  };
}

function parseContextJson(raw: string): EntryContextResponse | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<EntryContextResponse>;
    if (typeof parsed.whatItMeans !== "string" || typeof parsed.whyItComesUp !== "string") return null;
    return {
      whatItMeans: parsed.whatItMeans.trim(),
      whyItComesUp: parsed.whyItComesUp.trim(),
    };
  } catch {
    return null;
  }
}

// Verify that a project exists and is owned by the given userId.
async function projectBelongsToUser(projectId: number, userId: number): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

// Verify that an entry exists and its project is owned by the given userId.
async function entryBelongsToUser(entryId: number, userId: number): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: entriesTable.id })
      .from(entriesTable)
      .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
      .where(and(eq(entriesTable.id, entryId), eq(projectsTable.userId, userId)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

// GET /api/entries/all — all committed entries for the user across all projects
router.get("/entries/all", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const rows = await db
    .select({
      id: entriesTable.id,
      projectId: entriesTable.projectId,
      projectName: projectsTable.name,
      title: entriesTable.title,
      summary: entriesTable.summary,
      details: entriesTable.details,
      status: entriesTable.status,
      severity: entriesTable.severity,
      verb: entriesTable.verb,
      supersedesId: entriesTable.supersedesId,
      lockedAt: entriesTable.lockedAt,
      createdAt: entriesTable.createdAt,
      updatedAt: entriesTable.updatedAt,
    })
    .from(entriesTable)
    .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(entriesTable.createdAt));
  res.json(rows.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  })));
});

router.get("/projects/:projectId/entries", async (req, res): Promise<void> => {
  const params = ListEntriesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(params.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const query = ListEntriesQueryParams.safeParse(req.query);
  const conditions = [eq(entriesTable.projectId, params.data.projectId)];
  if (query.success && query.data.status) {
    conditions.push(eq(entriesTable.status, query.data.status));
  }

  // Free tier: only show entries created within the last 24 hours
  const authUser = (req as any).authUser;
  if (authUser?.subscriptionTier === "free") {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    conditions.push(sql`${entriesTable.createdAt} >= ${cutoff.toISOString()}`);
  }

  try {
    const entries = await db
      .select()
      .from(entriesTable)
      .where(and(...conditions))
      .orderBy(entriesTable.createdAt);
    res.json(entries.map(serializeEntry));
  } catch {
    res.json([]);
  }
});

router.post("/projects/:projectId/entries", async (req, res): Promise<void> => {
  const params = CreateEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (!parsed.data.title.trim()) { res.status(400).json({ error: "Title cannot be blank" }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await projectBelongsToUser(params.data.projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }
  const { costOfLesson, ...rest } = parsed.data;
  const [entry] = await db.insert(entriesTable).values({
    projectId: params.data.projectId,
    ...rest,
    title: parsed.data.title.trim(),
    ...(costOfLesson != null ? { costOfLesson: String(costOfLesson) } : {}),
  }).returning();
  res.status(201).json(serializeEntry(entry));
});

router.get("/entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid entry id" }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
  res.json(serializeEntry(entry));
});

router.post("/entries/:id/context", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid entry id" }); return; }

  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }

  const [row] = await db
    .select({
      ...getTableColumns(entriesTable),
      projectName: projectsTable.name,
    })
    .from(entriesTable)
    .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
    .where(eq(entriesTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Entry not found" }); return; }

  const { projectName, ...entry } = row;
  if (entry.contextWhat && entry.contextWhy) {
    res.json({ whatItMeans: entry.contextWhat, whyItComesUp: entry.contextWhy });
    return;
  }

  const prompt = `You are explaining a product decision to a non-technical founder.

Entry title: ${entry.title}
Entry summary: ${entry.summary ?? ""}
Project: ${projectName}

Respond with a JSON object only, no markdown:
{
  "whatItMeans": "One analogy sentence using everyday language. No jargon.",
  "whyItComesUp": "One sentence explaining why this specific decision matters for ${projectName}. Be specific to this project, not generic."
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parseContextJson(raw);
    if (!parsed) throw new Error("Invalid context JSON");

    await db
      .update(entriesTable)
      .set({ contextWhat: parsed.whatItMeans, contextWhy: parsed.whyItComesUp })
      .where(eq(entriesTable.id, id));

    res.json(parsed);
  } catch {
    res.status(502).json({
      whatItMeans: entry.summary ?? entry.title,
      whyItComesUp: entry.summary ?? entry.title,
    });
  }
});

router.patch("/entries/:id", async (req, res): Promise<void> => {
  const params = UpdateEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.title !== undefined && !parsed.data.title.trim()) {
    res.status(400).json({ error: "Title cannot be blank" }); return;
  }
  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.title !== undefined) {
    updateData.title = parsed.data.title.trim();
  }
  if (parsed.data.status === "committed") {
    updateData.lockedAt = new Date();
  }
  const [entry] = await db.update(entriesTable).set(updateData).where(eq(entriesTable.id, params.data.id)).returning();
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
  res.json(serializeEntry(entry));
});

router.delete("/entries/:id", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }
  await db.delete(entriesTable).where(eq(entriesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/entries/:id/reopen", async (req, res): Promise<void> => {
  const params = ReopenEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }
  const [original] = await db.select().from(entriesTable).where(eq(entriesTable.id, params.data.id));
  if (!original) { res.status(404).json({ error: "Entry not found" }); return; }
  if (original.status !== "committed") {
    res.status(409).json({ error: "Only committed entries can be reopened" }); return;
  }
  const [newEntry] = await db.insert(entriesTable).values({
    projectId: original.projectId,
    sessionId: original.sessionId,
    status: "draft",
    title: original.title,
    summary: original.summary,
    details: original.details,
    verb: original.verb,
    mode: original.mode,
    severity: original.severity,
    isViolation: original.isViolation,
    deviation: original.deviation,
    buildId: original.buildId,
    touched: original.touched,
    ...(original.costOfLesson != null ? { costOfLesson: String(original.costOfLesson) } : {}),
    supersedesId: original.id,
  }).returning();
  res.status(201).json(serializeEntry(newEntry));
});

export default router;
