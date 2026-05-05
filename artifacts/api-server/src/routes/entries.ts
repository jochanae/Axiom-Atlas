import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, entriesTable } from "@workspace/db";
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

function serializeEntry(e: typeof entriesTable.$inferSelect) {
  return {
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  };
}

router.get("/projects/:projectId/entries", async (req, res): Promise<void> => {
  const params = ListEntriesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const query = ListEntriesQueryParams.safeParse(req.query);

  const conditions = [eq(entriesTable.projectId, params.data.projectId)];
  if (query.success && query.data.status) {
    conditions.push(eq(entriesTable.status, query.data.status));
  }

  const entries = await db
    .select()
    .from(entriesTable)
    .where(and(...conditions))
    .orderBy(entriesTable.createdAt);

  res.json(entries.map(serializeEntry));
});

router.post("/projects/:projectId/entries", async (req, res): Promise<void> => {
  const params = CreateEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db.insert(entriesTable).values({
    projectId: params.data.projectId,
    ...parsed.data,
  }).returning();
  res.status(201).json(serializeEntry(entry));
});

router.get("/entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid entry id" });
    return;
  }
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json(serializeEntry(entry));
});

router.patch("/entries/:id", async (req, res): Promise<void> => {
  const params = UpdateEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "committed") {
    updateData.lockedAt = new Date();
  }

  const [entry] = await db.update(entriesTable).set(updateData).where(eq(entriesTable.id, params.data.id)).returning();
  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json(serializeEntry(entry));
});

router.delete("/entries/:id", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(entriesTable).where(eq(entriesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/entries/:id/reopen", async (req, res): Promise<void> => {
  const params = ReopenEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [original] = await db.select().from(entriesTable).where(eq(entriesTable.id, params.data.id));
  if (!original) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  if (original.status !== "committed") {
    res.status(409).json({ error: "Only committed entries can be reopened" });
    return;
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
    costOfLesson: original.costOfLesson,
    supersedesId: original.id,
  }).returning();

  res.status(201).json(serializeEntry(newEntry));
});

export default router;
