import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const ForgeRequestSchema = z.object({
  transcript: z.string().min(10).max(20000),
  projectName: z.string().optional(),
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
}

interface ForgeResponse {
  nodes: ForgeNode[];
  summary: string;
}

const SYSTEM_PROMPT = `You are The Forge — a strategic extraction engine inside Axiom, a decision enforcement system for founders.

Your job: read a raw transcript, brain dump, voice note, or strategy document and extract structured strategic nodes.

Node types you can create:
- "goal": The primary outcome (use sparingly — 1-2 max)
- "requirement": A needed capability or constraint (MoSCoW priority in meta field)
- "blocker": An active impediment preventing progress
- "priority": A ranked item competing for focus or resources
- "decision": A committed choice that constrains future options
- "sprint": A bounded work increment

MoSCoW meta values (only for "requirement" type):
- "must": Non-negotiable, project fails without it
- "should": High value, strong expectation
- "could": Nice to have if time permits
- "wont": Explicitly out of scope this cycle

Rules:
1. Extract 3-8 nodes from any transcript. Don't over-extract.
2. Labels must be concise (2-6 words max). No verbs in labels.
3. Blockers must be real impediments, not hypotheticals.
4. Decisions must be things already decided, not open questions.
5. Every requirement needs a MoSCoW meta value.
6. Arrange nodes spatially — x: 100-600, y: 80-500. Goal at center-top. Spread logically.

Respond ONLY with valid JSON in this exact shape:
{
  "summary": "One sentence describing what you extracted and why.",
  "nodes": [
    {
      "id": "unique-kebab-id",
      "label": "Short Label",
      "type": "requirement",
      "resolved": false,
      "x": 300,
      "y": 150,
      "details": "Optional one-sentence elaboration on what this means.",
      "meta": "must"
    }
  ]
}`;

router.post("/forge", async (req, res) => {
  const parsed = ForgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { transcript, projectName } = parsed.data;

  const userPrompt = projectName
    ? `Project: ${projectName}\n\nTranscript:\n${transcript}`
    : `Transcript:\n${transcript}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
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

    const nodes: ForgeNode[] = data.nodes.map(n => ({
      id: String(n.id || `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      label: String(n.label || "Untitled").slice(0, 60),
      type: (["goal", "requirement", "blocker", "priority", "decision", "sprint"].includes(n.type)
        ? n.type : "requirement") as NodeType,
      resolved: false,
      x: Math.max(80, Math.min(600, Number(n.x) || 300)),
      y: Math.max(60, Math.min(500, Number(n.y) || 200)),
      details: n.details ? String(n.details).slice(0, 200) : undefined,
      meta: (["must", "should", "could", "wont"].includes(n.meta ?? "")
        ? n.meta : undefined) as NodeMeta | undefined,
    }));

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
