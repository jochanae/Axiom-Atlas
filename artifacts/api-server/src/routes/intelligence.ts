/**
 * GET /api/projects/:id/intelligence
 * GET /api/portfolio/intelligence
 *
 * The single source of truth for project state.
 * Master Map, Axiom Flow header, HUD, Workspace ring, Portfolio cards
 * all consume this endpoint — never computing independently.
 *
 * Composes:
 *   - project_genome  → DNA fields + health signals (momentum, clarity, atlasState)
 *   - computeProjectReadiness() → overall %, dimension scores
 *   - entries table  → decisions, blockers, goals, open questions as typed lists
 */

import { Router, type IRouter } from "express";
import { eq, and, desc, ne, sql, count, inArray } from "drizzle-orm";
import {
  db,
  projectsTable,
  entriesTable,
  nexusMessagesTable,
  projectFlowCanvasTable,
} from "@workspace/db";
import { computeProjectReadiness } from "./readiness";
import type { AtlasState } from "./genome";
import { getProjectDNA } from "../lib/projectDNA";

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

type MomentumLevel = "Low" | "Medium" | "High";
type ConfidenceLevel = "Low" | "Medium" | "High";

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

export async function computeProjectIntelligence(projectId: number) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    genome,
    [project],
    readiness,
    recentEntries,
    [msgRow],
    [objectCountRow],
    [flowCanvas],
  ] = await Promise.all([
    getProjectDNA(projectId),

    db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      status: projectsTable.status,
      linkedRepo: projectsTable.linkedRepo,
      previewUrl: projectsTable.previewUrl,
    })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),

    computeProjectReadiness(projectId),

    db.select({
      id: entriesTable.id,
      type: entriesTable.type,
      title: entriesTable.title,
      summary: entriesTable.summary,
      status: entriesTable.status,
      severity: entriesTable.severity,
      createdAt: entriesTable.createdAt,
    })
      .from(entriesTable)
      .where(and(
        eq(entriesTable.projectId, projectId),
        ne(entriesTable.status, "archived"),
      ))
      .orderBy(desc(entriesTable.createdAt))
      .limit(80),

    db.select({ n: count() })
      .from(nexusMessagesTable)
      .where(and(
        eq(nexusMessagesTable.projectId, projectId),
        sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
        sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
        sql`${nexusMessagesTable.createdAt} >= ${sevenDaysAgo.toISOString()}`,
      )),

    db.select({ n: count() })
      .from(entriesTable)
      .where(and(
        eq(entriesTable.projectId, projectId),
        ne(entriesTable.status, "archived"),
      )),

    db.select()
      .from(projectFlowCanvasTable)
      .where(eq(projectFlowCanvasTable.projectId, projectId))
      .limit(1),
  ]);

  const recentMsgCount = Number(msgRow?.n ?? 0);
  const objectCount = Number(objectCountRow?.n ?? 0);
  const hasFlow = !!(flowCanvas?.nodes && Array.isArray(flowCanvas.nodes) && (flowCanvas.nodes as unknown[]).length > 0);
  const constraints = genome?.constraints ?? [];
  const openQuestions = genome?.openQuestions ?? [];
  const stage = genome?.stage ?? "Think";
  const confidenceScore = genome?.confidenceScore ?? 0;

  const blockers = recentEntries.filter(e => e.type === "Blocker");
  const blockerCount = blockers.length;

  const atlasState = computeAtlasState(
    stage,
    confidenceScore,
    openQuestions.length,
    constraints.length,
    blockerCount,
    recentMsgCount,
    objectCount,
  );

  const topBlockerTitle = blockers[0]?.title ?? null;
  const risk = topBlockerTitle ?? constraints[0] ?? null;

  const entryGroups = {
    decisions: recentEntries
      .filter(e => e.type === "Decision")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, createdAt: e.createdAt.toISOString() })),
    blockers: recentEntries
      .filter(e => e.type === "Blocker")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, severity: e.severity, createdAt: e.createdAt.toISOString() })),
    goals: recentEntries
      .filter(e => e.type === "Goal")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, createdAt: e.createdAt.toISOString() })),
    ideas: recentEntries
      .filter(e => e.type === "Idea")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, createdAt: e.createdAt.toISOString() })),
    features: recentEntries
      .filter(e => e.type === "Feature")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, createdAt: e.createdAt.toISOString() })),
    risks: recentEntries
      .filter(e => e.type === "Risk")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, status: e.status, createdAt: e.createdAt.toISOString() })),
    openQuestionEntries: recentEntries
      .filter(e => e.status === "parked")
      .map(e => ({ id: e.id, title: e.title, summary: e.summary, type: e.type, createdAt: e.createdAt.toISOString() })),
  };

  return {
    projectId,
    projectName: project?.name ?? null,
    projectDescription: project?.description ?? null,
    projectStatus: project?.status ?? null,

    // DNA — genome fields
    dna: {
      purpose: genome?.purpose ?? null,
      coreEmotion: genome?.coreEmotion ?? null,
      audience: genome?.audience ?? null,
      identity: genome?.identity ?? null,
      wedge: genome?.wedge ?? null,
      differentiator: genome?.differentiator ?? null,
      stage,
      constraints,
      openQuestions,
      confidenceScore,
      lastExtractedAt: genome?.lastExtractedAt?.toISOString() ?? null,
    },

    // Health — computed signals (never stored, always fresh)
    health: {
      clarity: confidenceScore,
      confidence: confidenceLevelFromScore(confidenceScore),
      momentum: momentumFromCount(recentMsgCount),
      atlasState,
      risk,
      nextAction: nextActionForStage(stage, openQuestions, constraints),
      evidence: {
        conversationsLast7Days: recentMsgCount,
        openBlockers: blockerCount,
        openConstraints: constraints.length,
        openQuestions: openQuestions.length,
        confidenceScore,
      },
    },

    // Readiness — the canonical % ring and dimension breakdown
    readiness: {
      overall: readiness.overallScore,
      label: readiness.overallLabel,
      projectKind: readiness.projectKind,
      dimensions: readiness.dimensions,
      warnings: readiness.warnings,
      sourceBreakdown: readiness.sourceBreakdown,
    },

    // Flow canvas — whether a mapped flow exists for this project
    hasFlow,

    // Entries — typed lists for Master Map, Ledger, and HUD
    entries: entryGroups,

    computedAt: new Date().toISOString(),
  };
}

// GET /api/projects/:id/intelligence
router.get("/projects/:id/intelligence", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.id);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

    const owns = await assertProjectOwner(projectId, userId);
    if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

    const intelligence = await computeProjectIntelligence(projectId);
    res.json(intelligence);
  } catch (err) {
    req.log?.error({ err }, "intelligence GET error");
    res.status(500).json({ error: "Failed to compute project intelligence" });
  }
});

// GET /api/portfolio/intelligence — batch intelligence for all user projects
router.get("/portfolio/intelligence", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;

    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId))
      .orderBy(desc(projectsTable.updatedAt));

    if (projects.length === 0) { res.json([]); return; }

    const results = await Promise.all(
      projects.map(async (p) => {
        try {
          return await computeProjectIntelligence(p.id);
        } catch {
          return {
            projectId: p.id,
            projectName: p.name,
            projectDescription: null,
            projectStatus: null,
            dna: { purpose: null, coreEmotion: null, audience: null, identity: null, wedge: null, differentiator: null, stage: "Think", constraints: [], openQuestions: [], confidenceScore: 0, lastExtractedAt: null },
            health: { clarity: 0, confidence: "Low" as const, momentum: "Low" as const, atlasState: "Discovering" as AtlasState, risk: null, nextAction: "Start shaping your core idea", evidence: { conversationsLast7Days: 0, openBlockers: 0, openConstraints: 0, openQuestions: 0, confidenceScore: 0 } },
            readiness: { overall: 0, label: "Getting started", projectKind: "general" as const, dimensions: {}, warnings: [], sourceBreakdown: null },
            entries: { decisions: [], blockers: [], goals: [], ideas: [], features: [], risks: [], openQuestionEntries: [] },
            computedAt: new Date().toISOString(),
          };
        }
      }),
    );

    res.json(results);
  } catch (err) {
    req.log?.error({ err }, "portfolio/intelligence error");
    res.status(500).json({ error: "Failed to compute portfolio intelligence" });
  }
});

export default router;
