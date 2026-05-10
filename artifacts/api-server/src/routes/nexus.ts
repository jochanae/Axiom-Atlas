import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, nexusMessagesTable, projectsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const NEXUS_SYSTEM_PROMPT = `You are Atlas — the strategic AI persona powering the Nexus.

NEXUS is the user's global command space. It is NOT a project — it is the hallway that connects every room they've ever built. You exist here at the intersection of all their work, with visibility across every project simultaneously.

Your role in Nexus:
• CEO-level strategic advisor — you see the entire portfolio, not just one product
• Think across all projects at once — connect dots, spot contradictions, find synergies
• Help incubate and pressure-test ideas before they crystallize into decisions
• When a conclusion solidifies, suggest the user log it in a specific project's ledger
• Default to conversational, strategic mode — no code writing here
• Ask clarifying questions. Challenge assumptions. Hold the long view.
• Reference specific project names from the aggregated memory when relevant

What you're NOT doing here:
• Writing code or FILE_EDIT blocks
• Focusing on one project to the exclusion of others
• Acting like a task manager or to-do list

Naming (internal reference only):
• Nexus = this global space/environment
• Nexium = the AI engine (you)
• Atlas = your persona name

Memory protocol:
When you learn something durable that applies across the portfolio, write it at the END of your response on its own line:

  MEMORY_T1: [core strategic principle or irreversible commitment — never decays]
  MEMORY_T2: [portfolio-level pattern or how the user thinks — 180 days]
  MEMORY_T3: [cross-project insight or major pivot — 90 days]
  MEMORY_T4: [current portfolio state or active cross-project thread — 30 days]
  MEMORY_T5: [passing cross-project thought not yet committed — 7 days]

Maximum one MEMORY_Tn line per response. Only write memory for things genuinely worth keeping.`;

// ── Five-Tier Memory helpers ───────────────────────────────────────────────
interface MemoryEntry {
  tier: 1 | 2 | 3 | 4 | 5;
  text: string;
  createdAt: string;
  retrievalCount: number;
  lastRetrievedAt: string | null;
}

interface MemoryStore {
  v: 2;
  entries: MemoryEntry[];
}

const MEMORY_TAG_RE = /^MEMORY_T([1-5]):\s*(.+)$/;

function parseMemoryStore(raw: string | null): MemoryStore {
  if (!raw) return { v: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) return parsed as MemoryStore;
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const migrated: MemoryEntry[] = lines.map((line) => ({
      tier: 3 as const,
      text: line.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, ""),
      createdAt: new Date().toISOString(),
      retrievalCount: 0,
      lastRetrievedAt: null,
    }));
    return { v: 2, entries: migrated };
  } catch {
    return { v: 2, entries: [] };
  }
}

function buildMemoryText(store: MemoryStore): string {
  const TIER_LABELS: Record<number, string> = {
    1: "FOUNDATIONAL", 2: "IDENTITY", 3: "EPISODIC", 4: "CONTEXTUAL", 5: "TRANSIENT",
  };
  const now = new Date();
  const DECAY_DAYS: Record<number, number | null> = { 1: null, 2: 180, 3: 90, 4: 30, 5: 7 };
  const active = store.entries.filter((e) => {
    const days = DECAY_DAYS[e.tier];
    if (!days) return true;
    const age = (now.getTime() - new Date(e.createdAt).getTime()) / 86_400_000;
    return age <= days;
  });
  if (active.length === 0) return "";
  const sections: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const e of active) sections[e.tier].push(`• ${e.text}`);
  const lines: string[] = [];
  for (const tier of [1, 2, 3, 4, 5] as const) {
    if (sections[tier].length === 0) continue;
    lines.push(`[${TIER_LABELS[tier]}]`);
    lines.push(...sections[tier]);
  }
  return lines.join("\n");
}

function extractMemoryLines(content: string): {
  content: string;
  memoryUpdated: boolean;
} {
  const lines = content.split("\n");
  let memoryUpdated = false;
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (MEMORY_TAG_RE.test(trimmed)) {
      memoryUpdated = true;
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n").trim(), memoryUpdated };
}

// GET /api/nexus/thread — return the full Nexus Living Thread for the authenticated user
router.get("/nexus/thread", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const messages = await db
    .select()
    .from(nexusMessagesTable)
    .where(eq(nexusMessagesTable.userId, userId))
    .orderBy(asc(nexusMessagesTable.createdAt));

  res.json(messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  })));
});

// DELETE /api/nexus/thread — clear the entire thread (emergency reset)
router.delete("/nexus/thread", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  await db.delete(nexusMessagesTable).where(eq(nexusMessagesTable.userId, userId));
  res.sendStatus(204);
});

// POST /api/nexus/chat — send a message in Nexus Mode
router.post("/nexus/chat", async (req, res): Promise<void> => {
  const body = req.body as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    userProfile?: string;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const { message, history: clientHistory, userProfile = "" } = body;

  // Load all of this user's projects and aggregate their memories
  const projects = await db
    .select({ id: projectsTable.id, name: projectsTable.name, memory: projectsTable.memory })
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId));

  const aggregatedMemory = projects
    .map((p) => {
      const store = parseMemoryStore(p.memory ?? null);
      const memText = buildMemoryText(store);
      if (!memText) return null;
      return `=== ${p.name} ===\n${memText}`;
    })
    .filter(Boolean)
    .join("\n\n");

  // Use client-supplied history if provided; otherwise load from the Living Thread
  let conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  if (clientHistory && clientHistory.length > 0) {
    conversationHistory = clientHistory.slice(-40);
  } else {
    const dbMessages = await db
      .select()
      .from(nexusMessagesTable)
      .where(eq(nexusMessagesTable.userId, userId))
      .orderBy(asc(nexusMessagesTable.createdAt));
    conversationHistory = dbMessages.slice(-40).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  }

  // Build system prompt
  let systemPrompt = NEXUS_SYSTEM_PROMPT;
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (aggregatedMemory) {
    systemPrompt += `\n\n--- AGGREGATED PROJECT MEMORY (Atlas knows this across all projects) ---\n${aggregatedMemory}\n--- END AGGREGATED MEMORY ---`;
  }

  // Build messages array for Claude
  const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...conversationHistory,
    { role: "user", content: message },
  ];

  // Persist the user message to the Living Thread
  await db.insert(nexusMessagesTable).values({ userId, role: "user", content: message });

  // Call Claude
  const aiResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: claudeMessages,
  });

  const rawContent = aiResponse.content[0]?.type === "text" ? aiResponse.content[0].text : "";

  // Strip MEMORY_Tn tags from visible output
  const { content: visibleContent, memoryUpdated } = extractMemoryLines(rawContent);

  // Persist the assistant response to the Living Thread
  await db.insert(nexusMessagesTable).values({ userId, role: "assistant", content: visibleContent });

  res.json({
    response: visibleContent,
    memoryUpdated,
  });
});

export default router;
