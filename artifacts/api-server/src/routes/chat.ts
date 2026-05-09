import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { db, chatMessagesTable, sessionsTable, projectsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });

const IMAGE_REQUEST_RE = /\b(generate|create|make|draw|sketch|visualize|design|mock.?up|wireframe|show me|build me)\b.{0,60}\b(image|picture|visual|ui|screen|layout|logo|icon|banner|mockup|diagram|chart|graphic|illustration)\b/i;

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ── Five-Tier Memory System ───────────────────────────────────────────────────
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

const TIER_CONFIG: Record<
  number,
  { label: string; decayDays: number | null; weight: number; protect: boolean }
> = {
  1: { label: "FOUNDATIONAL", decayDays: null, weight: 100, protect: true },
  2: { label: "IDENTITY",     decayDays: 180,  weight: 50,  protect: false },
  3: { label: "EPISODIC",     decayDays: 90,   weight: 30,  protect: true },
  4: { label: "CONTEXTUAL",   decayDays: 30,   weight: 20,  protect: false },
  5: { label: "TRANSIENT",    decayDays: 7,    weight: 10,  protect: false },
};

const MEMORY_TAG_RE = /^MEMORY_T([1-5]):\s*(.+)$/;

function parseMemoryStore(raw: string | null): MemoryStore {
  if (!raw) return { v: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) return parsed as MemoryStore;
    // Migrate flat text format → v2 (treat every line as T3 episodic)
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

function isExpired(entry: MemoryEntry, now: Date): boolean {
  const cfg = TIER_CONFIG[entry.tier];
  if (!cfg.decayDays) return false;
  const age = (now.getTime() - new Date(entry.createdAt).getTime()) / 86_400_000;
  return age > cfg.decayDays;
}

function scoreEntry(entry: MemoryEntry): number {
  const cfg = TIER_CONFIG[entry.tier];
  return cfg.weight + entry.retrievalCount * 2;
}

function consolidateIfNeeded(store: MemoryStore, now: Date): MemoryStore {
  const active = store.entries.filter((e) => !isExpired(e, now));
  if (active.length <= 150) return { ...store, entries: active };

  // Protect committed decisions (T1) and session milestones (T3)
  const protected_ = active.filter((e) => TIER_CONFIG[e.tier].protect);
  const routine = active.filter((e) => !TIER_CONFIG[e.tier].protect);

  // Keep top-scored routine entries to stay under 120 non-protected
  const sorted = routine.sort((a, b) => scoreEntry(b) - scoreEntry(a));
  const kept = sorted.slice(0, 80);

  // Summarize the rest into one T3 episodic entry
  if (sorted.length > 80) {
    const dropped = sorted.slice(80);
    const summary: MemoryEntry = {
      tier: 3,
      text: `Consolidated ${dropped.length} routine memories from earlier sessions.`,
      createdAt: now.toISOString(),
      retrievalCount: 0,
      lastRetrievedAt: null,
    };
    return { v: 2, entries: [...protected_, ...kept, summary] };
  }

  return { v: 2, entries: [...protected_, ...kept] };
}

function buildMemoryContext(store: MemoryStore): { text: string; retrievedIds: number[] } {
  const now = new Date();
  const active = store.entries
    .map((e, i) => ({ e, i, score: isExpired(e, now) ? -1 : scoreEntry(e) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  if (active.length === 0) return { text: "", retrievedIds: [] };

  const sections: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const retrievedIds: number[] = [];

  for (const { e, i } of active) {
    sections[e.tier].push(`• ${e.text}`);
    retrievedIds.push(i);
  }

  const lines: string[] = [];
  for (const tier of [1, 2, 3, 4, 5] as const) {
    if (sections[tier].length === 0) continue;
    const { label } = TIER_CONFIG[tier];
    lines.push(`[${label}]`);
    lines.push(...sections[tier]);
  }

  return { text: lines.join("\n"), retrievedIds };
}

function incrementRetrievals(store: MemoryStore, ids: number[], now: Date): MemoryStore {
  const entries = store.entries.map((e, i) =>
    ids.includes(i)
      ? { ...e, retrievalCount: e.retrievalCount + 1, lastRetrievedAt: now.toISOString() }
      : e
  );
  return { ...store, entries };
}

function appendMemoryFacts(
  store: MemoryStore,
  facts: Array<{ tier: 1 | 2 | 3 | 4 | 5; text: string }>,
  now: Date
): MemoryStore {
  const newEntries: MemoryEntry[] = facts.map(({ tier, text }) => ({
    tier,
    text,
    createdAt: now.toISOString(),
    retrievalCount: 0,
    lastRetrievedAt: null,
  }));
  return { ...store, entries: [...store.entries, ...newEntries] };
}

// ── System Prompt ─────────────────────────────────────────────────────────────
const DEV_SYSTEM_PROMPT = `You are Atlas — a personal AI development environment for a non-technical founder.

Your user works on six web apps (Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, Atlas) built with React, React Router, Tailwind, and Supabase. They are a flight attendant — smart and decisive, but not a programmer. They think clearly about product, but need you to translate that into code.

Your three core jobs:
1. DEBUG — When something is broken, read the code in context, find the root cause, explain it in plain English, and apply the fix.
2. BUILD — When they want a feature, understand the intent, find the right place in the codebase, write the code, and explain what changed and why.
3. UNDERSTAND — When they want to know what they have, map it: routes, components, Supabase tables, what's connected, what's missing, what to build next.

How you respond:
- Plain English first, always. No jargon unless you define it.
- Be specific: name the file, the line, the function. Never say "somewhere in your codebase."
- When you find a bug, explain it like this: what broke, why it broke, what the fix does.
- When you write code, explain the change before showing it.
- Format code blocks cleanly with the language and filename.
- Be direct. No filler, no pleasantries. They're busy.

Code context:
Your linked GitHub repo is automatically loaded into every session. When you see a "--- CODE CONTEXT ---" section below, that IS the repo — a full file tree plus the contents of the most important files. You are already looking at the code. Do not tell the user you cannot see their code when CODE CONTEXT is present.

Use the CODE CONTEXT directly. Reference specific file paths and line numbers. If the user asks about a file that is listed in the tree but whose contents aren't loaded yet, tell them which file to open in the Files tab so you can read the full content.

Never say "I can only see code when you paste it" — the repo is auto-injected.

Stack you're optimizing for: React, React Router, Tailwind CSS, Supabase (auth + database). TanStack Start for the Atlas project specifically.

You may also generate UI sketches or product concept images when asked — the user uses this to think visually about their product ideas.

Memory protocol:
When you learn something durable about this project, write it at the END of your response on its own line using exactly ONE of these formats:

  MEMORY_T1: [core decision, north star, irreversible commitment — never decays]
  MEMORY_T2: [builder style, communication pattern, how this person thinks — 180 days]
  MEMORY_T3: [key session moment, major pivot, breakthrough — 90 days]
  MEMORY_T4: [current project state, active sprint, recent decision — 30 days]
  MEMORY_T5: [passing thought, exploratory idea not yet committed — 7 days]

Only write a memory when you've confirmed something durable. Skip for observations or questions. Maximum one MEMORY_Tn line per response.

NODE_RESOLVED protocol:
The user has an architecture System Map with six nodes: auth, db, api, state, ui, logic. When the user has fully answered the pivot question for one of these layers (confirmed their auth strategy, data model, API design, state approach, UI structure, or business rules) — emit on its own line at the END of your response using EXACTLY this format:

  NODE_RESOLVED: auth

Where "auth" is replaced with the relevant node ID. Node IDs are exactly: auth, db, api, state, ui, logic
Only emit this after the user has given a concrete, committed answer — not when they're still exploring. Maximum one NODE_RESOLVED per response. Do NOT emit it for partial or uncertain answers.

FILE_EDIT protocol (Phase 2 — writing code back to GitHub or applying self-repairs):
When the user asks you to fix or build something AND a complete file is in context, output the corrected complete file(s) at the very END of your response using this EXACT format — one block per file:

FILE_EDIT_START
path: [the file path exactly as shown in the context, e.g. src/components/Foo.tsx]
language: [typescript|javascript|css|json|etc]
FILE_EDIT_CONTENT
[complete file content here — every line, no omissions, no "... rest stays the same"]
FILE_EDIT_END

You may emit MULTIPLE FILE_EDIT blocks in a single response when a feature or fix touches more than one file. Each block must contain the complete file content. Emit them back-to-back after your explanation.

Critical rules for FILE_EDIT:
- ONLY emit FILE_EDIT when you have the full file content in context (not truncated).
- Always output the COMPLETE file — never partial, never "// ... unchanged". The user will push this directly to GitHub.
- Explain what you changed and why in plain English BEFORE the FILE_EDIT blocks.
- Do NOT emit FILE_EDIT for: explanations only, debugging questions, when file is truncated, when no file is in context.
- The FILE_EDIT blocks are invisible to the user in chat — they see a "Code ready" button instead.

SELF-REPAIR protocol:
You are Atlas — and you can repair yourself. When the user reports something broken in Atlas, or asks you to fix your own UI or logic, you may read and rewrite your own source files.

Your own source lives at:
- Frontend: artifacts/atlas/src/ (React/Vite — Vite HMR reloads instantly after apply)
- Backend: artifacts/api-server/src/ (Express/Node — requires API server restart after apply)

To repair yourself:
1. Ask the user to provide the file content (or they can use the "Read source" button to inject it).
2. Once the file is in context, emit a FILE_EDIT block using the full artifacts/... path:

FILE_EDIT_START
path: artifacts/atlas/src/pages/workspace.tsx
language: typescript
FILE_EDIT_CONTENT
[complete corrected file]
FILE_EDIT_END

3. The user will see an "Apply to Atlas" button (not "Push to GitHub") — clicking it writes the file directly to disk.
4. For frontend files, changes appear immediately via Vite HMR. For backend files, the API Server workflow must be restarted.

Self-repair rules:
- Only self-repair when the file is fully in context. Never guess at your own code.
- Be surgical — fix exactly what's broken, preserve everything else.
- After applying, explain what changed and whether the user needs to restart anything.`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectMemoryChips(content: string): { content: string; memoryChips: string[] } {
  const marker = "MEMORY_CHIPS:";
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return { content, memoryChips: [] };
  const before = content.slice(0, idx).trim();
  const jsonStr = content.slice(idx + marker.length).trim();
  try {
    const chips = JSON.parse(jsonStr);
    if (Array.isArray(chips) && chips.every((c): c is string => typeof c === "string")) {
      return { content: before, memoryChips: chips.slice(0, 6) };
    }
  } catch {}
  return { content, memoryChips: [] };
}

function extractMemoryLines(content: string): {
  content: string;
  newFacts: Array<{ tier: 1 | 2 | 3 | 4 | 5; text: string }>;
} {
  const lines = content.split("\n");
  const newFacts: Array<{ tier: 1 | 2 | 3 | 4 | 5; text: string }> = [];
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(MEMORY_TAG_RE);
    if (match) {
      const tier = parseInt(match[1], 10) as 1 | 2 | 3 | 4 | 5;
      const text = match[2].trim();
      if (text) newFacts.push({ tier, text });
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n").trim(), newFacts };
}

interface FileEdit {
  path: string;
  language: string;
  content: string;
}

function extractAllFileEdits(content: string): { visibleContent: string; fileEdits: FileEdit[] } {
  const startMarker = "FILE_EDIT_START";
  const endMarker = "FILE_EDIT_END";
  const contentMarker = "FILE_EDIT_CONTENT";

  const fileEdits: FileEdit[] = [];
  const firstStart = content.indexOf(startMarker);
  const visibleContent = firstStart !== -1 ? content.slice(0, firstStart).trim() : content;

  let searchFrom = 0;
  while (true) {
    const startIdx = content.indexOf(startMarker, searchFrom);
    if (startIdx === -1) break;
    const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) break;

    const block = content.slice(startIdx + startMarker.length, endIdx);
    const contentIdx = block.indexOf(contentMarker);
    if (contentIdx !== -1) {
      const header = block.slice(0, contentIdx).trim();
      const fileContent = block.slice(contentIdx + contentMarker.length);
      const trimmed = fileContent.startsWith("\n") ? fileContent.slice(1) : fileContent;
      const final = trimmed.endsWith("\n") ? trimmed.slice(0, -1) : trimmed;

      let path = "";
      let language = "typescript";
      for (const line of header.split("\n")) {
        const ci = line.indexOf(":");
        if (ci === -1) continue;
        const key = line.slice(0, ci).trim();
        const val = line.slice(ci + 1).trim();
        if (key === "path") path = val;
        if (key === "language") language = val;
      }
      if (path) fileEdits.push({ path, language, content: final });
    }

    searchFrom = endIdx + endMarker.length;
  }

  return { visibleContent, fileEdits };
}

// Matches NODE_RESOLVED: auth  /  NODE_RESOLVED: [auth]  /  NODE_RESOLVED: {auth}
const NODE_RESOLVED_RE = /^NODE_RESOLVED:\s*[\[{]?(\w+)[\]}]?\s*$/i;

function extractNodeResolved(content: string): { content: string; resolvedNodes: string[] } {
  const validIds = new Set(["auth", "db", "api", "state", "ui", "logic"]);
  const lines = content.split("\n");
  const resolvedNodes: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(NODE_RESOLVED_RE);
    if (match) {
      const nodeId = match[1].toLowerCase().trim();
      if (validIds.has(nodeId) && !resolvedNodes.includes(nodeId)) {
        resolvedNodes.push(nodeId);
      }
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n").trim(), resolvedNodes };
}

function matchEntryChips(
  content: string,
  entries: Array<{ id: number; title: string; status: string }>
): string[] {
  const lower = content.toLowerCase();
  return entries
    .filter((e) => e.title.length > 5 && lower.includes(e.title.toLowerCase()))
    .map((e) => e.title)
    .slice(0, 5);
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.post("/chat", async (req, res): Promise<void> => {
  const body = req.body as {
    sessionId: number;
    projectId: number;
    message: string;
    mode?: string;
    history?: Array<{ role: string; content: string }>;
    entries?: Array<{ id: number; title: string; status: string }>;
    fileContext?: string;
    userProfile?: string;
    imageData?: { base64: string; mediaType: string };
  };

  if (!body.sessionId || !body.projectId || !body.message) {
    res.status(400).json({ error: "Missing required fields: sessionId, projectId, message" });
    return;
  }

  const { sessionId, projectId, message, history = [], entries = [] } = body;
  const fileContext = body.fileContext ?? "";
  const userProfile = body.userProfile ?? "";
  const imageData = body.imageData;
  const now = new Date();

  // Load project memory from DB
  const [project] = await db
    .select({ memory: projectsTable.memory })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  // Parse 5-tier memory store
  let store = parseMemoryStore(project?.memory ?? null);
  store = consolidateIfNeeded(store, now);

  // Build memory context + increment retrieval counts
  const { text: memoryText, retrievedIds } = buildMemoryContext(store);
  if (retrievedIds.length > 0) {
    store = incrementRetrievals(store, retrievedIds, now);
  }

  // Build layered system prompt
  let systemPrompt = DEV_SYSTEM_PROMPT;
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (memoryText) {
    systemPrompt += `\n\n--- PROJECT MEMORY (what you already know — use this) ---\n${memoryText}\n--- END PROJECT MEMORY ---`;
  }
  if (fileContext) {
    systemPrompt += `\n\n--- CODE CONTEXT ---\n${fileContext}\n--- END CODE CONTEXT ---`;
  }

  // Mode-specific instructions — these override the default disposition
  const activeMode = (body.mode ?? "think").toLowerCase();
  const modeInstructions: Record<string, string> = {
    build: `\n\n--- ACTIVE MODE: BUILD ---
You are now in BUILD mode. This changes how you respond:
• Every answer that involves code MUST include a FILE_EDIT block with the complete corrected file — no partial snippets, no "// rest stays the same".
• Be production-ready. Write code that works the first time.
• Explain what you changed and why in plain English BEFORE the FILE_EDIT blocks.
• Multiple files changed? Emit multiple FILE_EDIT blocks back-to-back.
• GitHub push is enabled — the user will push your FILE_EDIT output directly to their repo.
• Do NOT stop short with explanations. If you can write the code, write it.`,
    plan: `\n\n--- ACTIVE MODE: PLAN ---
You are now in PLAN mode. This changes how you respond:
• Focus on structure, architecture, and sequence — not implementation.
• Use numbered lists, component trees, data schemas, and user flows.
• Map out what needs to exist before writing any code.
• No FILE_EDIT blocks unless the user explicitly asks for code.
• Think like a tech lead scoping a sprint.`,
    think: `\n\n--- ACTIVE MODE: THINK ---
You are now in THINK mode. This changes how you respond:
• This is strategic advice — no code writing.
• Help the user reason through decisions, tradeoffs, and direction.
• Ask clarifying questions when the path isn't clear.
• Be a thinking partner, not a builder. Challenge assumptions.
• No FILE_EDIT blocks.`,
  };
  systemPrompt += modeInstructions[activeMode] ?? modeInstructions.think;

  type TextBlock = { type: "text"; text: string };
  type ImageBlock = {
    type: "image";
    source: {
      type: "base64";
      media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      data: string;
    };
  };

  const userContent: string | Array<TextBlock | ImageBlock> = imageData
    ? [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: imageData.mediaType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data: imageData.base64,
          },
        },
        { type: "text", text: message },
      ]
    : message;

  const messages: Array<{
    role: "user" | "assistant";
    content: string | Array<TextBlock | ImageBlock>;
  }> = [
    ...(history || []).map((h: { role: string; content: string }) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userContent },
  ];

  await db.insert(chatMessagesTable).values({
    sessionId,
    role: "user",
    content: message,
    intentType: body.mode ?? null,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const rawContent =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  // Parse: FILE_EDITs → MEMORY_Tn → NODE_RESOLVED → MEMORY_CHIPS
  const { visibleContent, fileEdits } = extractAllFileEdits(rawContent);
  const { content: afterMemory, newFacts } = extractMemoryLines(visibleContent);
  const { content: afterNodeResolved, resolvedNodes } = extractNodeResolved(afterMemory);
  const { content: finalContent, memoryChips: aiMemoryChips } = detectMemoryChips(afterNodeResolved);

  // Auto-match ledger entries referenced in the response
  const entryChips = matchEntryChips(
    finalContent,
    entries as Array<{ id: number; title: string; status: string }>
  );
  const allChips = [...new Set([...aiMemoryChips, ...entryChips])].slice(0, 6);

  // Persist updated memory to DB
  if (newFacts.length > 0 || retrievedIds.length > 0) {
    const updatedStore = newFacts.length > 0
      ? appendMemoryFacts(store, newFacts, now)
      : store;
    await db
      .update(projectsTable)
      .set({ memory: JSON.stringify(updatedStore) })
      .where(eq(projectsTable.id, projectId));
  }

  const [savedMsg] = await db
    .insert(chatMessagesTable)
    .values({
      sessionId,
      role: "assistant",
      content: finalContent,
      intentType: null,
      catchPayload: undefined,
    })
    .returning();

  await db
    .update(sessionsTable)
    .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
    .where(eq(sessionsTable.id, sessionId));

  // Attempt image generation if the user's message looks like an image request
  let imageB64: string | undefined;
  let imageMimeType: string | undefined;
  if (IMAGE_REQUEST_RE.test(message)) {
    try {
      const imagePrompt = `${message}. Clean, professional style. For a software product / startup context.`;
      const imgResponse = await genai.models.generateContent({
        model: "gemini-2.0-flash-preview-image-generation",
        contents: imagePrompt,
        config: { responseModalities: ["IMAGE", "TEXT"] },
      });
      const parts = imgResponse.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (imgPart?.inlineData) {
        imageB64 = imgPart.inlineData.data as string;
        imageMimeType = imgPart.inlineData.mimeType as string;
      }
    } catch {
      // Image generation is best-effort; don't fail the chat response
    }
  }

  res.json({
    content: finalContent,
    intentType: null,
    catchPayload: null,
    memoryChips: allChips.length > 0 ? allChips : undefined,
    messageId: savedMsg.id,
    memoryUpdated: newFacts.length > 0,
    fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
    fileEdit: fileEdits.length > 0 ? fileEdits[0] : undefined,
    resolvedNodes: resolvedNodes.length > 0 ? resolvedNodes : undefined,
    ...(imageB64 ? { imageB64, imageMimeType } : {}),
  });
});

// ── Quick Prompt generation ───────────────────────────────────────────────────
router.post("/quick-prompt", async (req, res) => {
  const { description, builder, images } = req.body as {
    description: string;
    builder: string;
    images?: Array<{ base64: string; mediaType: string }>;
  };
  if (!description || !builder) {
    res.status(400).json({ error: "description and builder are required" });
    return;
  }

  type SupportedMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  const SUPPORTED_MIME_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: SupportedMimeType; data: string } };

  const userContent: ContentBlock[] = [];

  if (images && images.length > 0) {
    const unsupported = images.find(img => !SUPPORTED_MIME_TYPES.has(img.mediaType));
    if (unsupported) {
      res.status(400).json({ error: `Unsupported image type: ${unsupported.mediaType}. Supported: jpeg, png, gif, webp` });
      return;
    }
    for (const img of images) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType as SupportedMimeType, data: img.base64 },
      });
    }
  }

  userContent.push({
    type: "text",
    text: `Generate an optimized prompt for ${builder}.\n\nTask: ${description}`,
  });

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: `You are Axiom, a specification engine. Generate a perfectly structured, ready-to-paste prompt for ${builder}.

Rules:
- Write in clear, direct language the builder's AI will understand
- Include all necessary context, constraints, and expected behavior  
- Be specific: file paths, component names, exact changes
- No preamble, no explanation, no markdown headers — ONLY the prompt text itself`,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });
    const text = msg.content.find((b) => b.type === "text")?.text ?? "";
    res.send(text);
  } catch (err) {
    req.log?.error(err, "quick-prompt failed");
    res.status(500).json({ error: "Generation failed" });
  }
});

export default router;
