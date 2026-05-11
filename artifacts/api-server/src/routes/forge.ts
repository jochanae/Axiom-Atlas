import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ForgeRequestSchema = z.object({
  transcript: z.string().min(10).max(20000),
  projectContext: z.string().max(4000).optional(),
  projectId: z.number().optional(),
});

type NodeType = "goal" | "requirement" | "blocker" | "priority" | "decision" | "sprint";
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
  question?: string;
}

interface ForgeResponse {
  nodes: ForgeNode[];
  summary: string;
}

const VALID_TYPES: NodeType[] = ["goal", "requirement", "blocker", "priority", "decision", "sprint"];
const VALID_META: NodeMeta[] = ["must", "should", "could", "wont"];
const MAX_NODES = 12;

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

const SYSTEM_PROMPT = `You are The Forge — a strategic extraction engine inside Axiom, a decision enforcement system for founders.

Your job: read a raw transcript, brain dump, voice note, or strategy document and extract structured strategic nodes.

Node types you can create (choose the most appropriate):
- "goal": The primary outcome or north star (1-2 max, only if the transcript defines a clear goal)
- "requirement": A needed capability or constraint
- "blocker": An active impediment preventing progress (must be real, not hypothetical)
- "priority": A ranked work item with a MoSCoW sub-type (meta field required)
- "decision": A committed choice that constrains future options (must already be decided, not open)
- "sprint": A bounded work increment with a defined goal

For "priority" nodes, you MUST include a "meta" field:
- "must": Non-negotiable, project fails without it
- "should": High value, strong expectation
- "could": Nice to have if time permits
- "wont": Explicitly out of scope this cycle

Rules:
1. Extract 3-${MAX_NODES} nodes. Never exceed ${MAX_NODES} nodes. Prefer fewer, higher-quality nodes.
2. Labels must be concise: 2-6 words max. No verbs in labels. No punctuation.
3. Every "priority" node MUST have a "meta" value. Other types must NOT have "meta".
4. "blocker" nodes must describe real current impediments.
5. "decision" means already decided — not a question.
6. x/y coordinates: place nodes in a rough radial pattern around center (300, 250). Spread across x: 80-520, y: 80-420.
7. Include a "question" field for each node — the strategic pivot question a founder should answer for this node.
8. Keep "label" to 30 characters max.

Respond ONLY with valid JSON — no markdown, no explanation, no code fences:
{
  "summary": "One concise sentence describing what you extracted.",
  "nodes": [
    {
      "id": "unique-kebab-slug",
      "label": "Short Label",
      "type": "priority",
      "meta": "must",
      "resolved": false,
      "x": 300,
      "y": 120,
      "details": "Brief one-sentence elaboration on what this node means strategically.",
      "question": "The strategic pivot question for this node."
    }
  ]
}`;

router.post("/forge", async (req, res) => {
  const parsed = ForgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { transcript, projectContext } = parsed.data;

  const userPrompt = projectContext
    ? `Project Context:\n${projectContext}\n\nTranscript:\n${transcript}`
    : `Transcript:\n${transcript}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
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
      const rawMeta = (n.meta ?? "") as NodeMeta;
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
        question: n.question
          ? String(n.question).slice(0, 200)
          : getPivotQuestion(type, meta),
      };
    });

    const response: ForgeResponse = {
      summary: String(data.summary).slice(0, 300),
      nodes,
    };

    res.json(response);
  } catch (err: unknown) {
    req.log.error({ err }, "Forge error");
    res.status(500).json({ error: "Forge failed to process transcript" });
  }
});

export default router;
