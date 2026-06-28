import { Router, type IRouter } from "express";
import { pushAtlasMdToRepo } from "../lib/projectMemory";
import { db, projectsTable, entriesTable, nexusMessagesTable, sessionsTable } from "@workspace/db";
import { eq, and, desc, sql, count, ne } from "drizzle-orm";
import { runGenomeExtraction, isOnCooldown } from "../lib/genomeExtract";
import { GENOME_STAGES, OBJECT_TYPES } from "@workspace/db";
import type { GenomeStage } from "@workspace/db";
import {
  type ProjectDNA,
  getProjectDNA,
  getOrCreateProjectDNA,
  getMultipleProjectDNA,
  updateProjectDNA,
} from "../lib/projectDNA";

const router: IRouter = Router();

function parseProjectId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function assertProjectOwner(projectId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return !!row;
}

function validStage(s: unknown): GenomeStage {
  if (typeof s === "string" && GENOME_STAGES.includes(s as GenomeStage)) return s as GenomeStage;
  return "Think";
}

type MomentumLevel = "Low" | "Medium" | "High";
type ConfidenceLevel = "Low" | "Medium" | "High";
export type AtlasState = "Discovering" | "Pressure Testing" | "Structuring" | "Building" | "Operating";

function momentumFromCount(n: number): MomentumLevel {
  if (n >= 16) return "High";
  if (n >= 6) return "Medium";
  return "Low";
}

function confidenceLevelFromScore(score: number): ConfidenceLevel {
  if (score >= 70) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function computeAtlasState(
  stage: string,
  confidenceScore: number,
  openQuestionCount: number,
  constraintCount: number,
  blockerCount: number,
  recentMsgCount: number,
  objectCount: number,
): AtlasState {
  if (stage === "Operate" || stage === "Evolve") return "Operating";
  if (stage === "Build") return "Building";
  if (stage === "Workspace" || stage === "Strategize") return "Building";
  if (stage === "Decide") return "Structuring";
  if (stage === "Shape") {
    if (blockerCount > 0 || constraintCount > 1 || openQuestionCount > 2) return "Pressure Testing";
    return "Structuring";
  }
  if (blockerCount > 0 || constraintCount > 0 || openQuestionCount > 2 || recentMsgCount > 8 || objectCount > 3) {
    return "Pressure Testing";
  }
  return "Discovering";
}

function nextActionForStage(stage: string, openQuestions: string[], constraints: string[]): string {
  const q = openQuestions[0] ?? null;
  const c = constraints[0] ?? null;
  switch (stage) {
    case "Think":      return q ?? "Start shaping your core idea — what problem are you solving?";
    case "Shape":      return q ? `Answer: ${q}` : "Define who needs this most and why it matters to them";
    case "Decide":     return c ? `Pressure-test: ${c}` : "Commit to your biggest assumption and test it";
    case "Workspace":  return q ?? "Set up your execution environment and define what 'done' means";
    case "Strategize": return q ?? "Define the phased approach — what comes first?";
    case "Build":      return "Pick one feature and ship it — learn from real usage";
    case "Operate":    return "Monitor and learn — what is the data telling you?";
    case "Evolve":     return "Identify the next evolution — what would 10x this?";
    default:           return q ?? "Keep the conversation going — Atlas is listening";
  }
}

async function computeProjectHealth(projectId: number, dna: ProjectDNA) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [msgRow, blockerCountRow, objectCountRow, sessionCountRow, committedRow, parkedRow] = await Promise.all([
    db.select({ n: count() }).from(nexusMessagesTable).where(and(
      eq(nexusMessagesTable.projectId, projectId),
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
      sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
      sql`${nexusMessagesTable.createdAt} >= ${sevenDaysAgo.toISOString()}`,
    )).then(r => r[0]),
    db.select({ n: count() }).from(entriesTable).where(and(
      eq(entriesTable.projectId, projectId),
      eq(entriesTable.type, "Blocker"),
      ne(entriesTable.status, "archived"),
    )).then(r => r[0]),
    db.select({ n: count() }).from(entriesTable).where(and(
      eq(entriesTable.projectId, projectId),
      ne(entriesTable.status, "archived"),
    )).then(r => r[0]),
    db.select({ n: count() }).from(sessionsTable).where(
      eq(sessionsTable.projectId, projectId)
    ).then(r => r[0]),
    db.select({ n: count() }).from(entriesTable).where(and(
      eq(entriesTable.projectId, projectId),
      eq(entriesTable.status, "committed"),
    )).then(r => r[0]),
    db.select({ n: count() }).from(entriesTable).where(and(
      eq(entriesTable.projectId, projectId),
      eq(entriesTable.status, "parked"),
    )).then(r => r[0]),
  ]);

  const recentMsgCount = Number(msgRow?.n ?? 0);
  const blockerCount = Number(blockerCountRow?.n ?? 0);
  const objectCount = Number(objectCountRow?.n ?? 0);
  const totalSessions = Number(sessionCountRow?.n ?? 0);
  const committedDecisions = Number(committedRow?.n ?? 0);
  const parkedItems = Number(parkedRow?.n ?? 0);

  const constraints = dna.constraints ?? [];
  const openQuestions = dna.openQuestions ?? [];

  const momentum = momentumFromCount(recentMsgCount);
  const atlasState = computeAtlasState(
    dna.stage,
    dna.confidenceScore,
    openQuestions.length,
    constraints.length,
    blockerCount,
    recentMsgCount,
    objectCount,
  );

  const clarityScore = Math.min(100, dna.confidenceScore);
  const confidence = confidenceLevelFromScore(clarityScore);

  const topBlocker = blockerCount > 0
    ? (await db.select({ title: entriesTable.title })
        .from(entriesTable)
        .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.type, "Blocker"), ne(entriesTable.status, "archived")))
        .orderBy(desc(entriesTable.createdAt))
        .limit(1))[0]?.title ?? null
    : null;

  return {
    momentum,
    atlasState,
    clarity: clarityScore,
    clarityDetail: `${dna.confidenceScore}% confidence score`,
    confidence,
    state: `${dna.stage} stage${blockerCount > 0 ? ` · ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""}` : ""} → ${atlasState}`,
    blockerCount,
    objectCount,
    totalSessions,
    committedDecisions,
    parkedItems,
    openQuestions,
    nextAction: nextActionForStage(dna.stage, openQuestions, constraints),
    risk: topBlocker,
  };
}

function serializeGenomeFromDNA(projectId: number, dna: ProjectDNA, health: Awaited<ReturnType<typeof computeProjectHealth>>) {
  return {
    projectId,
    purpose: dna.purpose,
    coreEmotion: dna.coreEmotion,
    audience: dna.audience,
    identity: dna.identity,
    format: dna.format,
    wedge: dna.wedge,
    differentiator: dna.differentiator,
    constraints: dna.constraints,
    openQuestions: dna.openQuestions,
    stack: dna.stack,
    protectedAreas: dna.protectedAreas,
    stage: dna.stage,
    confidenceScore: dna.confidenceScore,
    lastEvolvedAt: dna.lastEvolvedAt?.toISOString() ?? null,
    lastExtractedAt: dna.lastExtractedAt?.toISOString() ?? null,
    health,
  };
}

// GET /api/projects/:id/genome
router.get("/projects/:id/genome", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

    const dna = await getOrCreateProjectDNA(projectId);
    const health = await computeProjectHealth(projectId, dna);
    res.json(serializeGenomeFromDNA(projectId, dna, health));
  } catch (err) {
    req.log?.error({ err }, "genome GET error");
    res.status(500).json({ error: "Failed to fetch genome" });
  }
});

// PATCH /api/projects/:id/genome
router.patch("/projects/:id/genome", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateProjectDNA>[1] = {};

    if ("purpose" in body)       patch.purpose = typeof body.purpose === "string" ? body.purpose : null;
    if ("coreEmotion" in body)   patch.coreEmotion = typeof body.coreEmotion === "string" ? body.coreEmotion : null;
    if ("audience" in body)      patch.audience = typeof body.audience === "string" ? body.audience : null;
    if ("identity" in body)      patch.identity = typeof body.identity === "string" ? body.identity : null;
    if ("format" in body)        patch.format = typeof body.format === "string" ? body.format : null;
    if ("wedge" in body)         patch.wedge = typeof body.wedge === "string" ? body.wedge : null;
    if ("differentiator" in body) patch.differentiator = typeof body.differentiator === "string" ? body.differentiator : null;
    if ("constraints" in body && Array.isArray(body.constraints))
      patch.constraints = body.constraints.filter((x: unknown) => typeof x === "string").slice(0, 5) as string[];
    if ("openQuestions" in body && Array.isArray(body.openQuestions))
      patch.openQuestions = body.openQuestions.filter((x: unknown) => typeof x === "string").slice(0, 5) as string[];
    if ("stack" in body && Array.isArray(body.stack))
      patch.stack = body.stack.filter((x: unknown) => typeof x === "string") as string[];
    if ("protectedAreas" in body && Array.isArray(body.protectedAreas))
      patch.protectedAreas = body.protectedAreas.filter((x: unknown) => typeof x === "string") as string[];
    if ("stage" in body)         patch.stage = validStage(body.stage);

    if (Object.keys(patch).length === 0) {
      const dna = await getOrCreateProjectDNA(projectId);
      const health = await computeProjectHealth(projectId, dna);
      res.json(serializeGenomeFromDNA(projectId, dna, health));
      return;
    }

    const prevDna = await getProjectDNA(projectId);

    await updateProjectDNA(projectId, patch);

    // Refresh Atlas Memory when major fields change (fire-and-forget)
    const majorFields = ["purpose", "audience", "wedge", "stack", "protectedAreas", "constraints"] as const;
    const hasMajorChange = prevDna && majorFields.some(
      f => f in patch && JSON.stringify((patch as unknown as Record<string, unknown>)[f]) !== JSON.stringify((prevDna as unknown as Record<string, unknown>)[f]),
    );
    if (hasMajorChange) {
      pushAtlasMdToRepo(projectId, userId, req.log).catch(() => {});
    }

    const dna = await getOrCreateProjectDNA(projectId);
    const health = await computeProjectHealth(projectId, dna);
    res.json(serializeGenomeFromDNA(projectId, dna, health));
  } catch (err) {
    req.log?.error({ err }, "genome PATCH error");
    res.status(500).json({ error: "Failed to update genome" });
  }
});

// POST /api/projects/:id/genome/extract
router.post("/projects/:id/genome/extract", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

    const force = (req.body as Record<string, unknown>)?.force === true;
    if (!force && isOnCooldown(projectId)) {
      const dna = await getOrCreateProjectDNA(projectId);
      const health = await computeProjectHealth(projectId, dna);
      res.json({ genome: serializeGenomeFromDNA(projectId, dna, health), skipped: true, reason: "cooldown" });
      return;
    }

    await runGenomeExtraction(projectId);

    const dna = await getOrCreateProjectDNA(projectId);
    const health = await computeProjectHealth(projectId, dna);
    res.json({ genome: serializeGenomeFromDNA(projectId, dna, health), skipped: false });
  } catch (err) {
    req.log?.error({ err }, "genome extract error");
    res.status(500).json({ error: "Extraction failed" });
  }
});

// GET /api/projects/:id/objects — typed entries (Universal Object System)
router.get("/projects/:id/objects", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

    const typeFilter = req.query.type as string | undefined;

    const rows = await db
      .select({
        id: entriesTable.id,
        type: entriesTable.type,
        title: entriesTable.title,
        summary: entriesTable.summary,
        status: entriesTable.status,
        createdAt: entriesTable.createdAt,
      })
      .from(entriesTable)
      .where(
        typeFilter && OBJECT_TYPES.includes(typeFilter as (typeof OBJECT_TYPES)[number])
          ? and(eq(entriesTable.projectId, projectId), eq(entriesTable.type, typeFilter as (typeof OBJECT_TYPES)[number]))
          : eq(entriesTable.projectId, projectId),
      )
      .orderBy(desc(entriesTable.createdAt))
      .limit(100);

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log?.error({ err }, "objects GET error");
    res.status(500).json({ error: "Failed to fetch objects" });
  }
});

// POST /api/projects/genome/backfill — run extraction for all user projects never extracted
router.post("/projects/genome/backfill", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;

    const userProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId));

    if (userProjects.length === 0) { res.json({ queued: 0, projects: [] }); return; }

    // Check AM buildState.lastExtractedAt to find projects never extracted
    const dnaMap = await getMultipleProjectDNA(userProjects.map(p => p.id));
    const toBackfill = userProjects.filter(p => {
      const dna = dnaMap.get(p.id);
      return !dna?.lastExtractedAt;
    });

    if (toBackfill.length === 0) {
      res.json({ queued: 0, message: "All projects already have genome data.", projects: [] });
      return;
    }

    void (async () => {
      for (const p of toBackfill) {
        try {
          await runGenomeExtraction(p.id);
          req.log?.info({ projectId: p.id, projectName: p.name }, "genome backfill: extracted");
        } catch (err) {
          req.log?.warn({ err, projectId: p.id }, "genome backfill: extraction failed for project");
        }
      }
    })();

    res.json({
      queued: toBackfill.length,
      message: `Extraction queued for ${toBackfill.length} project${toBackfill.length !== 1 ? "s" : ""}. This runs in the background.`,
      projects: toBackfill.map(p => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    req.log?.error({ err }, "genome backfill error");
    res.status(500).json({ error: "Backfill failed" });
  }
});

// GET /api/portfolio/health — all projects with health snapshots in one batch
router.get("/portfolio/health", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;

    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, updatedAt: projectsTable.updatedAt })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId))
      .orderBy(desc(projectsTable.updatedAt));

    if (projects.length === 0) { res.json([]); return; }

    const dnaMap = await getMultipleProjectDNA(projects.map(p => p.id));

    const results = await Promise.all(projects.map(async (p) => {
      const dna = dnaMap.get(p.id);
      const updatedAt = p.updatedAt?.toISOString() ?? new Date().toISOString();
      if (!dna) {
        return {
          projectId: p.id,
          projectName: p.name,
          updatedAt,
          stage: "Think",
          atlasState: "Discovering" as AtlasState,
          momentum: "Low" as const,
          clarity: 0,
          confidence: "Low" as const,
          risk: null,
          nextAction: "Start shaping your core idea — what problem are you solving?",
        };
      }
      const health = await computeProjectHealth(p.id, dna);
      return {
        projectId: p.id,
        projectName: p.name,
        updatedAt,
        stage: dna.stage,
        atlasState: health.atlasState,
        momentum: health.momentum,
        clarity: health.clarity,
        confidence: health.confidence,
        risk: health.risk,
        nextAction: health.nextAction,
      };
    }));

    res.json(results);
  } catch (err) {
    req.log?.error({ err }, "portfolio/health error");
    res.status(500).json({ error: "Failed to fetch portfolio health" });
  }
});

export default router;
