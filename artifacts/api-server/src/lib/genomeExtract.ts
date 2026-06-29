import Anthropic from "@anthropic-ai/sdk";
import { db, entriesTable, nexusMessagesTable, chatMessagesTable, sessionsTable, projectsTable } from "@workspace/db";
import { eq, desc, count, and, sql, ne } from "drizzle-orm";
import { logger } from "./logger";
import { GENOME_STAGES, OBJECT_TYPES } from "@workspace/db";
import type { GenomeStage, ObjectType } from "@workspace/db";
import { updateProjectDNA, getOrCreateProjectDNA } from "./projectDNA";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory rate limiter: projectId → last extraction timestamp
const extractionCooldowns = new Map<number, number>();
// In-flight guard: tracks projects with an active extraction in progress
const extractionInFlight = new Set<number>();
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const MIN_MESSAGES = 5;

export function isOnCooldown(projectId: number): boolean {
  const last = extractionCooldowns.get(projectId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function isInFlight(projectId: number): boolean {
  return extractionInFlight.has(projectId);
}

function setCooldown(projectId: number): void {
  extractionCooldowns.set(projectId, Date.now());
}

type RawGenomeUpdate = {
  purpose?: string | null;
  coreEmotion?: string | null;
  audience?: string | null;
  identity?: string | null;
  wedge?: string | null;
  differentiator?: string | null;
  constraints?: string[];
  openQuestions?: string[];
  stage?: string;
  confidenceScore?: number;
  objects?: Array<{ type: string; title: string; summary?: string }>;
};

function cleanJsonResponse(raw: string): string {
  return raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
}

function parseGenomeJson(raw: string): RawGenomeUpdate | null {
  try {
    const cleaned = cleanJsonResponse(raw);
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned) as RawGenomeUpdate;
  } catch {
    return null;
  }
}

function clampConfidence(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function validStage(s: unknown): GenomeStage {
  if (typeof s === "string" && GENOME_STAGES.includes(s as GenomeStage)) return s as GenomeStage;
  return "Think";
}

function validObjectType(t: unknown): ObjectType {
  if (typeof t === "string" && OBJECT_TYPES.includes(t as ObjectType)) return t as ObjectType;
  return "Idea";
}

async function loadProjectMetadata(projectId: number): Promise<string> {
  const [project] = await db
    .select({ name: projectsTable.name, description: projectsTable.description })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return "";
  const parts: string[] = [`PROJECT NAME: ${project.name}`];
  if (project.description?.trim()) parts.push(`DESCRIPTION: ${project.description.trim()}`);
  return parts.join("\n");
}

async function loadConversationText(projectId: number): Promise<string> {
  // Prefer nexus messages (global insight / capture layer)
  const nexusRows = await db
    .select({ role: nexusMessagesTable.role, content: nexusMessagesTable.content })
    .from(nexusMessagesTable)
    .where(and(
      eq(nexusMessagesTable.projectId, projectId),
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
    ))
    .orderBy(desc(nexusMessagesTable.createdAt))
    .limit(30);

  if (nexusRows.length >= 2) {
    return nexusRows.reverse()
      .map(m => `${m.role === "user" ? "PERSON" : "ATLAS"}: ${m.content}`)
      .join("\n\n");
  }

  // Fall back to workspace chat
  const [session] = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.projectId, projectId))
    .orderBy(desc(sessionsTable.updatedAt))
    .limit(1);

  if (!session) return "";

  const chatRows = await db
    .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, session.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(30);

  return chatRows.reverse()
    .map(m => `${m.role === "user" ? "PERSON" : "ATLAS"}: ${m.content}`)
    .join("\n\n");
}

async function loadCommittedEntries(projectId: number): Promise<string> {
  const rows = await db
    .select({
      type: entriesTable.type,
      title: entriesTable.title,
      summary: entriesTable.summary,
    })
    .from(entriesTable)
    .where(and(
      eq(entriesTable.projectId, projectId),
      ne(entriesTable.status, "archived"),
    ))
    .orderBy(desc(entriesTable.createdAt))
    .limit(30);

  if (rows.length === 0) return "";

  const lines = rows.map(r =>
    `[${r.type}] ${r.title}${r.summary ? ` — ${r.summary}` : ""}`,
  );
  return `COMMITTED OBJECTS:\n${lines.join("\n")}`;
}

async function countProjectMessages(projectId: number): Promise<number> {
  const [nexusRow] = await db
    .select({ n: count() })
    .from(nexusMessagesTable)
    .where(and(
      eq(nexusMessagesTable.projectId, projectId),
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
    ));
  const nexusCount = Number(nexusRow?.n ?? 0);
  if (nexusCount >= MIN_MESSAGES) return nexusCount;

  const [chatRow] = await db
    .select({ n: count() })
    .from(chatMessagesTable)
    .innerJoin(sessionsTable, eq(chatMessagesTable.sessionId, sessionsTable.id))
    .where(eq(sessionsTable.projectId, projectId));
  return nexusCount + Number(chatRow?.n ?? 0);
}

async function upsertObjects(
  projectId: number,
  objects: Array<{ type: string; title: string; summary?: string }>,
): Promise<void> {
  for (const obj of objects) {
    if (!obj.title?.trim()) continue;
    const objType = validObjectType(obj.type);
    const title = obj.title.trim().slice(0, 500);
    const summary = obj.summary?.trim() ?? null;

    // Check for existing entry with same type + title (case-insensitive)
    const [existing] = await db
      .select({ id: entriesTable.id })
      .from(entriesTable)
      .where(and(
        eq(entriesTable.projectId, projectId),
        eq(entriesTable.type, objType),
        sql`lower(${entriesTable.title}) = lower(${title})`,
      ))
      .limit(1);

    if (existing) {
      if (summary) {
        await db.update(entriesTable).set({ summary }).where(eq(entriesTable.id, existing.id));
      }
    } else {
      await db.insert(entriesTable).values({
        projectId,
        type: objType,
        title,
        summary,
        status: "committed",
        severity: "committed",
      });
    }
  }
}

export async function runGenomeExtraction(projectId: number): Promise<void> {
  const [conversationText, committedEntriesText, projectMetadata] = await Promise.all([
    loadConversationText(projectId),
    loadCommittedEntries(projectId),
    loadProjectMetadata(projectId),
  ]);

  if (!conversationText && !committedEntriesText && !projectMetadata) return;

  const contextBlocks: string[] = [];
  if (projectMetadata) contextBlocks.push(projectMetadata);
  if (conversationText) contextBlocks.push(`CONVERSATION:\n${conversationText.slice(0, 7000)}`);
  if (committedEntriesText) contextBlocks.push(committedEntriesText.slice(0, 2000));
  const fullContext = contextBlocks.join("\n\n---\n\n");

  const hasConversation = !!conversationText;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `You are analyzing a project to extract structured project DNA (the "Project Genome"). Be precise and concise.${hasConversation ? " You have conversation history to draw from." : " You have only a project name and description — reason carefully from what is available."}

${fullContext}

Extract the following and return ONLY valid JSON (no markdown, no preamble):

{
  "purpose": "one sentence — what problem this solves or what it enables, or null if not clear",
  "coreEmotion": "the core feeling or value it creates (e.g. 'control', 'delight', 'clarity'), or null",
  "audience": "who needs this most — specific, not generic (e.g. 'early-stage founders', 'solo presenters with speaking anxiety') — or null",
  "identity": "the project's ownable identity or positioning in one phrase, or null",
  "wedge": "if 80% of this project were deleted, what single capability would survive and still be worth building? One crisp sentence or null.",
  "differentiator": "what makes this meaningfully different from the obvious alternatives? One specific claim, or null.",
  "constraints": ["real constraint 1", "real constraint 2"],
  "openQuestions": ["unresolved question 1", "unresolved question 2", "unresolved question 3"],
  "stage": "Think | Shape | Decide | Workspace | Strategize | Build | Operate | Evolve",
  "confidenceScore": 0-100,
  "objects": [
    { "type": "Idea | Goal | Blocker | Decision | Audience | Feature | Risk | Insight", "title": "short label", "summary": "one sentence" }
  ]
}

Rules:
- stage reflects how far the thinking has progressed (Think = very early, Evolve = mature and deployed)
- confidenceScore reflects how clear and grounded the project vision is (0 = vague, 100 = crystal clear)
- wedge: this is the irreducible core — not a feature list, not the product category — the one thing that would make someone choose this over nothing
- differentiator: be specific, not generic ("the only X that does Y" not "better UX")
- objects: extract 3-8 distinct objects not already in the committed objects list. Skip duplicates.
- constraints and openQuestions: max 5 each, only real ones from the conversation
- All string values must be concise (under 200 chars)
- Return null for fields that cannot be extracted confidently`,
    }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  const parsed = parseGenomeJson(raw);
  if (!parsed) {
    logger.warn({ projectId }, "genome extraction: failed to parse Claude response");
    return;
  }

  const now = new Date();

  const dnaUpdate: Parameters<typeof updateProjectDNA>[1] = {
    ...(typeof parsed.purpose === "string" ? { purpose: parsed.purpose || null } : {}),
    ...(typeof parsed.coreEmotion === "string" ? { coreEmotion: parsed.coreEmotion || null } : {}),
    ...(typeof parsed.audience === "string" ? { audience: parsed.audience || null } : {}),
    ...(typeof parsed.identity === "string" ? { identity: parsed.identity || null } : {}),
    ...(typeof parsed.wedge === "string" ? { wedge: parsed.wedge || null } : {}),
    ...(typeof parsed.differentiator === "string" ? { differentiator: parsed.differentiator || null } : {}),
    ...(Array.isArray(parsed.constraints) ? { constraints: (parsed.constraints as unknown[]).filter(Boolean).slice(0, 5) as string[] } : {}),
    ...(Array.isArray(parsed.openQuestions) ? { openQuestions: (parsed.openQuestions as unknown[]).filter(Boolean).slice(0, 5) as string[] } : {}),
    ...(parsed.stage ? { stage: validStage(parsed.stage) } : {}),
    confidenceScore: clampConfidence(parsed.confidenceScore),
    lastEvolvedAt: now,
    lastExtractedAt: now,
  };

  // Ensure the Application Model row exists, then write DNA into it
  await getOrCreateProjectDNA(projectId);
  await updateProjectDNA(projectId, dnaUpdate);

  if (Array.isArray(parsed.objects) && parsed.objects.length > 0) {
    await upsertObjects(projectId, parsed.objects);
  }

  setCooldown(projectId);
  logger.info({ projectId, stage: parsed.stage, confidence: parsed.confidenceScore }, "genome extraction complete");
}

export async function maybeExtractGenome(projectId: number | null | undefined): Promise<void> {
  if (!projectId) return;

  // Check both cooldown and in-flight before doing anything
  if (isOnCooldown(projectId) || isInFlight(projectId)) return;

  try {
    const msgCount = await countProjectMessages(projectId);
    if (msgCount < MIN_MESSAGES) return;

    // Claim the slot atomically before launching async work.
    // Set cooldown immediately so that any subsequent Atlas responses
    // that arrive before extraction finishes are rejected by isOnCooldown().
    extractionInFlight.add(projectId);
    setCooldown(projectId);

    void runGenomeExtraction(projectId)
      .catch(err => {
        // On failure, clear the cooldown so a retry is allowed after
        // the remaining window lapses (or immediately on next request).
        extractionCooldowns.delete(projectId);
        logger.warn({ err, projectId }, "background genome extraction failed");
      })
      .finally(() => {
        extractionInFlight.delete(projectId);
      });
  } catch (err) {
    logger.warn({ err, projectId }, "maybeExtractGenome check failed");
  }
}

// Run extraction for all projects whose AM has never been extracted (lastExtractedAt is null).
// Called once on server startup — non-blocking, runs serially to avoid hammering the AI API.
export async function backfillEmptyGenomes(): Promise<void> {
  try {
    const { applicationModelsTable } = await import("@workspace/db");
    const rows = await db
      .select({ id: applicationModelsTable.projectId })
      .from(applicationModelsTable)
      .where(sql`(${applicationModelsTable.buildState}->>'lastExtractedAt') IS NULL`);

    if (rows.length === 0) return;

    logger.info({ count: rows.length }, "genome backfill: starting extraction for projects with no shaping data");

    for (const { id } of rows) {
      try {
        await runGenomeExtraction(id);
        logger.info({ projectId: id }, "genome backfill: extracted");
      } catch (err) {
        logger.warn({ err, projectId: id }, "genome backfill: extraction failed — skipping");
      }
    }

    logger.info({ count: rows.length }, "genome backfill: complete");
  } catch (err) {
    logger.warn({ err }, "genome backfill on startup failed — non-fatal");
  }
}

// seedMissingGenomes is superseded by Application Model seeding (done in applicationModel.ts).
// Kept as a no-op for call-site compatibility.
export async function seedMissingGenomes(): Promise<void> {
  // AM rows are seeded on project creation and at boot in applicationModel.ts.
}

export async function seedMissingSessionsForCommitted(): Promise<void> {
  try {
    const committedProjects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.status, "committed"));

    const existingSessions = await db
      .select({ projectId: sessionsTable.projectId })
      .from(sessionsTable);

    const existingSet = new Set(existingSessions.map(s => s.projectId));
    const missing = committedProjects.filter(p => !existingSet.has(p.id));

    if (missing.length === 0) return;

    await db.insert(sessionsTable).values(
      missing.map(p => ({ projectId: p.id, title: "Session 1", status: "active" })),
    );

    logger.info({ count: missing.length }, "session seed: inserted default sessions for committed projects without one");
  } catch (err) {
    logger.warn({ err }, "session seed: failed — non-fatal");
  }
}
