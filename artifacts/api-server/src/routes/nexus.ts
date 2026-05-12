import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { db, nexusMessagesTable, projectsTable, entriesTable, sessionsTable } from "@workspace/db";
import { eq, asc, and, inArray, desc, isNull } from "drizzle-orm";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });

const NEXUS_SYSTEM_PROMPT = `You are Atlas — the strategic intelligence layer of Axiom, a platform built for founders running multiple products simultaneously.

This home space is the user's global command center — the place where all their work converges. You have visibility across every project at once. You are NOT inside any single project workspace right now.

--- WHO YOU'RE TALKING TO — READ THIS FIRST ---
Her name is Jochanae. She goes by Jo.

She was raised by her grandmother in Arcadia, Florida — a small town she calls Cow Town. Her grandmother grew everything, shelled peas in bulk, and was determined Jo would leave that town for something bigger. That determination is in her DNA.

She's a flight attendant and veteran. A morning person — up at 4am, does her best thinking before the world wakes up. She prefers the A position when she flies.

She's building five products simultaneously: CoinsBloom, IntoIQ, PresentQ, Compani, and FunnelHub. She's decided FunnelHub is the last new one — after that she grows what she has. She builds everything from her phone. She is a non-developer founder who moves fast and thinks in systems.

She's an observer. She notices people like works of art before she lets them in. Ambivert. Selective. She doesn't warm up fast — but when she does, it's real.

She's a late bloomer financially by her own words, but someone who helps people for real — not for the money.

She has three acres and a frog phobia serious enough that she once slept on her couch for a week. She wants a greenhouse. She wants to grow her own food. Her grandmother's garden is somewhere in that dream.

How to talk to her:
- Call her Jo. Not Jochanae unless she uses it herself.
- She already knows what she's doing. Your job is to sharpen it, not explain it.
- She doesn't need cheerleading. She needs clear thinking.
- When she's processing something out loud, listen and capture — don't rush to advise.
- She moves fast. Match her pace. Short, sharp, useful.
- She's built things before. Treat her like the experienced founder she is.
--- END WHO YOU'RE TALKING TO ---

Your role:
• CEO-level strategic advisor — you see the entire portfolio, not just one product
• Think across all projects at once — connect dots, spot contradictions, find synergies
• Help incubate and pressure-test ideas before they crystallize into decisions
• When a conclusion solidifies, suggest the user log it in a specific project's ledger
• Talk like a sharp co-founder who already knows the person — never like a product introducing itself
• Default to plain flowing sentences. Use markdown (bold, bullets, numbered lists) only when listing components, decisions, or structured breakdowns — not for conversational replies.
• Never say "here's what I'm built for" or "here's how that works" — just answer directly
• Never do a self-introduction or capability tour — if asked what you do, answer in one or two sentences max and immediately turn it back to their work
• Ask one sharp question at a time. Never stack multiple questions.
• Short responses over long ones. If something can be said in two sentences, say it in two sentences.
• Challenge assumptions. Hold the long view.
• Reference specific project names from the aggregated memory when relevant
• CROSS-PROJECT TENSION DETECTION: When the user says something that conflicts with or undermines a committed decision in ANY project, flag it explicitly. Use this format inline in your response: "⚠️ Cross-project tension: [what the user is proposing] conflicts with a committed decision in [Project Name] — '[Decision Title]'. Worth resolving before moving forward." Only flag genuine strategic conflicts, not superficial overlaps.

What you're NOT doing here:
• Writing code or FILE_EDIT blocks
• Focusing on one project to the exclusion of others
• Acting like a task manager or to-do list

Your identity: You are Atlas. Never refer to yourself as "Nexus" or "Nexium" in responses. You are Atlas — the intelligence inside Axiom.

Continuity — CRITICAL RULE:
NEVER say "I don't retain conversation history" or "that context is gone" or "I don't remember our previous sessions." That is a failure response.

When the user asks "where were we," "what were we working on," "catch me up," or any continuity question — you DO have context. Use it:
1. Check the conversation thread above — if messages exist, reference them directly.
2. Check AGGREGATED PROJECT MEMORY — surface what Atlas has learned about their portfolio and working patterns.
3. Check COMMITTED DECISIONS — show what's been locked in across their projects.
4. Synthesize all of it into a confident, specific answer. Lead with what you know, not with what you don't.

If no thread history exists at all, say: "Starting fresh here — but here's what I know about your portfolio:" and then surface the memory and committed decisions. Never leave her empty-handed.

Active listening — CRITICAL:
You are a strategic thinking partner, not just a question-answerer. When the user is thinking out loud, processing, venting, or sharing without asking a direct question — your job is to LISTEN and CAPTURE first, respond second.

- Do not let a message with significant strategic thinking pass without saving it to memory.
- When the user shares something important, briefly reflect it back so she knows you caught it — then respond. One sentence of acknowledgment is enough: "Got it — [what you heard]." Then continue.
- If the user sends a long message with multiple ideas, capture the most durable ones as memory entries before you reply.
- Never make her feel like she's talking to a wall. If she shares something and you don't acknowledge it, you've failed as a listener.

Memory protocol:
When you learn something durable, write it at the END of your response on its own line:

  MEMORY_T1: [core strategic principle or irreversible commitment — never decays]
  MEMORY_T2: [portfolio-level pattern or how the user thinks — 180 days]
  MEMORY_T3: [cross-project insight or major pivot — 90 days]
  MEMORY_T4: [current portfolio state or active cross-project thread — 30 days]
  MEMORY_T5: [passing cross-project thought not yet committed — 7 days]

Save up to 3 MEMORY_Tn lines per response when the user shares significant context. Never save zero when she's told you something that matters.

T2 triggers — always save when:
- The user describes how they think about their portfolio or products
- The user corrects your framing or pushes back
- The user uses "always" or "never" about how they make decisions
- The user reveals a mental model or pattern across multiple projects
- The user describes their working style, constraints, or non-negotiables
- The user thinks out loud about something they've been wrestling with — even if unresolved

T4 triggers — save when:
- The user shares where they are right now on any project — current state, what's blocking them, what they just shipped
- The user shifts direction or changes their mind about something active

Capture the specific thought in plain language — not vague summaries but the actual insight as she would state it.`;

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

function parseRepo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : ((parsed as any).fullName ?? null);
  } catch {
    return raw.includes("/") ? raw : null;
  }
}

// GET /api/nexus/thread — return a conversation thread (optionally scoped by conversationId)
router.get("/nexus/thread", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const conversationId = req.query.conversationId as string | undefined;

  const whereClause = conversationId === "__legacy__"
    ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
    : conversationId
      ? and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId))
      : eq(nexusMessagesTable.userId, userId);

  const messages = await db
    .select()
    .from(nexusMessagesTable)
    .where(whereClause)
    .orderBy(asc(nexusMessagesTable.createdAt));

  res.json(messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  })));
});

// DELETE /api/nexus/thread — clear a conversation (scoped by conversationId, or all if omitted)
router.delete("/nexus/thread", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const conversationId = req.query.conversationId as string | undefined;

  const whereClause = conversationId === "__legacy__"
    ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
    : conversationId
      ? and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId))
      : eq(nexusMessagesTable.userId, userId);

  await db.delete(nexusMessagesTable).where(whereClause);
  res.sendStatus(204);
});

// GET /api/nexus/conversations — list all past conversations, newest first
router.get("/nexus/conversations", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const messages = await db
    .select()
    .from(nexusMessagesTable)
    .where(eq(nexusMessagesTable.userId, userId))
    .orderBy(asc(nexusMessagesTable.createdAt));

  const groups = new Map<string, typeof messages>();
  for (const msg of messages) {
    const key = msg.conversationId ?? "__legacy__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }

  const conversations = Array.from(groups.entries()).map(([key, msgs]) => {
    const firstUserMsg = msgs.find((m) => m.role === "user");
    return {
      conversationId: key === "__legacy__" ? null : key,
      preview: (firstUserMsg?.content ?? "").slice(0, 120),
      messageCount: msgs.length,
      startedAt: msgs[0].createdAt.toISOString(),
      lastMessageAt: msgs[msgs.length - 1].createdAt.toISOString(),
    };
  }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  res.json(conversations);
});

// POST /api/nexus/chat — send a message in Nexus Mode
router.post("/nexus/chat", async (req, res): Promise<void> => {
  const body = req.body as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    userProfile?: string;
    focusProjectId?: number | null;
    mode?: string;
    model?: string;
    imageBase64?: string;
    imageMimeType?: string;
    conversationId?: string;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  // history from the client body is accepted in the schema for API compatibility
  // but ignored server-side — the Living Thread in nexus_messages is authoritative.
  const { message, userProfile = "", focusProjectId = null, mode = "strategic", model = "claude", imageBase64, imageMimeType, conversationId } = body;

  // Load projects + Living Thread in parallel
  const [projects, dbMessages] = await Promise.all([
    db
      .select({ id: projectsTable.id, name: projectsTable.name, memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId)),
    db
      .select()
      .from(nexusMessagesTable)
      .where(
        conversationId === "__legacy__"
          ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
          : conversationId
            ? and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId))
            : eq(nexusMessagesTable.userId, userId)
      )
      .orderBy(asc(nexusMessagesTable.createdAt)),
  ]);

  // Load committed decisions across all projects for cross-project tension detection
  const projectIds = projects.map((p) => p.id);
  const committedEntries = projectIds.length > 0
    ? await db
        .select({ projectId: entriesTable.projectId, title: entriesTable.title, summary: entriesTable.summary })
        .from(entriesTable)
        .where(and(inArray(entriesTable.projectId, projectIds), eq(entriesTable.status, "committed")))
    : [];

  // Group committed entries by project name
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const entriesByProject = new Map<string, string[]>();
  for (const e of committedEntries) {
    const name = projectNameById.get(e.projectId) ?? "Unknown";
    if (!entriesByProject.has(name)) entriesByProject.set(name, []);
    const line = `  • ${e.title}${e.summary ? ` — ${e.summary.slice(0, 100)}` : ""}`;
    entriesByProject.get(name)!.push(line);
  }

  const committedLedger = [...entriesByProject.entries()]
    .map(([name, lines]) => `[${name}]\n${lines.join("\n")}`)
    .join("\n\n");

  // Project roster — always list every project by name so Atlas knows the full portfolio
  const projectRoster = projects.length > 0
    ? projects.map((p) => `• ${p.name}`).join("\n")
    : "(no projects yet)";

  const aggregatedMemory = projects
    .map((p) => {
      const store = parseMemoryStore(p.memory ?? null);
      const memText = buildMemoryText(store);
      if (!memText) return null;
      return `=== ${p.name} ===\n${memText}`;
    })
    .filter(Boolean)
    .join("\n\n");

  // Always source conversation context from the persisted Living Thread (last 40 turns)
  const conversationHistory = dbMessages.slice(-40).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Build system prompt
  let systemPrompt = NEXUS_SYSTEM_PROMPT;
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  // Always inject the full project roster so Atlas knows every room, even empty ones
  systemPrompt += `\n\n--- YOUR PROJECT PORTFOLIO (${projects.length} project${projects.length !== 1 ? "s" : ""}) ---\n${projectRoster}`;
  if (committedLedger) {
    systemPrompt += `\n\n--- COMMITTED DECISIONS ACROSS PORTFOLIO (use for cross-project tension detection) ---\n${committedLedger}\n--- END COMMITTED DECISIONS ---`;
  }
  if (aggregatedMemory) {
    systemPrompt += `\n\n--- AGGREGATED PROJECT MEMORY (Atlas knows this across all projects) ---\n${aggregatedMemory}\n--- END AGGREGATED MEMORY ---`;
  }
  if (focusProjectId) {
    const focusProject = projects.find(p => p.id === focusProjectId);
    if (focusProject) {
      if (focusProject?.linkedRepo) {
        try {
          const repoFull = parseRepo(focusProject.linkedRepo ?? null);
          const ghToken = process.env.GITHUB_TOKEN ?? null;
          if (repoFull && ghToken) {
            const treeResp = await fetch(
              `https://api.github.com/repos/${repoFull}/git/trees/main?recursive=1`,
              {
                headers: {
                  Authorization: `Bearer ${ghToken}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "User-Agent": "Atlas-Nexus/1.0",
                },
                signal: AbortSignal.timeout(6000),
              }
            );
            if (treeResp.ok) {
              const treeData = await treeResp.json() as { tree?: Array<{ type?: string; path?: string }> };
              const filePaths = (treeData.tree ?? [])
                .filter((f: any) => f.type === "blob")
                .map((f: any) => f.path)
                .filter((p: string) => !p.includes("node_modules") && !p.includes(".git"))
                .slice(0, 120)
                .join("\n");
              if (filePaths) {
                systemPrompt += `\n\n--- ${focusProject.name.toUpperCase()} FILE TREE ---\n${filePaths}\n--- END FILE TREE ---`;
              }
            }
          }
        } catch {
          // tree fetch failed silently — continue without it
        }
      }
      const focusEntries = committedEntries
        .filter(e => e.projectId === focusProjectId)
        .map(e => `  • ${e.title}${e.summary ? ` — ${e.summary.slice(0, 120)}` : ""}`)
        .join("\n");
      const focusMemory = (() => {
        const store = parseMemoryStore(focusProject.memory ?? null);
        return buildMemoryText(store);
      })();
      systemPrompt += `\n\n--- FOCUSED PROJECT: ${focusProject.name.toUpperCase()} ---\nThe user has zoomed in on "${focusProject.name}" for this conversation. Prioritize this project's context. Open your FIRST response by explicitly naming the project — begin with "${focusProject.name} —" or "On ${focusProject.name}:" so the user knows the focus is active. After that, answer normally without repeating the label on every message.`;
      if (focusEntries) systemPrompt += `\nCommitted decisions:\n${focusEntries}`;
      if (focusMemory) systemPrompt += `\nProject memory:\n${focusMemory}`;
      systemPrompt += `\n--- END FOCUSED PROJECT ---`;
    }
  }

  // Inject mode-specific instructions
  if (mode === "audit") {
    systemPrompt += `\n\n--- AUDIT MODE ACTIVE ---\nBe direct and critical. Your job right now is to stress-test, not validate. Look for what's fragile, inconsistent, or at risk across the portfolio. Ask hard questions. Flag gaps, weak assumptions, and contradictions without softening. If something looks shaky, say so plainly.\n--- END AUDIT MODE ---`;
  } else if (mode === "deep-dive") {
    systemPrompt += `\n\n--- DEEP DIVE MODE ACTIVE ---\nThe user wants depth, not breadth. Lock onto the specific topic they raise and explore it thoroughly — underlying assumptions, trade-offs, edge cases, second-order implications, what could go wrong, what could go right. Stay focused. Don't jump to other projects unless directly relevant.\n--- END DEEP DIVE MODE ---`;
  }

  // Persist the user message to the Living Thread
  await db.insert(nexusMessagesTable).values({ userId, role: "user", content: message, conversationId: conversationId ?? null });

  // Call the selected model
  let rawContent = "";
  const activeModel = model === "gemini" ? "gemini" : "claude";

  if (activeModel === "gemini") {
    const combinedText = [
      ...conversationHistory.map(m => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`),
      `User: ${message}`,
    ].join("\n\n");
    if (imageBase64 && imageMimeType) {
      const result = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{ role: "user", parts: [{ text: combinedText }, { inlineData: { mimeType: imageMimeType, data: imageBase64 } }] }],
        config: { systemInstruction: systemPrompt },
      });
      rawContent = result.text ?? "";
    } else {
      const result = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: combinedText,
        config: { systemInstruction: systemPrompt },
      });
      rawContent = result.text ?? "";
    }
  } else {
    // Build user content — plain text or vision block when an image is attached
    const userContent: Anthropic.MessageParam["content"] =
      imageBase64 && imageMimeType
        ? [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: imageBase64,
              },
            },
            { type: "text", text: message },
          ]
        : message;
    const claudeMessages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: "user", content: userContent },
    ];
    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: claudeMessages,
    });
    rawContent = aiResponse.content[0]?.type === "text" ? aiResponse.content[0].text : "";
  }

  // Strip MEMORY_Tn tags from visible output
  const { content: visibleContent, memoryUpdated } = extractMemoryLines(rawContent);

  // Detect active mode from Atlas's response
  const lowerContent = visibleContent.toLowerCase();
  const detectedMode: string = (() => {
    const auditSignals = ["broken", "gap", "risk", "fragile", "inconsistent", "conflict", "missing", "dead end", "what's wrong", "fix", "⚠️"];
    const deepSignals = ["let's go deeper", "specifically", "zoom in", "focused on", "only this", "this one"];
    const auditScore = auditSignals.filter(s => lowerContent.includes(s)).length;
    const deepScore = deepSignals.filter(s => lowerContent.includes(s)).length;
    if (auditScore >= 2) return "audit";
    if (deepScore >= 2) return "deep-dive";
    return "strategic";
  })();

  // Detect if Atlas keeps referencing one project and suggest focus
  const projectMentions = projects.map(p => ({
    id: p.id,
    name: p.name,
    count: (lowerContent.match(new RegExp(p.name.toLowerCase(), "g")) ?? []).length
  })).filter(p => p.count >= 2).sort((a, b) => b.count - a.count);

  const focusSuggestion = !focusProjectId && projectMentions.length > 0
    ? { projectId: projectMentions[0].id, projectName: projectMentions[0].name }
    : null;

  // Persist the assistant response to the Living Thread
  await db.insert(nexusMessagesTable).values({ userId, role: "assistant", content: visibleContent, conversationId: conversationId ?? null });

  res.json({
    response: visibleContent,
    memoryUpdated,
    detectedMode,
    focusSuggestion,
  });
});

router.post("/nexus/handoff", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const { messages, projectId } = req.body as {
      messages: { role: string; content: string }[];
      projectId?: number;
    };

    if (!messages?.length) {
      res.status(400).json({ error: "No messages provided" });
      return;
    }

    const briefResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are extracting a project brief from a conversation between a founder and Atlas.

Extract and return ONLY a JSON object with this exact shape — no markdown, no explanation:
{
  "projectName": "short name for the project (max 4 words)",
  "description": "one sentence describing what this project does",
  "blueprint": "2-3 sentences covering what was decided: what to build, key components identified, approach agreed on",
  "firstStep": "the single most important first thing to do in the workspace"
}

If no clear project name was discussed, use "New Project".`,
      messages: [
        {
          role: "user",
          content: `Here is the conversation:\n\n${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}\n\nExtract the project brief.`,
        },
      ],
    });

    const rawText = briefResponse.content[0]?.type === "text" ? briefResponse.content[0].text : "{}";
    let brief: { projectName: string; description: string; blueprint: string; firstStep: string };
    try {
      brief = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      brief = { projectName: "New Project", description: "", blueprint: rawText, firstStep: "" };
    }

    let targetProjectId = projectId;
    if (!targetProjectId) {
      const [newProject] = await db
        .insert(projectsTable)
        .values({ name: brief.projectName, description: brief.description, userId })
        .returning();
      targetProjectId = newProject.id;
    }

    const memoryEntry = {
      v: 2,
      entries: [
        {
          tier: 1,
          text: `Project brief from home conversation: ${brief.blueprint}`,
          createdAt: new Date().toISOString(),
          retrievalCount: 0,
          lastRetrievedAt: null,
        },
        ...(brief.firstStep ? [{
          tier: 4,
          text: `First step: ${brief.firstStep}`,
          createdAt: new Date().toISOString(),
          retrievalCount: 0,
          lastRetrievedAt: null,
        }] : []),
      ],
    };

    await db
      .update(projectsTable)
      .set({ memory: JSON.stringify(memoryEntry) })
      .where(and(eq(projectsTable.id, targetProjectId), eq(projectsTable.userId, userId)));

    res.json({ projectId: targetProjectId, projectName: brief.projectName, brief });
  } catch (err) {
    req.log?.error({ err }, "Handoff error");
    res.status(500).json({ error: "Handoff failed" });
  }
});

router.post("/nexus/briefing", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId));

    if (projects.length === 0) {
      res.json({ briefing: null });
      return;
    }

    const projectIds = projects.map(p => p.id);
    const recentEntries = projectIds.length > 0
      ? await db
          .select({ projectId: entriesTable.projectId, title: entriesTable.title, status: entriesTable.status })
          .from(entriesTable)
          .where(inArray(entriesTable.projectId, projectIds))
          .orderBy(desc(entriesTable.createdAt))
          .limit(10)
      : [];

    const projectNameById = new Map(projects.map(p => [p.id, p.name]));
    const recentActivity = recentEntries
      .map(e => `${projectNameById.get(e.projectId) ?? "Unknown"}: ${e.title} (${e.status})`)
      .join("\n");
    const projectList = projects.map(p => `• ${p.name}`).join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `You are Atlas, a strategic AI partner. Portfolio:\n${projectList}\n\nRecent activity:\n${recentActivity || "No recent activity"}\n\nWrite exactly two sentences. Sentence 1: current state of the portfolio. Sentence 2: one specific next move. Reference real project names. Under 20 words each. No greeting, no labels.`
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : null;
    res.json({ briefing: text });
  } catch (err) {
    req.log?.error({ err }, "Briefing error");
    res.json({ briefing: null });
  }
});

// GET /api/nexus/activity — unified activity feed (commits + decisions + sessions)
router.get("/nexus/activity", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;

  const projects = await db
    .select({ id: projectsTable.id, name: projectsTable.name, linkedRepo: projectsTable.linkedRepo })
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId));

  const projectIds = projects.map(p => p.id);
  if (projectIds.length === 0) { res.json({ items: [] }); return; }

  const projectNameById = new Map(projects.map(p => [p.id, p.name]));

  type ActivityItem = {
    type: "commit" | "decision" | "session";
    projectId: number;
    projectName: string;
    title: string;
    subtitle?: string;
    url?: string;
    sha?: string;
    timestamp: string;
  };

  const items: ActivityItem[] = [];
  const ghToken = process.env.GITHUB_TOKEN ?? null;
  const linkedProjects = projects.filter(p => p.linkedRepo);

  // Fetch commits for all linked repos in parallel (with timeout)
  if (ghToken && linkedProjects.length > 0) {
    const commitResults = await Promise.allSettled(
      linkedProjects.map(async (p) => {
        const repoFull = parseRepo(p.linkedRepo ?? null);
        if (!repoFull) return [];
        const r = await fetch(
          `https://api.github.com/repos/${repoFull}/commits?per_page=6`,
          {
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "Atlas-Activity/1.0",
            },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (!r.ok) return [];
        const data = await r.json() as any[];
        return data.map((c: any): ActivityItem => ({
          type: "commit",
          projectId: p.id,
          projectName: p.name,
          title: ((c.commit?.message ?? "") as string).split("\n")[0].slice(0, 120),
          sha: (c.sha as string)?.slice(0, 7),
          url: c.html_url as string,
          timestamp: c.commit?.author?.date ?? new Date().toISOString(),
        }));
      })
    );
    for (const r of commitResults) {
      if (r.status === "fulfilled") items.push(...r.value);
    }
  }

  // Fetch decisions + sessions from DB in parallel
  const [dbEntries, dbSessions] = await Promise.all([
    db
      .select({ id: entriesTable.id, projectId: entriesTable.projectId, title: entriesTable.title, summary: entriesTable.summary, createdAt: entriesTable.createdAt })
      .from(entriesTable)
      .where(and(inArray(entriesTable.projectId, projectIds), eq(entriesTable.status, "committed")))
      .orderBy(desc(entriesTable.createdAt))
      .limit(30),
    db
      .select({ id: sessionsTable.id, projectId: sessionsTable.projectId, title: sessionsTable.title, messageCount: sessionsTable.messageCount, createdAt: sessionsTable.createdAt })
      .from(sessionsTable)
      .where(inArray(sessionsTable.projectId, projectIds))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(20),
  ]);

  for (const e of dbEntries) {
    items.push({
      type: "decision",
      projectId: e.projectId,
      projectName: projectNameById.get(e.projectId) ?? "Unknown",
      title: e.title,
      subtitle: e.summary ?? undefined,
      timestamp: e.createdAt.toISOString(),
    });
  }
  for (const s of dbSessions) {
    items.push({
      type: "session",
      projectId: s.projectId,
      projectName: projectNameById.get(s.projectId) ?? "Unknown",
      title: s.title,
      subtitle: s.messageCount > 0 ? `${s.messageCount} msg` : undefined,
      timestamp: s.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json({ items: items.slice(0, 40) });
});

export default router;
