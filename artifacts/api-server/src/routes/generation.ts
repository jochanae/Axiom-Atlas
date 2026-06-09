import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { db, generatedFiles, generationRuns, projectFlowCanvasTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type FlowNodeSummary = {
  id: string;
  label: string;
  type: string;
};

type ForgeSyncResponse = {
  summary: string;
  changes: string[];
  proposedNodeMatch: {
    nodeId: string | null;
    nodeLabel: string | null;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  } | null;
  proposedDnaLesson: {
    key: "constraints";
    text: string;
  } | null;
};

const generationRunColumns = {
  id: generationRuns.id,
  projectId: generationRuns.projectId,
  userId: generationRuns.userId,
  prompt: generationRuns.prompt,
  intent: generationRuns.intent,
  model: generationRuns.model,
  status: generationRuns.status,
  startedAt: generationRuns.startedAt,
  finishedAt: generationRuns.finishedAt,
  durationMs: generationRuns.durationMs,
  filesChanged: generationRuns.filesChanged,
  linesAdded: generationRuns.linesAdded,
  linesRemoved: generationRuns.linesRemoved,
  summary: generationRuns.summary,
  commitSha: generationRuns.commitSha,
  pushedToBranch: generationRuns.pushedToBranch,
};

// Verify that a project exists and is owned by the given userId.
async function projectBelongsToUser(projectId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

function serializeGenerationRun(run: typeof generationRuns.$inferSelect) {
  return {
    id: run.id,
    projectId: run.projectId,
    userId: run.userId,
    prompt: run.prompt,
    intent: run.intent,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.durationMs,
    filesChanged: run.filesChanged,
    linesAdded: run.linesAdded,
    linesRemoved: run.linesRemoved,
    summary: run.summary,
    commitSha: run.commitSha,
    pushedToBranch: run.pushedToBranch,
  };
}

function serializeGeneratedFile(file: typeof generatedFiles.$inferSelect) {
  return {
    id: file.id,
    runId: file.runId,
    path: file.path,
    language: file.language,
    bytes: file.bytes,
    lines: file.lines,
    content: file.content,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    status: file.status,
    previousContent: file.previousContent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractFlowNodeSummaries(nodes: unknown): FlowNodeSummary[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node): FlowNodeSummary[] => {
    if (!isRecord(node)) return [];
    const id = typeof node.id === "string" ? node.id.trim() : "";
    const type = typeof node.type === "string" ? node.type.trim() : "";
    const data = isRecord(node.data) ? node.data : {};
    const labelFromNode = typeof node.label === "string" ? node.label.trim() : "";
    const labelFromData = typeof data.label === "string" ? data.label.trim() : "";
    const label = labelFromNode || labelFromData;
    if (!id || !label || !type) return [];
    return [{ id, label, type }];
  });
}

function fallbackForgeSyncResponse(files: Array<{ path: string }>): ForgeSyncResponse {
  return {
    summary: `Build analyzed — ${files.length} file(s) changed.`,
    changes: files.map((file) => file.path),
    proposedNodeMatch: null,
    proposedDnaLesson: null,
  };
}

function stripJsonEnvelope(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fenced?.[1]?.trim() ?? trimmed;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) return unfenced.slice(start, end + 1);
  return unfenced;
}

function parseForgeSyncResponse(raw: string, flowNodes: FlowNodeSummary[], fallback: ForgeSyncResponse): ForgeSyncResponse {
  try {
    const parsed = JSON.parse(stripJsonEnvelope(raw)) as unknown;
    if (!isRecord(parsed)) return fallback;

    const summary = typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallback.summary;
    const changes = Array.isArray(parsed.changes)
      ? parsed.changes.filter((change): change is string => typeof change === "string" && change.trim()).map((change) => change.trim())
      : fallback.changes;

    let proposedNodeMatch: ForgeSyncResponse["proposedNodeMatch"] = null;
    if (isRecord(parsed.proposedNodeMatch)) {
      const rawNodeId = typeof parsed.proposedNodeMatch.nodeId === "string" ? parsed.proposedNodeMatch.nodeId : null;
      const matchedNode = rawNodeId ? flowNodes.find((node) => node.id === rawNodeId) : null;
      const confidence = parsed.proposedNodeMatch.confidence === "high" || parsed.proposedNodeMatch.confidence === "medium" || parsed.proposedNodeMatch.confidence === "low"
        ? parsed.proposedNodeMatch.confidence
        : "low";
      if (matchedNode) {
        proposedNodeMatch = {
          nodeId: matchedNode.id,
          nodeLabel: matchedNode.label,
          confidence,
          reasoning: typeof parsed.proposedNodeMatch.reasoning === "string" && parsed.proposedNodeMatch.reasoning.trim()
            ? parsed.proposedNodeMatch.reasoning.trim()
            : "This build appears related to the matched flow node.",
        };
      }
    }

    const proposedDnaLesson = isRecord(parsed.proposedDnaLesson) && parsed.proposedDnaLesson.key === "constraints" && typeof parsed.proposedDnaLesson.text === "string" && parsed.proposedDnaLesson.text.trim()
      ? { key: "constraints" as const, text: parsed.proposedDnaLesson.text.trim() }
      : null;

    return {
      summary,
      changes,
      proposedNodeMatch,
      proposedDnaLesson,
    };
  } catch {
    return fallback;
  }
}

function buildForgeSyncPrompt(args: {
  run: Pick<typeof generationRuns.$inferSelect, "prompt" | "summary">;
  files: Array<Pick<typeof generatedFiles.$inferSelect, "path" | "status" | "content" | "previousContent">>;
  flowNodes: FlowNodeSummary[];
}): string {
  const files = args.files.map((file) => ({
    path: file.path,
    status: file.status,
    content: (file.content ?? "").slice(0, 1500),
    previousContent: file.previousContent ? file.previousContent.slice(0, 1500) : null,
  }));

  return [
    `Run prompt:\n${args.run.prompt ?? ""}`,
    `Run summary:\n${args.run.summary ?? ""}`,
    `Generated files:\n${JSON.stringify(files, null, 2)}`,
    `Flow nodes:\n${JSON.stringify(args.flowNodes, null, 2)}`,
  ].join("\n\n");
}

router.get("/projects/:projectId/generation-runs", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const rows = await db
    .select(generationRunColumns)
    .from(generationRuns)
    .where(eq(generationRuns.projectId, projectId))
    .orderBy(desc(generationRuns.startedAt))
    .limit(20);

  res.json(rows.map(serializeGenerationRun));
});

router.get("/projects/:projectId/generation-runs/:runId/files", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!(await projectBelongsToUser(projectId, userId))) {
    res.status(404).json({ error: "Project not found" }); return;
  }

  const [run] = await db
    .select({ id: generationRuns.id })
    .from(generationRuns)
    .where(and(eq(generationRuns.id, req.params.runId), eq(generationRuns.projectId, projectId)))
    .limit(1);
  if (!run) { res.status(404).json({ error: "Generation run not found" }); return; }

  const rows = await db
    .select()
    .from(generatedFiles)
    .where(eq(generatedFiles.runId, req.params.runId))
    .orderBy(asc(generatedFiles.path));

  res.json(rows.map(serializeGeneratedFile));
});

router.post("/projects/:projectId/forge-sync", async (req, res): Promise<void> => {
  let fallback: ForgeSyncResponse = {
    summary: "Build analyzed — 0 file(s) changed.",
    changes: [],
    proposedNodeMatch: null,
    proposedDnaLesson: null,
  };

  try {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project id" }); return; }

    const userId = (req as any).authUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!(await projectBelongsToUser(projectId, userId))) {
      res.status(404).json({ error: "Project not found" }); return;
    }

    const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
    if (!runId) { res.status(400).json({ error: "Missing runId" }); return; }

    const [run] = await db
      .select(generationRunColumns)
      .from(generationRuns)
      .where(and(eq(generationRuns.id, runId), eq(generationRuns.projectId, projectId)))
      .limit(1);
    if (!run) { res.status(404).json({ error: "Generation run not found" }); return; }

    const [files, canvasRows] = await Promise.all([
      db
        .select({
          path: generatedFiles.path,
          status: generatedFiles.status,
          content: generatedFiles.content,
          previousContent: generatedFiles.previousContent,
        })
        .from(generatedFiles)
        .where(eq(generatedFiles.runId, runId))
        .orderBy(asc(generatedFiles.path)),
      db
        .select({ nodes: projectFlowCanvasTable.nodes })
        .from(projectFlowCanvasTable)
        .where(eq(projectFlowCanvasTable.projectId, projectId))
        .limit(1),
    ]);
    const flowNodes = extractFlowNodeSummaries(canvasRows[0]?.nodes);
    fallback = fallbackForgeSyncResponse(files);

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        system: "You are Forge Sync, a code reconciliation analyzer. You are given the files from a code generation run and the current strategic flow nodes of the project. Produce ONLY a JSON object (no markdown, no prose) with this exact shape: {\"summary\": \"2-3 sentence plain-English description of what this build changed, written for a non-engineer founder\", \"changes\": [\"short bullet of each concrete change\"], \"proposedNodeMatch\": {\"nodeId\": \"<id from the provided node list, or null>\", \"nodeLabel\": \"<label or null>\", \"confidence\": \"high|medium|low\", \"reasoning\": \"one sentence why this build advances this node\"} or null if no node fits, \"proposedDnaLesson\": {\"key\": \"constraints\", \"text\": \"a durable build-style preference this code demonstrates, phrased as a rule\"} or null if nothing durable}. Only propose a node from the provided list — never invent a node id. If the node list is empty, proposedNodeMatch must be null.",
        messages: [{ role: "user", content: buildForgeSyncPrompt({ run, files, flowNodes }) }],
      });
      const raw = response.content.find((block) => block.type === "text")?.text ?? "";
      res.status(200).json(parseForgeSyncResponse(raw, flowNodes, fallback));
      return;
    } catch {
      res.status(200).json(fallback);
      return;
    }
  } catch {
    res.status(200).json(fallback);
  }
});

export default router;
