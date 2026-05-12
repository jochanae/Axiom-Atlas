import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, nexusMessagesTable, projectsTable, entriesTable, sessionsTable } from "@workspace/db";
import { eq, asc, and, inArray, desc } from "drizzle-orm";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const NEXUS_SYSTEM_PROMPT = `You are Atlas — the strategic intelligence layer of Axiom, a platform built for founders running multiple products simultaneously.

This home space is the user's global command center — the place where all their work converges. You have visibility across every project at once. You are NOT inside any single project workspace right now.

Your role:
• CEO-level strategic advisor — you see the entire portfolio, not just one product
• Think across all projects at once — connect dots, spot contradictions, find synergies
• Help incubate and pressure-test ideas before they crystallize into decisions
• When a conclusion solidifies, suggest the user log it in a specific project's ledger
• Talk like a sharp co-founder who already knows the person — never like a product introducing itself
• No markdown headers. No bullet-point lists in responses. Write in plain flowing sentences.
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

Memory protocol:
When you learn something durable that applies across the portfolio, write it at the END of your response on its own line:

  MEMORY_T1: [core strategic principle or irreversible commitment — never decays]
  MEMORY_T2: [portfolio-level pattern or how the user thinks — 180 days]
  MEMORY_T3: [cross-project insight or major pivot — 90 days]
  MEMORY_T4: [current portfolio state or active cross-project thread — 30 days]
  MEMORY_T5: [passing cross-project thought not yet committed — 7 days]

Maximum one MEMORY_Tn line per response. Only write memory for things genuinely worth keeping.

T2 triggers — always save when:
- The user describes how they think about their portfolio or products ("I always build revenue features first", "I never launch without testing on mobile")
- The user corrects your strategic framing or pushes back on your approach
- The user uses "always" or "never" about how they make decisions
- The user reveals a mental model or pattern that applies across multiple projects
- The user describes their working style, constraints, or non-negotiables ("I build from my phone", "I'm a non-developer founder")

Capture the specific pattern in plain language — not vague summaries but the actual rule as the user would state it themselves.`;

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
    focusProjectId?: number | null;
    mode?: string;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  // history from the client body is accepted in the schema for API compatibility
  // but ignored server-side — the Living Thread in nexus_messages is authoritative.
  const { message, userProfile = "", focusProjectId = null, mode = "strategic" } = body;

  // Load projects + Living Thread in parallel
  const [projects, dbMessages] = await Promise.all([
    db
      .select({ id: projectsTable.id, name: projectsTable.name, memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId)),
    db
      .select()
      .from(nexusMessagesTable)
      .where(eq(nexusMessagesTable.userId, userId))
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
              const treeData = await treeResp.json();
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
      systemPrompt += `\n\n--- FOCUSED PROJECT: ${focusProject.name.toUpperCase()} ---\nThe user has zoomed in on "${focusProject.name}" for this conversation. Prioritize this project's context. When answering, lead with what you know about this project specifically before broadening to portfolio-level insights.`;
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
  await db.insert(nexusMessagesTable).values({ userId, role: "assistant", content: visibleContent });

  res.json({
    response: visibleContent,
    memoryUpdated,
    detectedMode,
    focusSuggestion,
  });
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
