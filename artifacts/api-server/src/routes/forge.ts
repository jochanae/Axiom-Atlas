import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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

    res.json(response);
  } catch (err: unknown) {
    req.log.error({ err }, "Forge error");
    res.status(500).json({ error: "Forge failed to process transcript" });
  }
});

export default router;
