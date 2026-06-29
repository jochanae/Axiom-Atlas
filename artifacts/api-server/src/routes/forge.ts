import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { db, projectFlowCanvasTable, projectsTable, nexusMessagesTable } from "@workspace/db";
import { NODE_GENERATION_SYSTEM_PROMPT } from "../lib/nodeContract";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ExistingNodeSchema = z.object({
  label: z.string(),
  type: z.string(),
});

const ForgeRequestSchema = z.object({
  transcript: z.string().min(10).max(20000),
  projectContext: z.string().max(4000).optional(),
  repoContext: z.string().max(3000).optional(),
  projectId: z.number().optional(),
  moscow: z.boolean().optional(),
  existingNodes: z.array(ExistingNodeSchema).optional(),
});

type NodeType = "goal" | "requirement" | "blocker" | "priority" | "decision" | "sprint" | "wont";
type NodeMeta = "must" | "should" | "could" | "wont";

interface ForgeNode {
  id: string;
  label: string;
  type: NodeType;
  resolved: boolean;
  x: number;
  y: number;
  details?: string;
  meta?: NodeMeta;
  moscow?: NodeMeta;
  question?: string;
}

interface ForgeResponse {
  nodes: ForgeNode[];
  summary: string;
}

const VALID_TYPES: NodeType[] = ["goal", "requirement", "blocker", "priority", "decision", "sprint", "wont"];
const VALID_META: NodeMeta[] = ["must", "should", "could", "wont"];
const MAX_NODES = 12;

// Normalize a label for fuzzy comparison
function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// Returns true if newLabel is a duplicate of any existing node label
function isDuplicate(
  newLabel: string,
  newType: string,
  existing: Array<{ label: string; type: string }>
): boolean {
  const norm = normalizeLabel(newLabel);
  for (const e of existing) {
    const eNorm = normalizeLabel(e.label);
    // Exact match after normalization
    if (norm === eNorm) return true;
    // One label contains the other — catches "no recording equipment" vs "recording equipment"
    if (norm.length >= 5 && eNorm.length >= 5 && (norm.includes(eNorm) || eNorm.includes(norm))) return true;
    // Same type + at least 2 meaningful words in common — catches "solo vs co-host" vs "solo vs. co-host format"
    if (e.type === newType) {
      const sig = (s: string) => s.split(" ").filter(w => w.length > 3);
      const overlap = sig(norm).filter(w => sig(eNorm).includes(w));
      if (overlap.length >= 2) return true;
    }
  }
  return false;
}

// Pre-compute radial positions around a center point
function radialPositions(count: number, cx = 300, cy = 250, radius = 160): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
    };
  });
}

const PIVOT_QUESTIONS: Record<string, string> = {
  "goal":             "What does winning look like? What's the outcome you'll be proud of?",
  "requirement":      "What must exist for this goal to be achievable?",
  "blocker":          "What could prevent this from shipping or succeeding?",
  "decision":         "Who owns this decision, and what information do you need to make it?",
  "sprint":           "What is the single deliverable that makes this sprint complete?",
  "priority/must":    "Why is this non-negotiable? What breaks without it?",
  "priority/should":  "What's the cost of deferring this to v2?",
  "priority/could":   "Under what conditions does this become a Must?",
  "priority/wont":    "Who asked for this, and why are we saying no?",
};

function getPivotQuestion(type: NodeType, meta?: NodeMeta): string {
  if (type === "priority" && meta) return PIVOT_QUESTIONS[`priority/${meta}`] ?? PIVOT_QUESTIONS["priority/must"];
  return PIVOT_QUESTIONS[type] ?? "What does this mean for the project?";
}


router.post("/forge/intake", async (req, res) => {
  const { projectId, answers, skipped } = req.body as {
    projectId?: number;
    answers?: Record<string, string>;
    skipped?: boolean;
  };
  req.log.info({ projectId, skipped }, "Forge intake answers received");
  res.json({ ok: true, projectId, skipped: !!skipped });
});

router.post("/forge", async (req, res) => {
  const parsed = ForgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { transcript, projectContext, repoContext, existingNodes = [] } = parsed.data;

  const contextParts: string[] = [];
  if (repoContext) contextParts.push(`Existing Repo Docs (already committed — do NOT re-extract as new nodes, use only for context):\n${repoContext}`);
  if (projectContext) contextParts.push(`Project Context:\n${projectContext}`);
  const userPrompt = contextParts.length > 0
    ? `${contextParts.join("\n\n")}\n\nTranscript:\n${transcript}`
    : `Transcript:\n${transcript}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: NODE_GENERATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Forge produced no structured output" });
      return;
    }

    const data = JSON.parse(jsonMatch[0]) as ForgeResponse;

    if (!Array.isArray(data.nodes) || typeof data.summary !== "string") {
      res.status(500).json({ error: "Unexpected forge output shape" });
      return;
    }

    // Hard cap at MAX_NODES
    const rawNodes = data.nodes.slice(0, MAX_NODES);

    // Pre-compute radial positions as fallback
    const radial = radialPositions(rawNodes.length);

    const nodes: ForgeNode[] = rawNodes.map((n, idx) => {
      const type = (VALID_TYPES.includes(n.type) ? n.type : "requirement") as NodeType;
      const rawMoscow = (n.moscow ?? n.meta ?? (type === "wont" ? "wont" : "")) as NodeMeta;
      const moscow = VALID_META.includes(rawMoscow) ? rawMoscow : "should";
      const rawMeta = (n.meta ?? (type === "priority" ? moscow : "")) as NodeMeta;
      const meta = (type === "priority" && VALID_META.includes(rawMeta))
        ? rawMeta
        : type === "priority" ? "must" as NodeMeta : undefined;

      // Use AI coordinates if reasonable, else fall back to radial
      const aiX = Number(n.x);
      const aiY = Number(n.y);
      const x = (aiX >= 60 && aiX <= 560) ? aiX : radial[idx].x;
      const y = (aiY >= 50 && aiY <= 450) ? aiY : radial[idx].y;

      return {
        id: String(n.id || `node-${Date.now()}-${idx}`).slice(0, 60),
        label: String(n.label || "Untitled").slice(0, 30),
        type,
        resolved: false,
        x,
        y,
        details: n.details ? String(n.details).slice(0, 200) : undefined,
        meta,
        moscow,
        question: n.question
          ? String(n.question).slice(0, 200)
          : getPivotQuestion(type, meta),
      };
    });

    // Remove nodes whose labels are too similar to ones already on the map
    const deduped = existingNodes.length > 0
      ? nodes.filter(n => !isDuplicate(n.label, n.type, existingNodes))
      : nodes;

    const response: ForgeResponse = {
      summary: String(data.summary).slice(0, 300),
      nodes: deduped,
    };

    // Persist to the flow canvas table when projectId is provided.
    // This ensures nodes survive a page refresh without relying on the
    // client-side debounced save (which can race with navigation).
    const projectId = parsed.data.projectId;
    if (projectId) {
      const userId = (req as any).authUser?.id as number | undefined;
      if (userId) {
        try {
          const [proj] = await db
            .select({ id: projectsTable.id })
            .from(projectsTable)
            .where(eq(projectsTable.id, projectId));
          if (proj) {
            await db
              .insert(projectFlowCanvasTable)
              .values({ projectId, nodes: deduped, edges: [] })
              .onConflictDoUpdate({
                target: projectFlowCanvasTable.projectId,
                set: { nodes: deduped, edges: [], updatedAt: new Date() },
              });
            req.log.info({ projectId, nodeCount: deduped.length }, "Forge: persisted nodes to flow canvas");
          }
        } catch (persistErr) {
          req.log.error({ persistErr }, "Forge: failed to persist flow canvas (non-fatal)");
        }
      }
    }

    res.json(response);
  } catch (err: unknown) {
    req.log.error({ err }, "Forge error");
    res.status(500).json({ error: "Forge failed to process transcript" });
  }
});

// ── Expand a single node into sub-nodes (lens-aware, conversation-aware) ──────
const ExpandNodeSchema = z.object({
  nodeId: z.string(),
  nodeLabel: z.string(),
  nodeType: z.string(),
  projectId: z.number().optional(),
  lens: z.enum(["designer", "builder", "storyteller"]).default("designer"),
});

router.post("/expand-node", async (req, res) => {
  const parsed = ExpandNodeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const { nodeId, nodeLabel, nodeType, projectId, lens } = parsed.data;

  // Fetch recent project conversation for grounding
  let transcriptContext = "";
  if (projectId) {
    try {
      const msgs = await db
        .select({ role: nexusMessagesTable.role, content: nexusMessagesTable.content })
        .from(nexusMessagesTable)
        .where(eq(nexusMessagesTable.projectId, projectId))
        .orderBy(desc(nexusMessagesTable.createdAt))
        .limit(30);
      if (msgs.length > 0) {
        const lines = msgs.reverse().map(m =>
          `${m.role === "user" ? "User" : "Atlas"}: ${m.content.slice(0, 400)}`
        );
        transcriptContext = lines.join("\n");
      }
    } catch { /* non-fatal — continue without transcript */ }
  }

  const lensInstructions: Record<string, string> = {
    designer: "Focus on user experience, journeys, personas, pain points, accessibility, interface moments, and what the user actually encounters.",
    builder: "Focus on technical components, APIs, data models, system boundaries, integrations, infrastructure, and what needs to be built.",
    storyteller: "Focus on origin story, vision, the why behind this, user narrative, product DNA, the problem in human terms, and what makes this matter.",
  };

  const systemPrompt = `You are expanding a specific node in a project's Axiom Flow map into sub-nodes.

Node being expanded: "${nodeLabel}" (type: ${nodeType})
Lens: ${lens.toUpperCase()}
${lensInstructions[lens] ?? ""}

Generate 4–7 sub-nodes that break this node down one level deeper. Requirements:
- Be specific to this project's context (not generic)
- Each sub-node is concrete and represents a real concern or component
- Use these node types: requirement, blocker, decision, priority, sprint, goal
${transcriptContext ? `\nProject conversation context:\n${transcriptContext.slice(0, 3000)}` : ""}

Respond with ONLY a JSON array. Each element:
{"id":"short-slug","label":"Concise label (4–6 words)","type":"requirement|blocker|decision|priority|sprint","resolved":false,"meta":"must|should|could","details":"one sentence of context","x":0,"y":0}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: systemPrompt }],
    });

    const rawText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    const arrMatch = rawText.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error("No JSON array in response");

    const rawNodes = JSON.parse(arrMatch[0]) as unknown[];
    const nodes = rawNodes
      .filter(n => n !== null && typeof n === "object" && typeof (n as { label?: unknown }).label === "string")
      .slice(0, 8)
      .map((n, i) => {
        const rec = n as Record<string, unknown>;
        return {
          id: `${nodeId}-s${i}-${String(rec.id ?? i).slice(0, 16).replace(/[^a-z0-9-]/gi, "")}`,
          label: String(rec.label).slice(0, 60),
          type: VALID_TYPES.includes(rec.type as NodeType) ? (rec.type as NodeType) : "requirement" as NodeType,
          resolved: false,
          meta: VALID_META.includes(rec.meta as NodeMeta) ? (rec.meta as NodeMeta) : "should" as NodeMeta,
          details: typeof rec.details === "string" ? rec.details : undefined,
          x: 0,
          y: 0,
        };
      });

    // Persist to drillCache — fire-and-forget, non-fatal if canvas row doesn't exist yet
    if (projectId) {
      const cacheKey = `${nodeId}:${lens}`;
      try {
        await db
          .update(projectFlowCanvasTable)
          .set({
            drillCache: sql`COALESCE(drill_cache, '{}'::jsonb) || ${JSON.stringify({ [cacheKey]: nodes })}::jsonb`,
          })
          .where(eq(projectFlowCanvasTable.projectId, projectId));
      } catch { /* non-fatal — canvas row may not exist yet */ }
    }

    res.json({ nodes });
  } catch (err: unknown) {
    req.log.error({ err }, "Forge expand-node error");
    res.status(500).json({ error: "Failed to expand node" });
  }
});

export default router;
