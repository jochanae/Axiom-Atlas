import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  projectGenomeTable,
  entriesTable,
  nexusMessagesTable,
  chatMessagesTable,
  sessionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Rate-limit state: projectId → last extraction timestamp ──────────────────
const lastExtractAt = new Map<number, number>();
const EXTRACT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseProjectId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getProjectOwned(projectId: number, userId: number) {
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return project ?? null;
}

async function getOrCreateGenome(projectId: number) {
  const [existing] = await db
    .select()
    .from(projectGenomeTable)
    .where(eq(projectGenomeTable.projectId, projectId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(projectGenomeTable)
    .values({ projectId })
    .returning();

  return created;
}

function serializeGenome(row: typeof projectGenomeTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    purpose: row.purpose,
    coreEmotion: row.coreEmotion,
    audience: row.audience,
    identity: row.identity,
    constraints: row.constraints ?? [],
    openQuestions: row.openQuestions ?? [],
    stage: row.stage,
    confidenceScore: row.confidenceScore,
    lastEvolvedAt: row.lastEvolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Extraction logic ─────────────────────────────────────────────────────────

interface ExtractionResult {
  purpose?: string;
  coreEmotion?: string;
  audience?: string;
  identity?: string;
  constraints?: string[];
  openQuestions?: string[];
  stage?: string;
  confidenceScore?: number;
  objects?: Array<{
    type: string;
    title: string;
    summary?: string;
  }>;
}

const EXTRACTION_SYSTEM = `You are the Atlas Genome Engine. You extract structured project DNA from a conversation and existing project objects.

Analyze the provided conversation and entries, then output a JSON object with:
- purpose: One clear sentence — what this project does for its user
- coreEmotion: The emotional core or brand feeling (1-3 words, e.g. "intentionality", "confidence", "belonging")
- audience: Who uses this first — specific person, not a demographic
- identity: What makes this distinct — the unique angle or differentiator
- constraints: Array of confirmed constraints or non-negotiables (up to 5 strings)
- openQuestions: Array of unresolved questions that block progress (up to 5 strings)
- stage: One of: Think | Shape | Decide | Workspace | Strategize | Build | Operate | Evolve
  - Think: still exploring the idea
  - Shape: idea is forming, defining scope
  - Decide: making architecture/product decisions
  - Workspace: active development
  - Strategize: planning go-to-market, pricing, positioning
  - Build: writing code, creating assets
  - Operate: deployed, iterating on live product
  - Evolve: mature product, expanding scope
- confidenceScore: 0-100 integer — how confident you are in the extracted data (0 = no information, 100 = very clear)
- objects: Array of extracted typed objects to create/update in the project. Each has:
  - type: one of Idea | Goal | Blocker | Decision | Audience | Feature | Risk | Insight
  - title: short title (under 80 chars)
  - summary: optional 1-2 sentence description

Only extract what is explicitly present in the conversation. Do not invent. Leave fields null if unknown.
Return ONLY valid JSON.`;

async function runExtraction(
  projectId: number,
  projectName: string,
): Promise<ExtractionResult | null> {
  try {
    // Load recent nexus messages for this project
    const nexusMessages = await db
      .select({ role: nexusMessagesTable.role, content: nexusMessagesTable.content })
      .from(nexusMessagesTable)
      .where(
        and(
          eq(nexusMessagesTable.projectId, projectId),
          sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
          sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
        ),
      )
      .orderBy(desc(nexusMessagesTable.createdAt))
      .limit(30);

    // Load recent workspace messages
    const [latestSession] = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, projectId))
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(1);

    const workspaceMessages = latestSession
      ? await db
          .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
          .from(chatMessagesTable)
          .where(eq(chatMessagesTable.sessionId, latestSession.id))
          .orderBy(desc(chatMessagesTable.createdAt))
          .limit(20)
      : [];

    // Load committed entries
    const existingEntries = await db
      .select({ type: entriesTable.type, title: entriesTable.title, summary: entriesTable.summary })
      .from(entriesTable)
      .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "committed")))
      .orderBy(desc(entriesTable.createdAt))
      .limit(20);

    const allMessages = [
      ...nexusMessages.reverse(),
      ...workspaceMessages.reverse(),
    ];

    if (allMessages.length === 0) return null;

    const conversationText = allMessages
      .map((m) => `${m.role === "user" ? "PERSON" : "ATLAS"}: ${m.content.slice(0, 600)}`)
      .join("\n\n");

    const entriesText =
      existingEntries.length > 0
        ? existingEntries
            .map((e) => `[${e.type}] ${e.title}${e.summary ? ": " + e.summary : ""}`)
            .join("\n")
        : "(none yet)";

    const prompt = `PROJECT: ${projectName}

CONVERSATION:
${conversationText}

EXISTING ENTRIES:
${entriesText}

Extract the Project Genome and any typed objects present in the conversation.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned) as ExtractionResult;
  } catch (err) {
    logger.warn({ err, projectId }, "genome extraction failed");
    return null;
  }
}

async function applyExtraction(projectId: number, result: ExtractionResult): Promise<void> {
  const VALID_STAGES = ["Think", "Shape", "Decide", "Workspace", "Strategize", "Build", "Operate", "Evolve"];

  const genomeUpdate: Record<string, unknown> = {
    lastEvolvedAt: new Date(),
    updatedAt: new Date(),
  };

  if (typeof result.purpose === "string" && result.purpose.trim()) genomeUpdate.purpose = result.purpose.trim();
  if (typeof result.coreEmotion === "string" && result.coreEmotion.trim()) genomeUpdate.coreEmotion = result.coreEmotion.trim();
  if (typeof result.audience === "string" && result.audience.trim()) genomeUpdate.audience = result.audience.trim();
  if (typeof result.identity === "string" && result.identity.trim()) genomeUpdate.identity = result.identity.trim();
  if (Array.isArray(result.constraints)) genomeUpdate.constraints = result.constraints.map(String).filter(Boolean).slice(0, 5);
  if (Array.isArray(result.openQuestions)) genomeUpdate.openQuestions = result.openQuestions.map(String).filter(Boolean).slice(0, 5);
  if (typeof result.stage === "string" && VALID_STAGES.includes(result.stage)) genomeUpdate.stage = result.stage;
  if (typeof result.confidenceScore === "number" && result.confidenceScore >= 0 && result.confidenceScore <= 100) {
    genomeUpdate.confidenceScore = Math.round(result.confidenceScore);
  }

  await db
    .insert(projectGenomeTable)
    .values({ projectId, ...genomeUpdate as Parameters<typeof db.insert>[0] extends infer T ? any : any })
    .onConflictDoUpdate({
      target: projectGenomeTable.projectId,
      set: genomeUpdate as any,
    });

  // Upsert typed Object entries (upsert by title + projectId — no exact type match to allow re-classification)
  if (Array.isArray(result.objects)) {
    const VALID_TYPES = ["Idea", "Goal", "Blocker", "Decision", "Audience", "Feature", "Risk", "Insight"];
    for (const obj of result.objects) {
      if (!obj?.title?.trim() || !VALID_TYPES.includes(obj.type)) continue;

      const title = obj.title.trim().slice(0, 255);
      const type = obj.type;
      const summary = typeof obj.summary === "string" ? obj.summary.trim().slice(0, 500) : null;

      // Check for existing entry with same title in this project
      const [existing] = await db
        .select({ id: entriesTable.id })
        .from(entriesTable)
        .where(
          and(
            eq(entriesTable.projectId, projectId),
            eq(entriesTable.title, title),
          ),
        )
        .limit(1);

      if (existing) {
        // Update type and summary if we have new info
        await db
          .update(entriesTable)
          .set({ type, ...(summary ? { summary } : {}), updatedAt: new Date() })
          .where(eq(entriesTable.id, existing.id));
      } else {
        await db.insert(entriesTable).values({
          projectId,
          title,
          type,
          status: "committed",
          severity: "committed",
          ...(summary ? { summary } : {}),
          verb: "auto-extracted",
        });
      }
    }
  }
}

// ── Exported auto-extraction trigger ─────────────────────────────────────────

export async function maybeAutoExtract(projectId: number, projectName: string, messageCount: number): Promise<void> {
  if (messageCount < 5) return;

  const now = Date.now();
  const last = lastExtractAt.get(projectId) ?? 0;
  if (now - last < EXTRACT_COOLDOWN_MS) return;

  lastExtractAt.set(projectId, now);

  const result = await runExtraction(projectId, projectName);
  if (result) {
    await applyExtraction(projectId, result);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/genome — fetch (or lazily create) the Genome for a project
router.get("/projects/:id/genome", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const project = await getProjectOwned(projectId, userId);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const genome = await getOrCreateGenome(projectId);
    res.json(serializeGenome(genome));
  } catch (err) {
    logger.error({ err }, "GET /genome error");
    res.status(500).json({ error: "Failed to fetch genome" });
  }
});

// PATCH /api/projects/:id/genome — manual field update
router.patch("/projects/:id/genome", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const project = await getProjectOwned(projectId, userId);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const VALID_STAGES = ["Think", "Shape", "Decide", "Workspace", "Strategize", "Build", "Operate", "Evolve"];
    const body = req.body as Record<string, unknown>;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.purpose === "string") update.purpose = body.purpose.trim() || null;
    if (typeof body.coreEmotion === "string") update.coreEmotion = body.coreEmotion.trim() || null;
    if (typeof body.audience === "string") update.audience = body.audience.trim() || null;
    if (typeof body.identity === "string") update.identity = body.identity.trim() || null;
    if (Array.isArray(body.constraints)) update.constraints = body.constraints.map(String).filter(Boolean).slice(0, 5);
    if (Array.isArray(body.openQuestions)) update.openQuestions = body.openQuestions.map(String).filter(Boolean).slice(0, 5);
    if (typeof body.stage === "string" && VALID_STAGES.includes(body.stage)) update.stage = body.stage;
    if (typeof body.confidenceScore === "number" && body.confidenceScore >= 0 && body.confidenceScore <= 100) {
      update.confidenceScore = Math.round(body.confidenceScore);
    }

    await db
      .insert(projectGenomeTable)
      .values({ projectId, ...update as any })
      .onConflictDoUpdate({
        target: projectGenomeTable.projectId,
        set: update as any,
      });

    const genome = await getOrCreateGenome(projectId);
    res.json(serializeGenome(genome));
  } catch (err) {
    logger.error({ err }, "PATCH /genome error");
    res.status(500).json({ error: "Failed to update genome" });
  }
});

// POST /api/projects/:id/genome/extract — run extraction and return updated genome
router.post("/projects/:id/genome/extract", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const project = await getProjectOwned(projectId, userId);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const result = await runExtraction(projectId, project.name);
    if (!result) {
      const genome = await getOrCreateGenome(projectId);
      res.json({ genome: serializeGenome(genome), extracted: false, reason: "Not enough conversation data" });
      return;
    }

    await applyExtraction(projectId, result);

    // Update cooldown since manual extract also counts
    lastExtractAt.set(projectId, Date.now());

    const genome = await getOrCreateGenome(projectId);
    res.json({ genome: serializeGenome(genome), extracted: true });
  } catch (err) {
    logger.error({ err }, "POST /genome/extract error");
    res.status(500).json({ error: "Extraction failed" });
  }
});

export default router;
