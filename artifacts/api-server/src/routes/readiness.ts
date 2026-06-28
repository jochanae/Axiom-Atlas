import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  projectsTable,
  entriesTable,
  readinessSnapshotsTable,
} from "@workspace/db";
import { getProjectDNA } from "../lib/projectDNA";

const router: IRouter = Router();

type ProjectKind = "app" | "strategy" | "general";
type DimensionKey = "build" | "strategy" | "activity" | "delivery";

interface ReadinessDimension {
  score: number;
  label: string;
  weight: number;
  applicable: boolean;
  evidence: string;
}

interface ProjectReadiness {
  overallScore: number;
  overallLabel: string;
  projectKind: ProjectKind;
  dimensions: Partial<Record<DimensionKey, ReadinessDimension>>;
  warnings: string[];
  sourceBreakdown: {
    appBuildSucceeded: boolean | null;
    appSourceFileCount: number | null;
    flowDefinedNodes: number;
    flowTotalNodes: number;
    committedEntries: number;
    totalEntries: number;
    genomeConfidenceScore: number;
    genomeStage: string;
    latestSnapshotScore: number | null;
    hasLinkedRepo: boolean;
    hasPreviewUrl: boolean;
  };
}

function dimensionLabel(score: number, applicable: boolean): string {
  if (!applicable) return "N/A";
  if (score >= 80) return "Complete";
  if (score >= 55) return "Taking shape";
  if (score >= 30) return "In progress";
  if (score > 0) return "Initializing";
  return "Not started";
}

function toOverallLabel(score: number): string {
  if (score >= 80) return "Shipping";
  if (score >= 56) return "Preview ready";
  if (score >= 36) return "Taking shape";
  if (score >= 16) return "Building";
  return "Getting started";
}

function extractFlowNodes(nodeState: unknown): { defined: number; total: number } {
  if (!nodeState || typeof nodeState !== "object" || Array.isArray(nodeState)) {
    return { defined: 0, total: 0 };
  }
  let defined = 0;
  let total = 0;
  for (const raw of Object.values(nodeState as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const node = raw as Record<string, unknown>;
    if (node.meta === "wont") continue;
    total++;
    const answer = node.strategicAnswer;
    if (typeof answer === "string" && answer.trim().length > 0) defined++;
  }
  return { defined, total };
}

export async function computeProjectReadiness(projectId: number): Promise<ProjectReadiness> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const genome = await getProjectDNA(projectId);

  const [entryStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      committed: sql<number>`count(*) filter (where status = 'committed')::int`,
    })
    .from(entriesTable)
    .where(eq(entriesTable.projectId, projectId));

  const committedEntries = entryStats?.committed ?? 0;
  const totalEntries = entryStats?.total ?? 0;
  const genomeConfidenceScore = genome?.confidenceScore ?? 0;
  const genomeStage = genome?.stage ?? "Think";
  const { defined: flowDefinedNodes, total: flowTotalNodes } = extractFlowNodes(project.nodeState);
  const hasLinkedRepo = Boolean(project.linkedRepo);
  const hasPreviewUrl = Boolean(project.previewUrl);

  const projectKind: ProjectKind =
    project.projectType === "app"
      ? "app"
      : flowTotalNodes === 0 && totalEntries === 0 && genomeConfidenceScore === 0
        ? "strategy"
        : "general";

  const warnings: string[] = [];

  const buildApplicable =
    project.projectType === "app" ||
    Boolean(project.appSourceFileCount && project.appSourceFileCount > 0);

  let buildScore = 0;
  if (buildApplicable) {
    const filesOk = Boolean(project.appSourceFileCount && project.appSourceFileCount > 0);
    const buildOk = project.appBuildSucceeded === true;
    buildScore = (filesOk ? 50 : 0) + (buildOk ? 50 : 0);
    if (filesOk && project.appBuildSucceeded === null) {
      warnings.push("Build status not yet tracked — re-run the workspace devserver");
    }
    if (project.appBuildSucceeded === false) {
      warnings.push("Last build failed — check workspace logs");
    }
  }

  const strategyFromGenome = genomeConfidenceScore;
  const strategyFromFlow =
    flowTotalNodes === 0 ? 0 : Math.round((flowDefinedNodes / flowTotalNodes) * 100);
  const strategyScore = Math.round(strategyFromGenome * 0.5 + strategyFromFlow * 0.5);

  const activityScore =
    totalEntries === 0 ? 0 : Math.min(100, Math.round((committedEntries / 10) * 100));

  const deliveryApplicable = hasLinkedRepo || hasPreviewUrl;
  const deliveryScore = deliveryApplicable
    ? (hasLinkedRepo ? 50 : 0) + (hasPreviewUrl ? 50 : 0)
    : 0;

  const rawWeights: Record<DimensionKey, number> = {
    build: projectKind === "app" ? 0.5 : projectKind === "general" ? 0.3 : 0,
    strategy: projectKind === "app" ? 0.2 : projectKind === "strategy" ? 0.6 : 0.4,
    activity: projectKind === "app" ? 0.2 : projectKind === "strategy" ? 0.4 : 0.2,
    delivery: projectKind === "app" ? 0.1 : projectKind === "strategy" ? 0 : 0.1,
  };

  const applicable: Record<DimensionKey, boolean> = {
    build: buildApplicable,
    strategy: true,
    activity: true,
    delivery: deliveryApplicable,
  };

  const totalApplicableWeight = (Object.keys(rawWeights) as DimensionKey[]).reduce(
    (sum, key) => sum + (applicable[key] ? rawWeights[key] : 0),
    0,
  );

  const normalizedWeights: Record<DimensionKey, number> = {
    build:
      applicable.build && totalApplicableWeight > 0
        ? rawWeights.build / totalApplicableWeight
        : 0,
    strategy:
      applicable.strategy && totalApplicableWeight > 0
        ? rawWeights.strategy / totalApplicableWeight
        : 0,
    activity:
      applicable.activity && totalApplicableWeight > 0
        ? rawWeights.activity / totalApplicableWeight
        : 0,
    delivery:
      applicable.delivery && totalApplicableWeight > 0
        ? rawWeights.delivery / totalApplicableWeight
        : 0,
  };

  const scores: Record<DimensionKey, number> = {
    build: buildScore,
    strategy: strategyScore,
    activity: activityScore,
    delivery: deliveryScore,
  };

  const evidenceStrings: Record<DimensionKey, string> = {
    build: buildApplicable
      ? `${project.appSourceFileCount ?? 0} files · build ${
          project.appBuildSucceeded === true
            ? "succeeded"
            : project.appBuildSucceeded === false
              ? "failed"
              : "not tracked"
        }`
      : "N/A",
    strategy: `${genomeConfidenceScore}% genome clarity · ${flowDefinedNodes}/${flowTotalNodes} nodes answered`,
    activity: `${committedEntries} committed of ${totalEntries} entries`,
    delivery: deliveryApplicable
      ? `${hasLinkedRepo ? "repo linked" : "no repo"} · ${hasPreviewUrl ? "live URL set" : "no live URL"}`
      : "N/A",
  };

  const dimensions: Partial<Record<DimensionKey, ReadinessDimension>> = {};
  for (const key of Object.keys(rawWeights) as DimensionKey[]) {
    if (!applicable[key] && rawWeights[key] === 0) continue;
    dimensions[key] = {
      score: scores[key],
      label: dimensionLabel(scores[key], applicable[key]),
      weight: normalizedWeights[key],
      applicable: applicable[key],
      evidence: evidenceStrings[key],
    };
  }

  const overallScore = Math.round(
    (Object.keys(normalizedWeights) as DimensionKey[]).reduce(
      (sum, key) => sum + (applicable[key] ? scores[key] * normalizedWeights[key] : 0),
      0,
    ),
  );

  let latestSnapshotScore: number | null = null;
  try {
    const [snap] = await db
      .select({ score: readinessSnapshotsTable.score })
      .from(readinessSnapshotsTable)
      .where(eq(readinessSnapshotsTable.projectId, projectId))
      .orderBy(desc(readinessSnapshotsTable.recordedAt))
      .limit(1);
    latestSnapshotScore = snap?.score ?? null;
  } catch {
    // readiness_snapshots may not exist in all environments
  }

  return {
    overallScore,
    overallLabel: toOverallLabel(overallScore),
    projectKind,
    dimensions,
    warnings,
    sourceBreakdown: {
      appBuildSucceeded: project.appBuildSucceeded ?? null,
      appSourceFileCount: project.appSourceFileCount ?? null,
      flowDefinedNodes,
      flowTotalNodes,
      committedEntries,
      totalEntries,
      genomeConfidenceScore,
      genomeStage,
      latestSnapshotScore,
      hasLinkedRepo,
      hasPreviewUrl,
    },
  };
}

router.get("/projects/:id/readiness", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const userId = (req as any).authUser.id as number;

  const [owned] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!owned) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    const readiness = await computeProjectReadiness(projectId);
    res.json(readiness);
  } catch (err) {
    req.log.error({ err }, "Failed to compute project readiness");
    res.status(500).json({ error: "Failed to compute readiness" });
  }
});

export default router;
