import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { eq, and, sql, desc, getTableColumns } from "drizzle-orm";
import { db, entriesTable, projectsTable, applicationModelHistoryTable, applicationModelsTable } from "@workspace/db";
import { upsertEmbedding } from "../lib/embeddings";
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
  whyItMatters?: string;
  options?: string[];
  complexity?: "Low" | "Medium" | "High";
  revisitWhen?: string;
  atlasCategory?: string;
};

type ParkEnrichmentLite = {
  atlasCategory: string;
  complexity: "Low" | "Medium" | "High";
  whyItMatters: string;
  _level: "lite";
};

type ParkEnrichment = {
  whyItMatters: string;
  options: string[];
  complexity: "Low" | "Medium" | "High";
  revisitWhen: string;
  atlasCategory: string;
  whatItMeans: string;
  whyItComesUp: string;
  _level?: "full";
};

function serializeEntry(e: typeof entriesTable.$inferSelect) {
  return {
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  };
}

async function touchProjectActivity(projectId: number): Promise<void> {
  await db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId));
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

const COMPLEXITIES = ["Low", "Medium", "High"] as const;
const CATEGORIES = ["Opportunity", "Decision", "Improvement", "Question", "Future Build"] as const;

function parseLiteEnrichmentJson(raw: string): ParkEnrichmentLite | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ParkEnrichmentLite>;
    if (!parsed.whyItMatters) return null;
    return {
      atlasCategory: CATEGORIES.includes(parsed.atlasCategory as never) ? parsed.atlasCategory as string : "Opportunity",
      complexity: COMPLEXITIES.includes(parsed.complexity as never) ? parsed.complexity as "Low" | "Medium" | "High" : "Medium",
      whyItMatters: String(parsed.whyItMatters).trim(),
      _level: "lite",
    };
  } catch {
    return null;
  }
}

function parseParkEnrichmentJson(raw: string): ParkEnrichment | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ParkEnrichment>;
    if (!parsed.whyItMatters || !parsed.whatItMeans) return null;
    return {
      whyItMatters: String(parsed.whyItMatters).trim(),
      options: Array.isArray(parsed.options) ? (parsed.options as unknown[]).map(String) : [],
      complexity: COMPLEXITIES.includes(parsed.complexity as never) ? parsed.complexity as "Low" | "Medium" | "High" : "Medium",
      revisitWhen: String(parsed.revisitWhen ?? "").trim(),
      atlasCategory: CATEGORIES.includes(parsed.atlasCategory as never) ? parsed.atlasCategory as string : "Opportunity",
      whatItMeans: String(parsed.whatItMeans).trim(),
      whyItComesUp: String(parsed.whyItComesUp ?? parsed.whyItMatters).trim(),
      _level: "full",
    };
  } catch {
    return null;
  }
}

// Lightweight enrichment — runs immediately on park (fast, cheap).
// Generates only category + complexity + one-sentence whyItMatters.
// Deep enrichment (options, revisitWhen, alternatives) happens on demand
// when the detail panel is opened via POST /entries/:id/context.
async function enrichParkedEntry(entryId: number, title: string, summary: string | null, projectName: string): Promise<void> {
  const prompt = `You are Atlas — a strategic thinking partner inside Axiom, a product development workspace.

A user just parked this thought for later. Return ONLY a JSON object, no markdown, no explanation.

Parked thought: "${title}"
${summary ? `Context: ${summary}` : ""}
Project: ${projectName}

Return exactly:
{
  "atlasCategory": "Opportunity",
  "complexity": "Medium",
  "whyItMatters": "One sentence — why this matters for the project."
}

atlasCategory values: Opportunity, Decision, Improvement, Question, Future Build
complexity values: Low, Medium, High`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parseLiteEnrichmentJson(raw);
    if (!parsed) return;
    await db
      .update(entriesTable)
      .set({ enrichmentJson: JSON.stringify(parsed) })
      .where(eq(entriesTable.id, entryId));
  } catch {
    // fire-and-forget: silently skip on error
  }
}

// Deep enrichment — runs on demand when the detail panel is opened.
// Upgrades a lite enrichment to a full one with options, revisitWhen, etc.
async function deepEnrichParkedEntry(entryId: number, title: string, summary: string | null, projectName: string, lite: ParkEnrichmentLite): Promise<ParkEnrichment | null> {
  const prompt = `You are Atlas — a strategic thinking partner inside Axiom, a product development workspace.

A user parked this thought and is now looking at it more closely. Return ONLY a JSON object, no markdown.

Parked thought: "${title}"
${summary ? `Context: ${summary}` : ""}
Project: ${projectName}
Already known: category=${lite.atlasCategory}, complexity=${lite.complexity}

Return exactly:
{
  "whyItMatters": "${lite.whyItMatters}",
  "options": ["Concrete option A", "Concrete option B", "Concrete option C"],
  "complexity": "${lite.complexity}",
  "revisitWhen": "One sentence — best trigger or condition to act on this.",
  "atlasCategory": "${lite.atlasCategory}",
  "whatItMeans": "One analogy sentence in everyday language, no jargon.",
  "whyItComesUp": "One sentence — why this is on their mind now."
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parseParkEnrichmentJson(raw);
    if (!parsed) return null;
    await db
      .update(entriesTable)
      .set({
        enrichmentJson: JSON.stringify(parsed),
        contextWhat: parsed.whatItMeans,
        contextWhy: parsed.whyItComesUp,
      })
      .where(eq(entriesTable.id, entryId));
    return parsed;
  } catch {
    return null;
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

// Verify that an entry exists and its project is owned by the given userId.
async function entryBelongsToUser(entryId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: entriesTable.id })
    .from(entriesTable)
    .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
    .where(and(eq(entriesTable.id, entryId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

// GET /api/entries/parked-count — count of parked entries across all projects for the user
router.get("/entries/parked-count", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const rows = await db
    .select({ count: sql<string>`count(*)` })
    .from(entriesTable)
    .innerJoin(projectsTable, eq(entriesTable.projectId, projectsTable.id))
    .where(and(eq(projectsTable.userId, userId), eq(entriesTable.status, "parked")));
  res.json({ count: Number(rows[0]?.count ?? 0) });
});

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
    .where(and(eq(projectsTable.userId, userId), eq(entriesTable.status, "committed")))
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

  const entries = await db
    .select()
    .from(entriesTable)
    .where(and(...conditions))
    .orderBy(entriesTable.createdAt);
  res.json(entries.map(serializeEntry));
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
  const { costOfLesson, amField, ...rest } = parsed.data;
  const [entry] = await db.insert(entriesTable).values({
    projectId: params.data.projectId,
    ...rest,
    title: parsed.data.title.trim(),
    ...(costOfLesson != null ? { costOfLesson: String(costOfLesson) } : {}),
    ...(amField ? { amField } : {}),
  } as typeof entriesTable.$inferInsert).returning();
  await touchProjectActivity(params.data.projectId);
  res.status(201).json(serializeEntry(entry));

  // Fire-and-forget: index embedding for semantic search (V4)
  void upsertEmbedding({
    entityType: "entry",
    entityId: entry.id,
    userId,
    projectId: params.data.projectId,
    content: [entry.title, entry.summary, entry.details].filter(Boolean).join("\n"),
  }).catch(() => { /* silent */ });

  // Fire-and-forget: bridge Decision entries to the Application Model history ledger
  if (entry.type === "Decision" && entry.status === "committed") {
    void (async () => {
      try {
        const [model] = await db
          .select({ version: applicationModelsTable.version })
          .from(applicationModelsTable)
          .where(eq(applicationModelsTable.projectId, params.data.projectId))
          .limit(1);
        if (!model) return;
        await db.insert(applicationModelHistoryTable).values({
          projectId: params.data.projectId,
          modelVersion: model.version,
          fieldChanged: entry.amField ?? "intent",
          previousValue: null,
          newValue: { decision: entry.title, summary: entry.summary ?? null },
          reason: `ledger-decision:${entry.id}`,
        });
      } catch { /* silent — never block the response */ }
    })();
  }

  // Fire-and-forget enrichment for parked entries
  if (entry.status === "parked") {
    void db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, params.data.projectId))
      .limit(1)
      .then(([project]) =>
        project ? enrichParkedEntry(entry.id, entry.title, entry.summary ?? null, project.name) : undefined
      )
      .catch(() => { /* silent */ });
  }
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

  // Return stored enrichment if it's already full (fastest path)
  if (entry.enrichmentJson) {
    try {
      const stored = JSON.parse(entry.enrichmentJson as unknown as string) as ParkEnrichmentLite | ParkEnrichment;
      // Full enrichment — return immediately
      if (stored._level === "full" || ("options" in stored && Array.isArray(stored.options))) {
        res.json(stored);
        return;
      }
      // Lite enrichment — upgrade to full on demand
      if (stored._level === "lite") {
        const full = await deepEnrichParkedEntry(id, row.title, row.summary ?? null, projectName, stored as ParkEnrichmentLite);
        if (full) { res.json(full); return; }
        // Fall through: return lite so the panel still shows something
        res.json(stored);
        return;
      }
    } catch { /* fall through to regenerate */ }
  }

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
    const enrichParsed = parseParkEnrichmentJson(raw);
    const parsed = enrichParsed ?? parseContextJson(raw);
    if (!parsed) throw new Error("Invalid context JSON");

    await db
      .update(entriesTable)
      .set({
        contextWhat: parsed.whatItMeans,
        contextWhy: parsed.whyItComesUp,
        ...(enrichParsed ? { enrichmentJson: JSON.stringify(enrichParsed) } : {}),
      })
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
  await touchProjectActivity(entry.projectId);
  res.json(serializeEntry(entry));
});

router.delete("/entries/:id", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = (req as any).authUser.id as number;
  if (!(await entryBelongsToUser(params.data.id, userId))) {
    res.status(404).json({ error: "Entry not found" }); return;
  }
  const [deleted] = await db.delete(entriesTable).where(eq(entriesTable.id, params.data.id)).returning({ projectId: entriesTable.projectId });
  if (deleted) await touchProjectActivity(deleted.projectId);
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
  await touchProjectActivity(original.projectId);
  res.status(201).json(serializeEntry(newEntry));
});

export default router;
