import { Router, type IRouter, type Response } from "express";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { atlasErrorLogsTable, atlasSelfMapTable, db, chatMessagesTable, sessionsTable, projectsTable, secretsTable, entriesTable, connectionsTable, usersTable, generationRuns, generatedFiles, imageVersionsTable } from "@workspace/db";
import { eq, sql, and, gte, desc, ne, isNotNull } from "drizzle-orm";
import { decryptToken } from "../lib/tokenCrypto";
import { loadVaultContext } from "../lib/vaultContext";
import { extractPageUrls, screenshotUrlsToBlocks, buildUrlNote } from "../lib/urlScreenshot";
import { calculateModelCostUsd } from "../pricing";
import { logger } from "../lib/logger";
import {
  evaluateTerminalRequest,
  executeTerminalCommand,
  parseTerminalTier,
  type TerminalTier,
} from "../lib/terminalExecution";
import { prepareProjectRepo } from "../lib/terminalSandbox";
import { ATLAS_PLATFORM_KNOWLEDGE } from "../lib/atlasKnowledge";
import { ATLAS_IDENTITY } from "../lib/atlasIdentity";
import { runBuildCheck } from "./devserver";

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });
const MAX_VAULT_B64_SIZE = 1500000;

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_REQUEST_RE = /\b(sketch|draw|render|paint|illustrate)\b|\b(generate|create|make|show me|visualize|mock.?up|wireframe)\b.{0,80}\b(image|picture|visual|ui|screen|layout|logo|icon|banner|mockup|diagram|chart|graphic|illustration|what.{0,20}look)\b/i;

const router: IRouter = Router();

// Detects when user is asking a portfolio-wide question from inside a workspace
const PORTFOLIO_INTENT_RE = /\b(all\s+(my\s+)?(projects?|apps?|products?|work)|entire\s+portfolio|whole\s+portfolio|across\s+(all|everything|my)|portfolio(\s+view)?|everything\s+i('m|\s+am)\s+building|my\s+other\s+projects?|how\s+(do\s+)?they\s+(all\s+)?compare|prioriti[sz]e\s+(across|all)|big\s+picture|30[,\s]?000\s+foot|zoomed?\s+out)\b/i;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function resolveStoredGithubToken(storedToken: string | null | undefined): string | null {
  const plain = storedToken ? decryptToken(storedToken) : null;
  return plain && plain !== "__server__" ? plain : null;
}

async function getAccountGithubToken(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;

  const [connection] = await db
    .select({ token: connectionsTable.token })
    .from(connectionsTable)
    .where(and(
      eq(connectionsTable.userId, userId),
      eq(connectionsTable.type, "github"),
      isNotNull(connectionsTable.token)
    ))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  return resolveStoredGithubToken(connection?.token);
}

async function resolveGithubTokenForRequest(
  userId: number | undefined,
  projectGithubToken: string | null | undefined
): Promise<string | null> {
  const accountToken = await getAccountGithubToken(userId);
  if (accountToken) return accountToken;

  return resolveStoredGithubToken(projectGithubToken) ?? process.env.GITHUB_TOKEN ?? null;
}

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

const USER_MEMORY_EXTRACTOR_PROMPT = `You are a silent memory extractor. Extract ONLY durable facts the USER explicitly stated about THEMSELVES — their identity, role, how they work, their own products, their own constraints, their life.

CRITICAL RULE — CURRENT PROJECT ONLY:
You are extracting memories for ONE specific project. NEVER record facts about a different project, even if the user mentions it. If the user discusses "Compani" while working on "Untangle The Pattern", do NOT record anything about Compani — it belongs to a different project and would pollute the current project's memory.

STRICT RULES:
- Record a technology, framework, or tool ONLY if the user clearly states THEY use it in THEIR OWN project. If a technology is merely mentioned, discussed, or read from code belonging to another project or example, DO NOT record it as a fact about the user.
- When a fact is about a specific product, name that product in the fact text (e.g. 'Compani uses Supabase'), NEVER as a blanket fact about the user (NEVER 'the user's stack is Supabase'). Different products may use different stacks.
- Do not infer or generalize across projects. One project using something does not mean the user 'always' uses it.
- Skip greetings, task talk, transient conversation, and anything about the current code being discussed.
- NEVER cross-pollinate: a fact about Project A must never appear in Project B's memory.
Return ONLY a JSON array, each item {"tier":1-5,"text":"concise standalone fact"}. Tier guide: 1=foundational/never changes, 2=identity/slow-changing (role, products, how they work), 3=episodic, 4=contextual (current focus), 5=transient. If nothing durable, return [].`;

function cleanPollutedUserStackFacts(store: MemoryStore): { store: MemoryStore; removedCount: number } {
  const productNames = ["compani", "coinsbloom", "intoiq", "sanctumiq", "quinn", "presentq"];
  const blanketStackPatterns = [
    /\byour\s+(?:overall\s+)?stack\s+(?:is|uses|includes)\b/i,
    /\b(?:the\s+)?user['’]s\s+(?:overall\s+)?stack\s+(?:is|uses|includes)\b/i,
    /\btheir\s+(?:overall\s+)?stack\s+(?:is|uses|includes)\b/i,
    /\bfully committed to\b/i,
    /\breact\s*\+\s*tailwind\s*\+\s*supabase\b/i,
  ];

  const entries = store.entries.filter((entry) => {
    const text = entry.text;
    const lowerText = text.toLowerCase();
    if (lowerText.includes("tailwind")) return false;
    if (lowerText.includes("supabase") && !productNames.some((product) => lowerText.includes(product))) {
      return false;
    }
    return !blanketStackPatterns.some((pattern) => pattern.test(text));
  });

  return { store: { ...store, entries }, removedCount: store.entries.length - entries.length };
}

function parseExtractorFacts(raw: string): Array<{ tier: 1 | 2 | 3 | 4 | 5; text: string }> {
  const parsed = JSON.parse(raw.trim()) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tier = (item as { tier?: unknown }).tier;
    const text = (item as { text?: unknown }).text;
    if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4 && tier !== 5) return [];
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ tier, text: text.trim() }];
  });
}

async function extractUserMemoryInBackground({
  userId,
  history,
  message,
  assistantReply,
}: {
  userId: number;
  history: Array<{ role: string; content: string }>;
  message: string;
  assistantReply: string;
}): Promise<void> {
  const recentExchange = [
    ...history.slice(-4).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: message },
    { role: "assistant", content: assistantReply },
  ];
  const transcript = recentExchange
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: USER_MEMORY_EXTRACTOR_PROMPT,
    messages: [{ role: "user", content: `Conversation:\n${transcript}` }],
  });
  const raw = response.content.find((block) => block.type === "text")?.text ?? "[]";
  const extractedFacts = parseExtractorFacts(raw);
  if (extractedFacts.length === 0) return;

  const [user] = await db
    .select({ memory: (usersTable as any).memory })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  let userStore = parseMemoryStore(user?.memory ?? null);
  const existingTexts = new Set(userStore.entries.map((entry) => entry.text.trim().toLowerCase()));
  const factsToAppend = extractedFacts.filter((fact) => {
    const key = fact.text.trim().toLowerCase();
    if (existingTexts.has(key)) return false;
    existingTexts.add(key);
    return true;
  });
  if (factsToAppend.length === 0) return;

  const now = new Date();
  userStore = appendMemoryFacts(userStore, factsToAppend, now);
  userStore = consolidateIfNeeded(userStore, now);

  await db
    .update(usersTable)
    .set({ memory: JSON.stringify(userStore) })
    .where(eq(usersTable.id, userId));
}

// ── GitHub File Tree Helper ───────────────────────────────────────────────────
const GH_API = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Atlas-Dev-Env/1.0",
  };
}

interface RepoTreeSnapshot {
  context: string;
  files: Set<string>;
}

async function fetchRepoTree(fullName: string, token: string, branch = "main"): Promise<RepoTreeSnapshot | null> {
  try {
    let resp = await fetch(`${GH_API}/repos/${fullName}/git/trees/${branch}?recursive=1`, { headers: ghHeaders(token) });
    if (!resp.ok && branch === "main") {
      resp = await fetch(`${GH_API}/repos/${fullName}/git/trees/master?recursive=1`, { headers: ghHeaders(token) });
    }
    if (!resp.ok) return null;
    const data = await resp.json() as { tree?: Array<{ path: string; type: string }>; truncated?: boolean };
    if (!data.tree) return null;

    // Filter to only blob (file) paths, skip node_modules and lock files
    const ignore = /node_modules|\.next|dist\/|\.lock$|\.log$|\.map$|\.min\./;
    const files = data.tree
      .filter(f => f.type === "blob" && !ignore.test(f.path))
      .map(f => `  ${f.path}`)
      .slice(0, 300); // cap at 300 files to keep context manageable

    return {
      context: `${fullName} (${files.length} files${data.truncated ? ", truncated" : ""}):\n${files.join("\n")}`,
      files: new Set(data.tree.filter(f => f.type === "blob").map(f => normalizeRepoPath(f.path))),
    };
  } catch {
    return null;
  }
}

function formatCommitAge(timestamp: string, now: Date): string {
  const elapsedMs = now.getTime() - new Date(timestamp).getTime();
  const hours = Math.max(0, Math.floor(elapsedMs / (60 * 60 * 1000)));
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function fetchRecentRepoActivity(fullName: string, token: string, now = new Date()): Promise<string | null> {
  try {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const url = new URL(`${GH_API}/repos/${fullName}/commits`);
    url.searchParams.set("per_page", "5");

    const resp = await fetch(url, { headers: ghHeaders(token) });
    if (!resp.ok) return null;

    const data = await resp.json() as Array<{
      sha?: string;
      commit?: {
        message?: string;
        author?: { name?: string; date?: string | null } | null;
        committer?: { name?: string; date?: string | null } | null;
      };
    }>;

    const lines = data
      .map((commit) => {
        const timestamp = commit.commit?.author?.date ?? commit.commit?.committer?.date;
        if (!commit.sha || !timestamp) return null;
        const committedAt = new Date(timestamp);
        if (Number.isNaN(committedAt.getTime()) || committedAt < since) return null;
        const message = (commit.commit?.message ?? "").split("\n")[0]?.trim();
        if (!message) return null;
        const author = commit.commit?.author?.name ?? commit.commit?.committer?.name ?? "Unknown";
        return `${commit.sha.slice(0, 7)} ${message} — ${author}, ${formatCommitAge(timestamp, now)}`;
      })
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return null;
    return `--- RECENT REPO ACTIVITY ---\n${lines.join("\n")}\n--- END RECENT REPO ACTIVITY ---`;
  } catch {
    return null;
  }
}

// ── Intent Type Parser ────────────────────────────────────────────────────────
const INTENT_TYPE_RE = /^INTENT_TYPE:\s*(BUILD|PLAN|THINK|EXPLORE|DECIDE|DEBUG|AUDIT)\s*$/im;

function extractIntentType(content: string): { content: string; intentType: string | null } {
  const match = content.match(INTENT_TYPE_RE);
  if (!match) return { content, intentType: null };
  const intentType = match[1];
  const cleaned = content.replace(INTENT_TYPE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { content: cleaned, intentType };
}

type ChatTerminalCommand = {
  command: string;
  tier: TerminalTier;
  reason?: string;
};

type ChatTerminalResult = {
  command: string;
  output: string;
  exitCode: number | null;
  tier: TerminalTier;
};

const TERMINAL_CMD_RE = /(?:^|\n)\s*TERMINAL_CMD:\s*(\{[^\n]*\})\s*/g;
const TERMINAL_RESULT_RE = /(?:^|\n)\s*TERMINAL_RESULT:\s*(\{[^\n]*\})\s*/g;

function cleanTerminalTags(content: string): string {
  return content
    .replace(TERMINAL_CMD_RE, "\n")
    .replace(TERMINAL_RESULT_RE, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTerminalCommand(content: string): {
  content: string;
  terminalCmd: { command: string; tier?: TerminalTier } | null;
} {
  let terminalCmd: { command: string; tier?: TerminalTier } | null = null;
  const cleaned = content.replace(TERMINAL_CMD_RE, (_match, json: string) => {
    if (!terminalCmd) {
      try {
        const parsed = JSON.parse(json) as { command?: unknown; tier?: unknown };
        const command = typeof parsed.command === "string" ? parsed.command.trim() : "";
        if (command) terminalCmd = { command, tier: parseTerminalTier(parsed.tier) };
      } catch {
        // Malformed hidden command blocks are stripped, not shown to the user.
      }
    }
    return "\n";
  });

  return {
    content: cleanTerminalTags(cleaned),
    terminalCmd,
  };
}

async function runChatTerminalCommand(
  requested: { command: string; tier?: TerminalTier },
  projectId?: number,
  userId?: number
): Promise<{ terminalCmd: ChatTerminalCommand; terminalResult: ChatTerminalResult | null }> {
  const evaluation = evaluateTerminalRequest(requested.command, requested.tier);
  const resolvedTier: TerminalTier = evaluation.tier === "blocked"
    ? requested.tier ?? 3
    : evaluation.tier;
  const terminalCmd: ChatTerminalCommand = {
    command: requested.command,
    tier: resolvedTier,
    reason: evaluation.reason,
  };

  if (evaluation.tier === "blocked" || evaluation.requiresConfirmation) {
    return { terminalCmd, terminalResult: null };
  }

  let cwd: string | undefined;
  if (projectId && userId) {
    try {
      const { sandboxDir } = await prepareProjectRepo(projectId, userId);
      cwd = sandboxDir;
    } catch (err) {
      logger.error({ err, projectId, userId }, "prepareProjectRepo failed in runChatTerminalCommand");
    }
  } else {
    logger.warn({ projectId, userId }, "runChatTerminalCommand called without projectId or userId");
  }

  const result = await executeTerminalCommand(requested.command, {
    onStart: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onProcess: () => {},
  }, { cwd });

  return {
    terminalCmd,
    terminalResult: {
      command: requested.command,
      output: result.output,
      exitCode: result.exitCode,
      tier: resolvedTier,
    },
  };
}

// ── System Prompt ─────────────────────────────────────────────────────────────
const DEV_SYSTEM_PROMPT = `${ATLAS_IDENTITY}

Your user is a non-technical founder who builds products from her phone. She thinks clearly about product. Your job is to translate that into code. Be direct. Be specific. Name the file, the line, the function. Never say "somewhere in your codebase."

Workspace-specific response rules:
- When you find a bug: what broke, why it broke, what the fix does.
- When you write code, explain the change before showing it.
- Format code blocks cleanly with the language and filename.

When you need information from the user before you can proceed, do NOT bury the questions in prose. Emit a clarification block and nothing else after it:
CLARIFY_START
{
  "steps": [
    {
      "question": "Short, direct question.",
      "options": ["Option one", "Option two", "Option three"],
      "allowFreeText": true
    }
  ]
}
CLARIFY_END
Rules: 1 to 3 steps maximum. Each step: 2 to 4 options, each option under ~60 characters. Only emit this when you genuinely cannot proceed without the answer — one sharp question is better than three. Never emit a clarification block AND a workspace/surface card in the same reply.

ROUTING RULE — IMAGE_GEN vs ARTIFACT:
If the user asks to "generate an image," "show me a picture," "render," "visualize," "sketch," "mockup," or "what does X look like" — they want an actual generated image (a photo or graphic), NOT code. Use IMAGE_GEN, never ARTIFACT, for these requests — even if you could technically build an SVG or HTML representation instead. ARTIFACT is reserved for code files the user will use in their project: components, pages, configs, scripts. A request for "an image of a red circle" means call IMAGE_GEN with a render of a red circle — it does not mean build an HTML file containing an SVG circle.

ARTIFACT PROTOCOL — MANDATORY FOR STANDALONE FILES:
When you generate a complete, standalone file (HTML page, CSS file, JavaScript module, React component, JSON config, etc.) that the user can use directly, you MUST emit it using this exact format on its own line:

ARTIFACT: {"type":"html","title":"Page Title","content":"<full file content here>"}

Valid types: "html", "css", "js", "jsx", "ts", "tsx", "json", "md", "text"
The content field must be the complete file as a single escaped JSON string.
Do NOT wrap standalone files in markdown code blocks — use ARTIFACT instead.
Only use markdown code blocks for inline code snippets or partial examples.
After emitting an ARTIFACT block, always follow it with a short message like: "I've sent this to your sandbox — tap PREVIEW to see it live."

RESPONSE DISPOSITION — DEFAULT:
By default, Atlas is a thinking partner first. Unless the active lens (BUILD or LOOK) or mode (build or plan) explicitly calls for code, do not write FILE_EDIT blocks or produce implementation code unprompted — but do write code if the user explicitly asks for it. Help the user reason through decisions, tradeoffs, and direction. Ask sharp clarifying questions when the path is unclear. Challenge assumptions.

One hard exception: visual generation via IMAGE_GEN is always available, in every mode and every lens. Generating an image, sketch, or mockup is an act of thinking — it is not "building" and is never suppressed by this disposition or by any lens framing. Emit IMAGE_GEN whenever the user asks for a visual or when proactive generation fits.

--- EPISTEMIC SPINE (non-negotiable) ---
- Distinguish what you REMEMBER from what you have VERIFIED. Memory is 'what I have on you,' never 'what I checked' or 'what I can see.' Never claim to have inspected infrastructure, repos, or deployments you did not actually inspect in this turn.
- State confidence honestly. If a fact is from memory and unconfirmed, say so plainly. Do not present a generalization as a universal.
- VOLUNTEER the inconvenient exception. If you know something is true for most of the user's projects but not the one in focus, lead with the exception — it is the useful half.
- Do NOT reverse a factual claim merely because the user asserts otherwise. If the user contradicts you, either hold your position with your reasoning, or say 'I'm not certain — I shouldn't have stated that so firmly' and offer to verify. Never flip to instant agreement to please the user. Agreeing when you were right, or when you have no basis to change, is a failure.
- When you don't know, say you don't know. A confident wrong answer is worse than an honest 'I'm not sure.'
--- END EPISTEMIC SPINE ---

## Your actual tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite — repo: jochanae/atlas-idk, deployed to Vercel at axiomsystem.app |
| Backend | Express 5 — runs from this Replit |
| Database | Neon PostgreSQL via Drizzle ORM |
| Auth | Session auth + Google OAuth |
| AI | Anthropic Claude claude-sonnet-4-6 |

## FILE_EDIT protocol

When the user asks you to fix, build, or create something, output the complete file(s) at the very END of your response:

FILE_EDIT_START
path: [the file path]
language: [typescript|javascript|css|json|etc]
FILE_EDIT_CONTENT
[complete file content — every line, no omissions]
FILE_EDIT_END

Critical rules:
- For EXISTING files: only emit when you have the FULL file in context. Never guess.
- For NEW files: write the complete file from scratch.
- Always output the COMPLETE file — never partial, never "// ... unchanged".
- Explain what you're building and why BEFORE the FILE_EDIT blocks.
- Do NOT emit FILE_EDIT for explanations or debugging questions.

PATH RULES — never edit:
- package.json, pnpm-workspace.yaml, any config file, node_modules, build output

LINE_PATCH (for large existing files):
When you need a small change in a large file and you have that section:

LINE_PATCH_START
path: src/components/Foo.tsx
LINE_PATCH_FIND
[exact existing code — 3-5 lines for context]
LINE_PATCH_REPLACE
[new code]
LINE_PATCH_END

The FIND block must match EXACTLY. Copy it directly from the code in context.

FILE_READ:
When you need a file not in context, ask at the end of your response:
FILE_READ_REQUEST:{"paths":["src/components/Foo.tsx"]}
Max 3 paths. Use exact paths from the file tree.

## Images — Seeing and Generating

**You CAN see images.** When the user attaches a screenshot, photo, mockup, or any image to their message, you receive it and can analyze it, describe it, reference it, and reason about it. Do this naturally — describe what you see, react to it, use it to answer the question.

If the user says "look at this" or "here's a screenshot" but no image is actually in this message, respond like a person: "I don't see an attachment — can you drop it in using the attachment icon?" Never say "I can't see images" or "only text and code." That is inaccurate and unhelpful.

**Generating images — External Service:** An image generation service (Gemini) is connected to this backend. You do NOT generate images yourself — you trigger the service by emitting a special token, and the backend calls Gemini to produce the image and returns it to the user.

When the user asks you to sketch, draw, render, visualize, mockup, or "show me what X looks like" — your job is simple: write a good prompt and emit the IMAGE_GEN token. The service handles the rest. You are the prompt author, not the image generator.

TOKEN FORMAT — emit on its own line at the END of your response:
IMAGE_GEN:{"prompt":"[detailed description of what to generate]","mode":"render","size":"square"}

- mode "render" → photorealistic visuals, UI mockups, app screens, product concepts, creative work
- mode "schematic" → architecture diagrams, technical flows, wireframes, structural maps
- size "landscape" for wide layouts, "portrait" for mobile/vertical, "square" for general
- Pack detail into the prompt: style, colors, layout, mood, context
- After the token, write one short sentence acknowledging what you asked the service to generate

PROACTIVE USE: When the conversation is about how something should look, feel, or appear — emit IMAGE_GEN without being asked. A sketch is worth a thousand words of description.

DO NOT emit IMAGE_GEN for: pure code questions, database/backend logic, deployment, or anything with no visual component.

## Browser Agent — Atlas Can See the Web

You can visit any URL: screenshot it, scrape its content, or check if it's healthy. Use this to do competitor research, visual QA on a live app, or check what a page actually looks like.

Emit a BROWSER_VISIT token at the END of your response when you want to visit a URL:

BROWSER_VISIT:{"url":"https://example.com","mode":"screenshot"}
BROWSER_VISIT:{"url":"https://example.com","mode":"scrape"}
BROWSER_VISIT:{"url":"https://example.com","mode":"health"}
BROWSER_VISIT:{"url":"https://example.com","mode":"monitor"}

- mode "screenshot" — takes a screenshot and gives you an AI visual description. Use when the user wants to SEE a page, do visual QA, or check what a deployed app looks like.
- mode "scrape" — fetches the page content and gives you a strategic AI summary. Use for competitor research, product analysis, or reading any public page.
- mode "health" — HTTP status + screenshot + visual AI assessment. Use after a deploy to check if the live app is rendering correctly.
- mode "monitor" — live error capture: checks for JS console errors, failed resource loads (404 JS/CSS bundles), framework crash patterns (React error boundaries, Next.js crash overlay, Vite error overlay, ChunkLoadError), and uncaught exception handlers. Returns structured { consoleErrors[], resourceErrors[], errorPatterns[], summary }. Use when the user says "is my app broken?", "check for errors", or after a deploy to catch runtime issues the screenshot might miss.

RULES:
- Only emit BROWSER_VISIT when you actually have a URL to visit (user provided it, or it's the deployed app URL).
- One BROWSER_VISIT per response. The result appears immediately after your message.
- Never say "I'll visit that" and then not emit the token. Just emit it.
- After deploy confirmation (when you see [FILE_COMMITTED]) for non-StackBlitz projects, emit BROWSER_VISIT with the live URL and mode "monitor" to catch runtime errors automatically. For StackBlitz projects the build check runs server-side and appears as [BUILD_VERIFY] — you do not need to emit BROWSER_VISIT.
- For competitor research ("how does X work?", "what does their pricing look like?", "compare us to X", "what does Y charge?"), emit BROWSER_VISIT with mode "scrape". If the user mentions a product or company by name and you know its URL, use it — don't ask for the URL.
- For "is my app broken?" / "check for errors", use mode "monitor". For "show me what it looks like", use mode "screenshot".
- Users can also type /research <url> to trigger scrape directly — that's handled separately, no BROWSER_VISIT token needed for those.

You are Atlas. Just be it.`;

const FOUNDATION_SYSTEM_PROMPT = `${ATLAS_IDENTITY}

Your user is building products from her phone — entirely on her own, non-technical by training but sharp on product. Right now she is in the Foundation view: the wide lens across the entire portfolio.

From here you see everything at once. You are not inside any single workspace — you think portfolios, not files. You connect dots she hasn't connected, surface contradictions she hasn't named, find synergies she hasn't seen.

You cannot read code files or push to GitHub from here — that lives in individual workspaces. But you can see every project, every committed decision, every cross-project pattern.

When the user wants to go to a specific project workspace, end your response with exactly:
NAVIGATE_TO:{"route":"/project/<id>"}

When she commits a decision, says "lock that in" — call POST /api/entries with a committed decision.
When she says "park that" — call POST /api/entries with a parked item.

When you learn something durable, write it at the END of your response on its own line:
MEMORY_T1: [core principle — never decays]
MEMORY_T2: [pattern or how she thinks — 180 days]
MEMORY_T3: [insight or pivot — 90 days]
MEMORY_T4: [current state — 30 days]
MEMORY_T5: [passing thought — 7 days]

Save up to 3 MEMORY_Tn lines per response when she shares something significant.

You are Atlas. Just be it.`;

// ── Helpers ───────────────────────────────────────────────────────────────────
export type MemoryChipRich = { label: string; insight?: string };

type SurfaceType = "MAP" | "WORKSPACE" | "DECISION";

type SurfaceSignal = {
  type: SurfaceType;
  reason: string;
  label: string;
};

type SurfaceMessage = {
  role: string;
  content: string;
};

type SurfaceScores = {
  words: number;
  sentences: number;
  bullets: number;
  numberedSteps: number;
  decision: number;
  decisionAnchors: number;
  workspace: number;
  workspaceAnchors: number;
  map: number;
  mapAnchors: number;
  concernCount: number;
};

const SURFACE_CONCERN_PATTERNS = [
  /\b(user|customer|audience|client|market|personas?)\b/,
  /\b(product|feature|scope|mvp|experience|ux|workflow)\b/,
  /\b(engineering|technical|code|api|database|auth|state|frontend|backend|infrastructure)\b/,
  /\b(risk|constraint|cost|quality|security|privacy|timeline|trade-?off)\b/,
  /\b(revenue|pricing|business|strategy|growth|retention|positioning)\b/,
];

function normalizeSurfaceText(value: string): string {
  return value.toLowerCase().replace(/[\u2019']/g, "'").replace(/\s+/g, " ").trim();
}

function countSurfaceMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
}

function countSurfaceLines(content: string, pattern: RegExp): number {
  return content.split("\n").filter((line) => pattern.test(line.trim())).length;
}

function scoreSurfaceText(content: string): SurfaceScores {
  const text = normalizeSurfaceText(content);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const sentences = content.split(/[.!?]+/).filter((part) => part.trim().length > 8).length;
  const bullets = countSurfaceLines(content, /^[-*\u2022]\s+\S/);
  const numberedSteps = countSurfaceLines(content, /^\d+[.)]\s+\S/);
  const structuralLines = bullets + numberedSteps;
  const concernCount = SURFACE_CONCERN_PATTERNS.filter((pattern) => pattern.test(text)).length;

  const decisionAnchors = countSurfaceMatches(text, [
    /\bwe should\b/g,
    /\bthe right move is\b/g,
    /\bthis is the direction\b/g,
    /\bcommit(?:ting)? to\b/g,
    /\block (?:it|this|that) in\b/g,
    /\bgo with\b/g,
    /\bmy call is\b/g,
    /\bthe choice is\b/g,
    /\bsettle(?:d| on)\b/g,
    /\bthat's decided\b/g,
  ]);
  const conclusionMarkers = countSurfaceMatches(text, [
    /\bbottom line\b/g,
    /\btherefore\b/g,
    /\bso the answer is\b/g,
    /\bwhat this means is\b/g,
    /\bthe direction\b/g,
    /\brecommend(?:ation)?\b/g,
  ]);
  const hedges = countSurfaceMatches(text, [
    /\bmaybe\b/g,
    /\bmight\b/g,
    /\bcould be\b/g,
    /\bprobably\b/g,
    /\bnot sure\b/g,
    /\bdepends\b/g,
  ]);
  const decision = (decisionAnchors * 2) + conclusionMarkers + (hedges === 0 && decisionAnchors > 0 ? 1 : 0);

  const workspaceAnchors = countSurfaceMatches(text, [
    /\bready to build\b/g,
    /\bnext steps?\b/g,
    /\bimplementation plan\b/g,
    /\bwe can build\b/g,
    /\bi(?:'ll| will) (?:build|implement|wire|add|update|fix|create)\b/g,
    /\blet's (?:build|implement|ship|wire|structure)\b/g,
    /\bstructure this\b/g,
    /\bworking space\b/g,
  ]);
  const operationalVerbs = countSurfaceMatches(text, [
    /\b(build|implement|ship|wire|create|add|update|fix|refactor|test|deploy|run|push)\b/g,
  ]);
  const executionStructure = countSurfaceMatches(text, [
    /\b(first|second|third|then|after that|step)\b/g,
    /\b(file|route|endpoint|component|schema|migration|handler)\b/g,
  ]);
  const workspace = (workspaceAnchors * 2) + Math.min(operationalVerbs, 4) + executionStructure + structuralLines;

  const mapAnchors = countSurfaceMatches(text, [
    /\btension\b/g,
    /\btrade-?off\b/g,
    /\bcompeting\b/g,
    /\bconflict(?:ing)?\b/g,
    /\bconstraint\b/g,
    /\binterconnected\b/g,
    /\bmoving parts\b/g,
    /\brelationship between\b/g,
    /\bdepends on\b/g,
    /\bmap\b/g,
  ]);
  const complexitySignals = countSurfaceMatches(text, [
    /\bon one hand\b/g,
    /\bon the other hand\b/g,
    /\bbut\b/g,
    /\bhowever\b/g,
    /\bmeanwhile\b/g,
    /\bat the same time\b/g,
    /\barchitecture\b/g,
    /\bsystem\b/g,
    /\blayers?\b/g,
    /\bdependencies\b/g,
  ]);
  const map = (mapAnchors * 2) + complexitySignals + concernCount + (structuralLines >= 2 ? 2 : 0);

  return {
    words,
    sentences,
    bullets,
    numberedSteps,
    decision,
    decisionAnchors,
    workspace,
    workspaceAnchors,
    map,
    mapAnchors,
    concernCount,
  };
}

function classifySurfaceSignal(content: string): SurfaceSignal | null {
  const scores = scoreSurfaceText(content);
  const hasSubstance = scores.words >= 28
    || scores.sentences >= 3
    || (scores.bullets + scores.numberedSteps) >= 2
    || (scores.decisionAnchors > 0 && scores.words >= 16)
    || (scores.workspaceAnchors >= 2 && scores.words >= 12);
  if (!hasSubstance) return null;

  // DECISION surface removed — fired too aggressively (e.g. "want me to build these?" triggering PARK/COMMIT)
  // Real decision logging should be user-initiated, not auto-triggered by AI response content.

  if (scores.workspaceAnchors > 0 && scores.workspace >= 5 && (scores.words >= 24 || scores.numberedSteps > 0)) {
    return { type: "WORKSPACE", reason: "operational shift", label: "Working space prepared" };
  }

  // MAP surface removed — it navigated users away from the conversation mid-flow (confusing)

  return null;
}

function materialSurfaceShift(userMessage: string, type: SurfaceType): boolean {
  const scores = scoreSurfaceText(userMessage);
  if (type === "DECISION") return scores.decisionAnchors > 0 || scores.decision >= 3;
  if (type === "WORKSPACE") return scores.workspaceAnchors > 0 || scores.workspace >= 4;
  return scores.mapAnchors > 0 || (scores.words >= 40 && scores.concernCount >= 2);
}

function detectSurfaceSignal(args: {
  content: string;
  userMessage: string;
  recentMessages?: SurfaceMessage[];
}): SurfaceSignal | null {
  const surface = classifySurfaceSignal(args.content);
  if (!surface) return null;

  const previousAssistant = [...(args.recentMessages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);
  if (previousAssistant) {
    const previousSurface = classifySurfaceSignal(previousAssistant.content);
    if (previousSurface?.type === surface.type && !materialSurfaceShift(args.userMessage, surface.type)) {
      return null;
    }
  }

  return surface;
}

/** Extract a FILE_READ_REQUEST from Atlas's response, returning paths + cleaned content */
function extractFileReadRequest(content: string): { paths: string[]; cleanedContent: string } {
  const marker = "FILE_READ_REQUEST:";
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return { paths: [], cleanedContent: content };
  const jsonStr = content.slice(idx + marker.length).trim().split("\n")[0]?.trim() ?? "";
  const cleanedContent = content.slice(0, idx).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.paths)) {
      const paths = (parsed.paths as unknown[])
        .filter((p): p is string => typeof p === "string")
        .slice(0, 3);
      return { paths, cleanedContent };
    }
  } catch { /* malformed JSON — ignore */ }
  return { paths: [], cleanedContent: content };
}

function detectMemoryChips(content: string): { content: string; memoryChips: MemoryChipRich[] } {
  const marker = "MEMORY_CHIPS:";
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return { content, memoryChips: [] };
  const before = content.slice(0, idx).trim();
  const jsonStr = content.slice(idx + marker.length).trim();
  try {
    const chips = JSON.parse(jsonStr);
    if (Array.isArray(chips)) {
      const normalized: MemoryChipRich[] = chips.slice(0, 6).map((c) => {
        if (typeof c === "string") return { label: c };
        if (c && typeof c === "object" && typeof c.label === "string") {
          return {
            label: c.label,
            insight: typeof c.insight === "string" ? c.insight : undefined,
          };
        }
        return { label: String(c) };
      });
      return { content: before, memoryChips: normalized };
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

type RunStatus = "completed" | "warnings" | "failed" | "cancelled";

type RunAction = {
  verb: string;
  target?: string;
  detail?: string;
  status?: "ok" | "warn" | "fail";
};

type RunArtifact = {
  type: "commit" | "file" | "url" | "pr";
  label: string;
  href?: string;
  meta?: string;
};

const BLOCKED_PATH_RE = /(?:^|[\\/])(?:package\.json|pnpm-workspace\.yaml|(?:vite|tsconfig|drizzle|jest|vitest|eslint|prettier|babel|webpack|rollup|postcss)\.config\.[a-z]+|\.env[.\w]*)$/i;
const BLOCKED_DIR_RE = /^(?:node_modules|dist|build|\.next|\.cache)[\\/]/;
const CRITICAL_PATH_RE = /(?:^|[\\/])(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml|(?:vite|tsconfig|drizzle|jest|vitest|eslint|prettier|babel|webpack|rollup|postcss)\.config\.[a-z]+|\.env[.\w]*)$/i;
const CRITICAL_DIR_RE = /(?:^|[\\/])(?:auth|security|payments?|billing|migrations?)(?:[\\/]|$)/i;

function normalizeRepoPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function isCriticalPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return CRITICAL_PATH_RE.test(normalized) || CRITICAL_DIR_RE.test(normalized);
}

function fileExistsInRepo(path: string, repoFiles: Set<string> | null): boolean {
  return repoFiles?.has(normalizeRepoPath(path)) ?? false;
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
      // Block forbidden paths silently — don't surface them to the user
      if (path && !BLOCKED_PATH_RE.test(path) && !BLOCKED_DIR_RE.test(path)) {
        fileEdits.push({ path, language, content: final });
      }
    }

    searchFrom = endIdx + endMarker.length;
  }

  return { visibleContent, fileEdits };
}

function countContentLines(content: string): number {
  return content.split("\n").length;
}

function inferGeneratedFileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  return "text";
}

function stripContextSeparator(content: string): string {
  let normalized = content.startsWith("\n") ? content.slice(1) : content;
  if (normalized.endsWith("\n\n")) normalized = normalized.slice(0, -2);
  else if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
  return normalized;
}

function extractPreviousContentByPath(context: string): Map<string, string> {
  const previous = new Map<string, string>();
  if (!context.trim()) return previous;

  const sectionHeaderRe = /^===\s+(.+?)(?:\s+(?:\[[^\]]+\]|\([^)]*\)))?\s+===$/gm;
  const sections: Array<{ path: string; start: number; end: number; truncated: boolean }> = [];
  let match: RegExpExecArray | null;
  while ((match = sectionHeaderRe.exec(context)) !== null) {
    sections.push({
      path: normalizeRepoPath(match[1]),
      start: match.index,
      end: sectionHeaderRe.lastIndex,
      truncated: /truncated|\bfirst\s+\d+\s+of\b/i.test(match[0]),
    });
  }

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section.path || section.truncated) continue;
    const nextStart = sections[i + 1]?.start ?? context.length;
    const content = stripContextSeparator(context.slice(section.end, nextStart));
    if (/\n(?:…|\.\.\.) \(truncated\)\s*$/i.test(content)) continue;
    previous.set(section.path, content);
  }

  const fileBlockRe = /^File:\s+(.+?)(?:\s+\([^)]*\))?\n```[^\n]*\n([\s\S]*?)\n```/gm;
  while ((match = fileBlockRe.exec(context)) !== null) {
    const path = normalizeRepoPath(match[1]);
    if (path) previous.set(path, match[2]);
  }

  return previous;
}

function addKnownPreviousContent(
  previousContentByPath: Map<string, string>,
  file: { path: string; content: string; truncated?: boolean }
): void {
  if (file.truncated) return;
  const path = normalizeRepoPath(file.path);
  if (path) previousContentByPath.set(path, file.content);
}

function lookupPreviousContent(previousContentByPath: Map<string, string>, path: string): string | null {
  return previousContentByPath.get(normalizeRepoPath(path)) ?? null;
}

async function recordGenerationRunInBackground({
  projectId,
  userId,
  prompt,
  model,
  startedAt,
  fileEdits,
  previousContentByPath,
}: {
  projectId: unknown;
  userId: unknown;
  prompt: string;
  model: string | null | undefined;
  startedAt: Date | null;
  fileEdits: FileEdit[];
  previousContentByPath: Map<string, string>;
}): Promise<void> {
  try {
    if (fileEdits.length === 0) return;
    const numericProjectId = Number(projectId);
    if (!Number.isInteger(numericProjectId) || numericProjectId <= 0) return;
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) return;

    const runId = crypto.randomUUID();
    const finishedAt = new Date();
    const knownStartedAt = startedAt ?? null;
    const generationFiles = fileEdits.map((fileEdit) => {
      const previousContent = lookupPreviousContent(previousContentByPath, fileEdit.path);
      return {
        fileEdit,
        previousContent,
        lines: countContentLines(fileEdit.content),
        previousLines: previousContent === null ? 0 : countContentLines(previousContent),
      };
    });

    await db.insert(generationRuns).values({
      id: runId,
      projectId: numericProjectId,
      userId: numericUserId,
      prompt: prompt.slice(0, 2000),
      intent: "build",
      model: model || "claude-sonnet-4-6",
      status: "completed",
      startedAt: knownStartedAt ?? finishedAt,
      finishedAt,
      durationMs: knownStartedAt ? Math.max(0, finishedAt.getTime() - knownStartedAt.getTime()) : null,
      filesChanged: generationFiles.length,
      linesAdded: generationFiles.reduce((sum, file) => sum + file.lines, 0),
      linesRemoved: generationFiles.reduce((sum, file) => sum + file.previousLines, 0),
      summary: `Edited ${generationFiles.length} file${generationFiles.length === 1 ? "" : "s"}`,
      commitSha: null,
      pushedToBranch: null,
    });

    await db.insert(generatedFiles).values(
      generationFiles.map(({ fileEdit, previousContent, lines }) => {
        const timestamp = new Date();
        return {
          id: crypto.randomUUID(),
          runId,
          path: fileEdit.path,
          language: inferGeneratedFileLanguage(fileEdit.path),
          bytes: Buffer.byteLength(fileEdit.content, "utf8"),
          lines,
          content: fileEdit.content,
          previousContent,
          status: previousContent === null ? "created" : "edited",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      })
    );
  } catch (err) {
    logger.warn({ err, projectId, userId }, "failed to record generation run");
  }
}

// ── LINE_PATCH extraction ─────────────────────────────────────────────────────
interface LinePatch {
  path: string;
  find: string;
  replace: string;
}

interface ConfidenceAssessment {
  confidence: "high" | "medium" | "low";
  files_affected: string[];
  blast_radius: "isolated" | "moderate" | "wide";
  reasoning: string;
}

type PlanStepType = "analysis" | "edit" | "push" | "read" | "other";
type Moscow = "must" | "should" | "could" | "wont";

interface ResponsePlan {
  title: string;
  mode?: "plan" | "blueprint";
  steps: Array<{
    order: number;
    description: string;
    type: PlanStepType;
    file?: string;
    moscow?: Moscow;
  }>;
  confidence: "high" | "medium" | "low";
  estimatedChanges: number;
  reversible: boolean;
}

function extractAllLinePatches(content: string): { visibleContent: string; linePatches: LinePatch[] } {
  const startMarker = "LINE_PATCH_START";
  const findMarker = "LINE_PATCH_FIND";
  const replaceMarker = "LINE_PATCH_REPLACE";
  const endMarker = "LINE_PATCH_END";

  const linePatches: LinePatch[] = [];
  const firstStart = content.indexOf(startMarker);
  const visibleContent = firstStart !== -1 ? content.slice(0, firstStart).trim() : content;

  let searchFrom = 0;
  while (true) {
    const startIdx = content.indexOf(startMarker, searchFrom);
    if (startIdx === -1) break;
    const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) break;

    const block = content.slice(startIdx + startMarker.length, endIdx);
    const findIdx = block.indexOf(findMarker);
    const replaceIdx = block.indexOf(replaceMarker);

    if (findIdx !== -1 && replaceIdx !== -1 && replaceIdx > findIdx) {
      const header = block.slice(0, findIdx).trim();
      let path = "";
      for (const line of header.split("\n")) {
        const ci = line.indexOf(":");
        if (ci === -1) continue;
        const key = line.slice(0, ci).trim();
        const val = line.slice(ci + 1).trim();
        if (key === "path") { path = val; break; }
      }
      const findContent = block.slice(findIdx + findMarker.length, replaceIdx).trim();
      const replaceContent = block.slice(replaceIdx + replaceMarker.length).trim();
      if (path && findContent) {
        linePatches.push({ path, find: findContent, replace: replaceContent });
      }
    }
    searchFrom = endIdx + endMarker.length;
  }

  return { visibleContent, linePatches };
}

function extractConfidenceAssessment(content: string): ConfidenceAssessment | null {
  const match = content.match(/CONFIDENCE_ASSESSMENT:\s*(\{[^\n]+\})/);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]) as Partial<ConfidenceAssessment>;
    const confidence = parsed.confidence;
    const blastRadius = parsed.blast_radius;
    const validConfidence = confidence === "high" || confidence === "medium" || confidence === "low";
    const validBlastRadius = blastRadius === "isolated" || blastRadius === "moderate" || blastRadius === "wide";
    if (!validConfidence || !validBlastRadius || !Array.isArray(parsed.files_affected) || typeof parsed.reasoning !== "string") {
      return null;
    }
    return {
      confidence,
      files_affected: parsed.files_affected.filter((file): file is string => typeof file === "string"),
      blast_radius: blastRadius,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

function normalizeConfidenceAssessmentForFileChanges(args: {
  assessment: ConfidenceAssessment | null;
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
  repoFiles: Set<string> | null;
}): ConfidenceAssessment | null {
  if (args.fileEdits.length === 0 || args.linePatches.length > 0 || !args.repoFiles) {
    return args.assessment;
  }

  const allFileEditsCreateNewFiles = args.fileEdits.every((edit) => !fileExistsInRepo(edit.path, args.repoFiles));
  if (!allFileEditsCreateNewFiles) {
    return args.assessment;
  }

  return {
    confidence: "high",
    files_affected: args.assessment?.files_affected.length
      ? args.assessment.files_affected
      : args.fileEdits.map((edit) => edit.path),
    blast_radius: "isolated",
    reasoning: args.assessment?.reasoning || "Only creates new files that do not exist yet.",
  };
}

function hasExistingCriticalFileChange(args: {
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
  repoFiles: Set<string> | null;
}): boolean {
  const paths = [
    ...args.fileEdits.map((edit) => edit.path),
    ...args.linePatches.map((patch) => patch.path),
  ];

  return paths.some((path) => {
    if (!isCriticalPath(path)) return false;
    // Without a repo tree, keep critical paths behind approval instead of
    // assuming they are safe new files.
    return !args.repoFiles || fileExistsInRepo(path, args.repoFiles);
  });
}

function canProceedWithFileChanges(args: {
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
  repoFiles: Set<string> | null;
}): boolean {
  return !hasExistingCriticalFileChange(args);
}

const PLAN_PHRASE_RE = /\b(here'?s the plan|here'?s what i(?:'ll| will) do|plan:|steps:|i(?:'ll| will):)\b/i;
const NUMBERED_PLAN_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const BULLET_PLAN_RE = /^\s*[-*•]\s+(.+)$/;
const PLAN_ACTION_RE = /\b(add|apply|build|change|check|commit|create|edit|fetch|fix|implement|inspect|move|patch|push|read|refactor|remove|review|run|scan|test|update|wire)\b/i;
const PLAN_FILE_RE = /(?:[\w.-]+\/)+(?:[\w.-]+\.\w+)|\b[\w.-]+\.(?:tsx?|jsx?|css|scss|json|mdx?|html|py|go|rs|sql|ya?ml)\b/;

function cleanPlanDescription(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;]\s*$/, "");
}

function classifyPlanStep(value: string): PlanStepType {
  if (/\b(push|commit|pull request|pr|github)\b/i.test(value)) return "push";
  if (/\b(edit|change|update|patch|write|implement|create|remove|refactor|fix)\b/i.test(value)) return "edit";
  if (/\b(read|inspect|scan|review|look at|fetch)\b/i.test(value)) return "read";
  if (/\b(analy[sz]e|compare|decide|map|plan|identify|confirm|check)\b/i.test(value)) return "analysis";
  return "other";
}

function classifyMoscow(args: {
  description: string;
  type: PlanStepType;
  file?: string;
  coreFiles: Set<string>;
}): Moscow {
  const text = args.description;
  if (/\b(won't|wont|will not|out of scope|skip|not doing|defer)\b/i.test(text)) return "wont";
  if (/\b(optional|nice to have|could|later|if needed|stretch)\b/i.test(text)) return "could";
  if (args.file && args.coreFiles.has(args.file)) return "must";
  if (args.type === "edit") return "must";
  if (args.type === "read" || args.type === "analysis") return "should";
  return "should";
}

function extractPlanFile(value: string): string | undefined {
  return value.match(PLAN_FILE_RE)?.[0];
}

function planTitleFromContent(content: string, steps: ResponsePlan["steps"]): string {
  const heading = content.split("\n").find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  if (heading) return cleanPlanDescription(heading).slice(0, 110);

  const phraseLine = content.split("\n").find((line) => PLAN_PHRASE_RE.test(line));
  if (phraseLine) {
    const afterColon = phraseLine.includes(":") ? phraseLine.split(":").slice(1).join(":").trim() : "";
    const cleaned = cleanPlanDescription(afterColon || phraseLine);
    if (cleaned.length > 12 && !PLAN_PHRASE_RE.test(cleaned)) return cleaned.slice(0, 110);
  }

  const firstSentence = content
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .find((part) => cleanPlanDescription(part).length > 12);
  if (firstSentence) return cleanPlanDescription(firstSentence).slice(0, 110);

  return steps[0]?.description.slice(0, 110) || "Proposed plan";
}

function stripPlanControlBlocks(content: string): string {
  return content
    .replace(/FILE_EDIT_START[\s\S]*?FILE_EDIT_END/g, "")
    .replace(/LINE_PATCH_START[\s\S]*?LINE_PATCH_END/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function containsArchitecturalSignal(content: string): boolean {
  return /\b(architecture|architectural|system design|data model|schema|component boundary|interface|contract|dependency|moscow|must|should|could|won't|wont)\b/i.test(content);
}

function buildResponsePlan(args: {
  content: string;
  workspaceLens: string;
  confidenceAssessment: ConfidenceAssessment | null;
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
}): ResponsePlan | null {
  if (args.workspaceLens !== "build" && args.workspaceLens !== "flow") return null;

  const text = stripPlanControlBlocks(args.content);
  const lines = text.split("\n");
  const numberedSteps = lines
    .map((line) => line.match(NUMBERED_PLAN_RE)?.[2])
    .filter((value): value is string => !!value && PLAN_ACTION_RE.test(value));
  const hasNumberedPlan = numberedSteps.length >= 3;
  const hasExplicitPhrase = PLAN_PHRASE_RE.test(text);

  const sectionSteps: string[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index].trim();
    const isHeader = /^#{1,3}\s+\S/.test(line) || /^[A-Z][\w\s/-]{2,}:$/.test(line);
    if (!isHeader) continue;
    const items = lines
      .slice(index + 1, index + 7)
      .map((candidate) => candidate.match(BULLET_PLAN_RE)?.[1] ?? candidate.match(NUMBERED_PLAN_RE)?.[2])
      .filter((value): value is string => !!value && PLAN_ACTION_RE.test(value));
    if (items.length >= 2) sectionSteps.push(...items);
  }

  const hasProposedFileChanges = args.fileEdits.length > 0 || args.linePatches.length > 0;
  const coreFiles = new Set<string>([
    ...args.fileEdits.map((edit) => edit.path),
    ...args.linePatches.map((patch) => patch.path),
  ]);
  const explanationBeforePatch = hasProposedFileChanges && text.length > 20 && /\S/.test(text);
  const rawStepText = hasNumberedPlan ? numberedSteps : sectionSteps;

  if (!hasNumberedPlan && !(hasExplicitPhrase && rawStepText.length >= 2) && sectionSteps.length < 2 && !explanationBeforePatch) {
    return null;
  }

  const steps = rawStepText
    .map(cleanPlanDescription)
    .filter(Boolean)
    .slice(0, 12)
    .map((description, index) => {
      const file = extractPlanFile(description);
      const type = classifyPlanStep(description);
      const moscow = classifyMoscow({ description, type, coreFiles, ...(file ? { file } : {}) });
      return {
        order: index + 1,
        description,
        type,
        moscow,
        ...(file ? { file } : {}),
      };
    });

  if (explanationBeforePatch) {
    for (const edit of args.fileEdits) {
      if (!steps.some((step) => step.file === edit.path)) {
        steps.push({
          order: steps.length + 1,
          description: `Edit ${edit.path}`,
          type: "edit",
          file: edit.path,
          moscow: "must",
        });
      }
    }
    for (const patch of args.linePatches) {
      if (!steps.some((step) => step.file === patch.path)) {
        steps.push({
          order: steps.length + 1,
          description: `Patch ${patch.path}`,
          type: "edit",
          file: patch.path,
          moscow: "must",
        });
      }
    }
    if (!steps.some((step) => step.type === "push")) {
      steps.push({
        order: steps.length + 1,
        description: "Review and push the proposed changes",
        type: "push",
        moscow: "must",
      });
    }
  }

  if (steps.length < 2) return null;

  const touchedFiles = new Set<string>();
  for (const file of args.confidenceAssessment?.files_affected ?? []) touchedFiles.add(file);
  for (const edit of args.fileEdits) touchedFiles.add(edit.path);
  for (const patch of args.linePatches) touchedFiles.add(patch.path);
  for (const step of steps) {
    if (step.file) touchedFiles.add(step.file);
  }

  const touchedFileCount = touchedFiles.size;
  const hasAnalysisStep = steps.some((step) => step.type === "analysis" || step.type === "read");
  const hasEditStep = steps.some((step) => step.type === "edit");
  const hasMoscowClassification = steps.some((step) => !!step.moscow);
  const isBlueprint =
    steps.length >= 5 &&
    touchedFileCount > 1 &&
    hasAnalysisStep &&
    hasEditStep &&
    (containsArchitecturalSignal(text) || hasMoscowClassification);

  return {
    title: planTitleFromContent(text, steps),
    mode: isBlueprint ? "blueprint" : "plan",
    steps: steps.map((step, index) => ({ ...step, order: index + 1 })),
    confidence: args.confidenceAssessment?.confidence ?? "medium",
    estimatedChanges: touchedFileCount,
    reversible: hasProposedFileChanges && touchedFileCount > 0,
  };
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

// ── Deep Dive detector ────────────────────────────────────────────────────────
const DEEP_DIVE_RE = /^\/deep\s+(.+)/si;

function isDeepDive(message: string): { isDive: boolean; topic: string } {
  const m = message.match(DEEP_DIVE_RE);
  if (m) return { isDive: true, topic: m[1].trim() };
  return { isDive: false, topic: "" };
}

async function runDeepDive(topic: string, systemPrompt: string): Promise<ModelCallResult> {
  const model = "gemini-2.5-pro";
  const startedAt = performance.now();
  // Use Gemini for deep dives — large context window, good at synthesis
  const prompt = `You are Atlas performing a Deep Dive research analysis. The user wants comprehensive technical insight on:

"${topic}"

Produce a structured research card in this exact format:

## Deep Dive: ${topic}

**Summary**
[2-3 sentence plain English summary of what this is and why it matters]

**Key Patterns**
[3-5 bullet points of the most important technical patterns, approaches, or concepts]

**Practical Considerations**
[2-3 bullets on real-world gotchas, tradeoffs, or things to watch out for]

**Relevant for You**
[1-2 sentences on how this applies specifically to your Z Fold 6 / mobile-first / luxury UI context]

**Open Questions**
[2-3 questions worth answering before committing to an approach]

Be specific and practical. No filler. This is research output, not a chat reply.`;

  const result = await genai.models.generateContent({
    model,
    contents: prompt,
    config: { systemInstruction: systemPrompt },
  });
  const usageMetadata = (result as any).usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
  const inputTokens = usageMetadata?.promptTokenCount ?? null;
  const outputTokens = usageMetadata?.candidatesTokenCount
    ?? (usageMetadata?.totalTokenCount != null && inputTokens != null ? Math.max(usageMetadata.totalTokenCount - inputTokens, 0) : null);
  return {
    content: result.text ?? "Deep Dive returned no content.",
    model,
    usage: {
      executionTimeMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
      costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
    },
  };
}

// ── Multi-model dispatcher ────────────────────────────────────────────────────
type ModelId = "claude" | "gpt4o" | "gemini";

type ModelCallUsage = {
  executionTimeMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

type ModelCallResult = {
  content: string;
  model: string;
  usage: ModelCallUsage;
};

function selectChatModelForMessage(message: string): ModelId {
  if (/```[\s\S]*?```/.test(message)) return "gpt4o";

  const codeRequestPattern = /\b(write|fix|review|debug|implement|refactor|edit|modify|update|generate|create|build|patch)\b[\s\S]{0,80}\b(code|component|function|class|hook|api|endpoint|route|query|schema|migration|test|types?|css|html|sql|script|bug|error|file|repo|repository|pr|pull request)\b|\b(code|component|function|class|hook|api|endpoint|route|query|schema|migration|test|types?|css|html|sql|script|bug|error|file|repo|repository|pr|pull request)\b[\s\S]{0,80}\b(write|fix|review|debug|implement|refactor|edit|modify|update|generate|create|build|patch)\b/i;
  if (codeRequestPattern.test(message)) return "gpt4o";

  const structuredTechnicalPattern = /\b(return|respond|output|format|give|provide|create|generate|write|draft|design|define|produce|make|show|list)\b[\s\S]{0,80}\b(json|yaml|xml|schema|openapi|swagger|graphql|sql|regex|typescript type|interface|api spec|technical spec|acceptance criteria|test plan|diff|patch|file edit|markdown table|mermaid)\b|\b(json|yaml|xml|schema|openapi|swagger|graphql|sql|regex|typescript type|interface|api spec|technical spec|acceptance criteria|test plan|diff|patch|file edit|markdown table|mermaid)\b[\s\S]{0,80}\b(return|respond|output|format|give|provide|create|generate|write|draft|design|define|produce|make|show|list)\b/i;
  if (structuredTechnicalPattern.test(message)) return "gpt4o";

  return "claude";
}

const emptyUsage = (): ModelCallUsage => ({
  executionTimeMs: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
});

function addNullableNumbers(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

function mergeUsage(a: ModelCallUsage, b: ModelCallUsage): ModelCallUsage {
  return {
    executionTimeMs: a.executionTimeMs + b.executionTimeMs,
    inputTokens: addNullableNumbers(a.inputTokens, b.inputTokens),
    outputTokens: addNullableNumbers(a.outputTokens, b.outputTokens),
    costUsd: addNullableNumbers(a.costUsd, b.costUsd),
  };
}

function usageInsertValues(usage: ModelCallUsage) {
  return {
    executionTimeMs: usage.executionTimeMs == null ? null : Math.max(1, usage.executionTimeMs),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd == null ? null : usage.costUsd.toFixed(5),
  };
}

function runSummaryFromContent(content: string): string {
  const line = content
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((part) => part.replace(/^#+\s*/, "").replace(/^[-*•]\s*/, "").trim())
    .find(Boolean);
  if (!line) return "Atlas response completed.";
  return line.length > 120 ? `${line.slice(0, 117).trim()}...` : line;
}

function runMetadataInsertValues(content: string, fileEdits: FileEdit[] = []) {
  const runActions: RunAction[] | null = fileEdits.length > 0
    ? [{
      verb: "Prepared",
      target: fileEdits.length === 1 ? fileEdits[0].path : `${fileEdits.length} file edits`,
      detail: fileEdits.slice(0, 3).map((edit) => edit.path).join(", "),
      status: "ok",
    }]
    : null;
  const runArtifacts: RunArtifact[] | null = fileEdits.length > 0
    ? fileEdits.map((edit) => ({
      type: "file",
      label: edit.path,
      meta: edit.language,
    }))
    : null;

  return {
    runStatus: "completed" as RunStatus,
    runSummary: runSummaryFromContent(content),
    runActions,
    runArtifacts,
  };
}

async function callModel(
  modelId: ModelId,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }>,
  imageData?: { base64: string; mediaType: string }
): Promise<ModelCallResult> {
  const startedAt = performance.now();
  if (modelId === "gpt4o") {
    const model = "gpt-4o";
    // Build OpenAI messages
    type OAIMsg = { role: "system" | "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> };
    const oaiMessages: OAIMsg[] = [{ role: "system", content: systemPrompt }];
    for (const m of messages) {
      if (m.role === "user" && imageData && m === messages[messages.length - 1]) {
        oaiMessages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${imageData.mediaType};base64,${imageData.base64}` } },
            { type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) },
          ],
        });
      } else {
        oaiMessages.push({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
    const resp = await openaiClient.chat.completions.create({
      model,
      max_tokens: 8192,
      messages: oaiMessages as Parameters<typeof openaiClient.chat.completions.create>[0]["messages"],
    });
    const inputTokens = resp.usage?.prompt_tokens ?? null;
    const outputTokens = resp.usage?.completion_tokens ?? null;
    return {
      content: resp.choices[0]?.message?.content ?? "",
      model,
      usage: {
        executionTimeMs: Math.round(performance.now() - startedAt),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
      },
    };
  }

  if (modelId === "gemini") {
    const model = "gemini-2.5-pro";
    const combinedText = messages.map((m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role === "user" ? "User" : "Atlas"}: ${text}`;
    }).join("\n\n");
    let result: Awaited<ReturnType<typeof genai.models.generateContent>>;
    if (imageData?.base64 && imageData?.mediaType) {
      result = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: combinedText }, { inlineData: { mimeType: imageData.mediaType, data: imageData.base64 } }] }],
        config: { systemInstruction: systemPrompt },
      });
    } else {
      result = await genai.models.generateContent({
        model,
        contents: combinedText,
        config: { systemInstruction: systemPrompt },
      });
    }
    const usageMetadata = (result as any).usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
    const inputTokens = usageMetadata?.promptTokenCount ?? null;
    const outputTokens = usageMetadata?.candidatesTokenCount
      ?? (usageMetadata?.totalTokenCount != null && inputTokens != null ? Math.max(usageMetadata.totalTokenCount - inputTokens, 0) : null);
    return {
      content: result.text ?? "",
      model,
      usage: {
        executionTimeMs: Math.round(performance.now() - startedAt),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
      },
    };
  }

  // Default: Claude
  const model = "claude-sonnet-4-6";
  type TextBlock = { type: "text"; text: string };
  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
  const claudeMessages: Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }> = messages as typeof claudeMessages;
  const response = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: claudeMessages,
  });
  const inputTokens = response.usage.input_tokens ?? null;
  const outputTokens = response.usage.output_tokens ?? null;
  return {
    content: response.content[0]?.type === "text" ? response.content[0].text : "",
    model,
    usage: {
      executionTimeMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
      costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
    },
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────
function extractFlowNodes(content: string): {
  content: string;
  flowNodes: Array<{ id: string; type: string; label: string; question?: string; x: number; y: number }>;
} {
  const nodeLines: string[] = [];
  const clean = content
    .replace(/^FLOW_NODE:\{[^\n]*\}$/gm, (match) => { nodeLines.push(match); return ""; })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const flowNodes = nodeLines.map((line, i) => {
    try {
      const parsed = JSON.parse(line.replace(/^FLOW_NODE:/, "")) as { type?: string; label?: string; question?: string };
      return {
        id: `flow-${Date.now()}-${i}`,
        type: parsed.type ?? "feature",
        label: parsed.label ?? "New Node",
        question: parsed.question,
        x: 160 + (i % 3) * 200,
        y: 140 + Math.floor(i / 3) * 130,
      };
    } catch { return null; }
  }).filter((n): n is NonNullable<typeof n> => n !== null);
  return { content: clean, flowNodes };
}

router.get("/image-gen-test", async (req, res): Promise<void> => {
  const results: Record<string, unknown> = {};

  // Test Imagen 3
  try {
    const r = await genai.models.generateImages({
      model: "imagen-3.0-generate-004",
      prompt: "A simple red circle on a white background",
      config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "1:1" }
    });
    const bytes = r.generatedImages?.[0]?.image?.imageBytes;
    results.imagen3 = bytes ? "SUCCESS" : "NO_BYTES_RETURNED";
  } catch (err: any) {
    results.imagen3 = { error: err?.message, code: err?.code, status: err?.status };
  }

  // Test DALL-E 3
  try {
    const r = await openaiClient.images.generate({
      model: "dall-e-3",
      prompt: "A simple red circle on a white background",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
    });
    results.dalle3 = r.data?.[0]?.b64_json ? "SUCCESS" : "NO_IMAGE_RETURNED";
  } catch (err: any) {
    results.dalle3 = { error: err?.message, code: err?.code, status: err?.status };
  }

  res.json(results);
});

router.post("/chat", async (req, res): Promise<void> => {
  const writeStep = (res: Response, s: { verb: string; target?: string; phase: string }) => {
    try { res.write(`data: ${JSON.stringify({ type: "step", ...s })}\n\n`); } catch {}
  };

  const body = req.body as {
    sessionId?: number;
    projectId?: number | null;
    message: string;
    mode?: string;
    lens?: string;
    workspaceLens?: string;
    buildMode?: boolean;
    scenarioMode?: boolean;
    history?: Array<{ role: string; content: string }>;
    entries?: Array<{ id: number; title: string; status: string }>;
    fileContext?: string;
    userProfile?: string;
    imageData?: string | { base64: string; mediaType: string };
    imageMimeType?: string;
    attachments?: Array<{ base64: string; mediaType: string; name?: string }>;
    flowMode?: boolean;
    flowNodes?: Array<{ type: string; label: string; question?: string; strategicAnswer?: string }>;
    forgeContext?: string;
  };

  const isFlowMode = !!body.flowMode;
  const isScenarioMode = !!body.scenarioMode;
  const buildMode = Boolean(body.buildMode);

  const isFoundationMode = !body.projectId;
  if ((!body.sessionId && !isFlowMode && !isFoundationMode) || (!body.message && !body.attachments?.length)) {
    res.status(400).json({ error: "Missing required fields: sessionId (or foundation mode), message" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  writeStep(res, { verb: "Reviewing", target: "workspace context", phase: "scan" });

  const { sessionId = 0, message, history = [], entries = [] } = body;
  const projectId = body.projectId ?? 0;
  const fileContext = body.fileContext ?? "";
  const userProfile = body.userProfile ?? "";
  const projectMap = (body as any).projectMap as string | undefined;
  const clientForgeContext = body.forgeContext ?? "";
  const rawImageData = body.imageData ?? undefined;
  const legacyBase64 = typeof rawImageData === "string" ? rawImageData : rawImageData?.base64 ?? undefined;
  const legacyMimeType = body.imageMimeType ?? (typeof rawImageData === "object" ? rawImageData?.mediaType : undefined);
  // Normalise: merge legacy imageData/imageMimeType + new attachments array into one list
  const allAttachments: Array<{ base64: string; mediaType: string; name?: string }> = [
    ...(body.attachments ?? []),
    ...(legacyBase64 && legacyMimeType ? [{ base64: legacyBase64, mediaType: legacyMimeType }] : []),
  ];
  const activeModel = selectChatModelForMessage(message);
  const now = new Date();
  const userId = (req as any).authUser?.id as number | undefined;

  // ── Intercept /research <url> slash command ──────────────────────────────────
  // User-facing shorthand: /research https://competitor.com  (or just /research domain.com)
  const researchSlashMatch = message.match(/^\/research\s+(\S+)/i);
  if (researchSlashMatch) {
    const rawUrl = researchSlashMatch[1].trim();
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    writeStep(res, { verb: "Researching", target: url, phase: "execute" });
    try {
      const scrapeRes = await fetch(`${req.protocol}://${req.get("host")}/api/browser/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
        body: JSON.stringify({ url, maxLength: 8000, analyze: true }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await scrapeRes.json() as {
        title?: string; text?: string; headings?: string[];
        links?: Array<{ href: string; text: string }>; analysis?: string; error?: string;
      };
      if (data.error) {
        res.write(`data: ${JSON.stringify({ type: "done", content: `Could not research ${url}: ${data.error}`, researchResult: null, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
      } else {
        const topHeadings = (data.headings ?? []).slice(0, 6);
        const mdSummary = [
          `**${data.title ?? url}**  \`${url}\``,
          data.analysis ?? data.text?.slice(0, 600) ?? "",
          topHeadings.length > 0 ? `**Key sections:** ${topHeadings.join(" · ")}` : "",
        ].filter(Boolean).join("\n\n");
        const researchResult = {
          type: "research" as const,
          url,
          title: data.title ?? url,
          summary: data.analysis ?? null,
          headings: topHeadings,
        };
        res.write(`data: ${JSON.stringify({ type: "done", content: mdSummary, researchResult, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
      }
    } catch (err) {
      logger.error({ err: String(err), url }, "Research slash command failed");
      res.write(`data: ${JSON.stringify({ type: "done", content: `Research failed for ${url}.`, researchResult: null, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
    }
    res.end();
    return;
  }

  // ── Intercept browser automation commands ──
  const browserScrapeMatch = message.match(/^BROWSER_SCRAPE:\s*(.+)$/i);
  if (browserScrapeMatch) {
    const url = browserScrapeMatch[1].trim();
    writeStep(res, { verb: "Scraping", target: url, phase: "execute" });
    try {
      const scrapeRes = await fetch(`${req.protocol}://${req.get("host")}/api/browser/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
        body: JSON.stringify({ url, maxLength: 8000, analyze: true }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await scrapeRes.json() as {
        title?: string; text?: string; headings?: string[]; links?: Array<{ href: string; text: string }>;
        analysis?: string; error?: string;
      };
      if (data.error) {
        res.write(`data: ${JSON.stringify({ type: "done", content: `Failed to scrape ${url}: ${data.error}`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}
\n`);
      } else {
        const summary = data.analysis
          ? `**${data.title ?? "Untitled"}**  \`${url}\`\n\n${data.analysis}`
          : [
            `**${data.title ?? "Untitled"}**  \`${url}\``,
            "",
            data.text?.slice(0, 2000) ?? "",
            data.headings && data.headings.length > 0 ? `\n**Key sections:** ${data.headings.slice(0, 6).join(" · ")}` : "",
          ].filter(Boolean).join("\n");
        const topHeadings = (data.headings ?? []).slice(0, 6);
        const researchResult = {
          type: "research" as const,
          url,
          title: data.title ?? url,
          summary: data.analysis ?? null,
          headings: topHeadings,
        };
        res.write(`data: ${JSON.stringify({ type: "done", content: summary, researchResult, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
      }
    } catch (err) {
      logger.error({ err: String(err), url }, "Browser scrape intercept failed");
      res.write(`data: ${JSON.stringify({ type: "done", content: `Failed to scrape ${url}.`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}
\n`);
    }
    res.end();
    return;
  }

  // ── Intercept browser screenshot commands ──
  const browserScreenshotMatch = message.match(/^BROWSER_SCREENSHOT:\s*(.+)$/i);
  if (browserScreenshotMatch) {
    const url = browserScreenshotMatch[1].trim();
    writeStep(res, { verb: "Screenshotting", target: url, phase: "execute" });
    try {
      const shotRes = await fetch(`${req.protocol}://${req.get("host")}/api/browser/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
        body: JSON.stringify({ url, analyze: true }),
        signal: AbortSignal.timeout(40_000),
      });
      const data = await shotRes.json() as {
        screenshotBase64?: string; imageUrl?: string; analysis?: string; error?: string;
      };
      if (data.error) {
        res.write(`data: ${JSON.stringify({ type: "done", content: `Failed to screenshot ${url}: ${data.error}`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
      } else {
        const content = data.analysis
          ? `**Screenshot of ${url}**\n\n${data.analysis}`
          : `**Screenshot of ${url}**`;
        res.write(`data: ${JSON.stringify({ type: "done", content, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system", browserResult: { type: "screenshot", url, screenshotBase64: data.screenshotBase64, analysis: data.analysis } })}\n\n`);
      }
    } catch (err) {
      logger.error({ err: String(err), url }, "Browser screenshot intercept failed");
      res.write(`data: ${JSON.stringify({ type: "done", content: `Failed to screenshot ${url}.`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "EXPLORE", catchPayload: null, messageId: null, model: "system" })}\n\n`);
    }
    res.end();
    return;
  }

  // ── Intercept deploy commands ──
  const deployMatch = message.match(/^DEPLOY_NOW:/i);
  if (deployMatch) {
    writeStep(res, { verb: "Triggering", target: "Vercel deploy", phase: "execute" });
    try {
      const deployRes = await fetch(`${req.protocol}://${req.get("host")}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await deployRes.json() as {
        success?: boolean; deploymentId?: string; url?: string; state?: string; error?: string; alias?: string[];
      };
      if (data.error) {
        res.write(`data: ${JSON.stringify({ type: "done", content: `Deploy failed: ${data.error}`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "BUILD", catchPayload: null, messageId: null, model: "system" })}
\n`);
      } else {
        const alias = data.alias?.[0] ?? data.url ?? "";
        res.write(`data: ${JSON.stringify({ type: "done", content: `Deploy triggered ✅\n- Deployment: ${data.deploymentId ?? "N/A"}\n- Status: ${data.state ?? "queued"}\n- URL: ${alias ? `https://${alias}` : "pending"}`, modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "BUILD", catchPayload: null, messageId: null, model: "system" })}
\n`);
      }
    } catch (err) {
      logger.error({ err: String(err) }, "Deploy intercept failed");
      res.write(`data: ${JSON.stringify({ type: "done", content: "Deploy trigger failed. Check your Vercel connection in Settings.", modelUsed: "system", terminalCmd: null, terminalResult: null, surface: "system", intentType: "BUILD", catchPayload: null, messageId: null, model: "system" })}
\n`);
    }
    res.end();
    return;
  }
  logger.info({ projectId, userId, hasProjectId: !!projectId, hasUserId: !!userId }, "chat terminal debug");

  // Load project memory + repo info + node state from DB, plus user memory when authenticated.
  // Also check for Vercel connection so we know whether to defer BROWSER_VISIT until after deploy.
  const [projectRows, userRows, vercelRows] = await Promise.all([
    isFoundationMode
      ? Promise.resolve([] as Array<{ memory: string | null; linkedRepo: string | null; githubToken: string | null; nodeState: Record<string, unknown> | null; name: string; previewUrl: string | null; description: string | null }>)
      : db
          .select({ memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken, nodeState: projectsTable.nodeState, name: projectsTable.name, previewUrl: projectsTable.previewUrl, description: projectsTable.description })
          .from(projectsTable)
          .where(userId ? and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)) : eq(projectsTable.id, projectId)),
    userId
      ? db
          .select({ memory: (usersTable as any).memory })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1)
      : Promise.resolve([] as Array<{ memory: string | null }>),
    userId
      ? db
          .select({ id: connectionsTable.id })
          .from(connectionsTable)
          .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "vercel")))
          .limit(1)
      : Promise.resolve([] as Array<{ id: number }>),
  ]);
  const [project] = projectRows;
  const [user] = userRows;
  const hasVercelConnection = vercelRows.length > 0;

  // Derive server-side forge foundation from persisted AxiomFlow node state
  // This is the authoritative source — client-sent forgeContext supplements but never replaces it
  const SYSTEM_NODE_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);
  const savedNodeState = (project?.nodeState ?? {}) as Record<string, unknown>;
  const savedForgeNodes = Object.keys(savedNodeState).filter(k => !SYSTEM_NODE_IDS.has(k));
  // Each saved node entry: { resolved, strategicAnswer?, label? } — we only have IDs here,
  // so build a compact representation from what's persisted
  const serverForgeContext = savedForgeNodes.length > 0
    ? savedForgeNodes.map(k => {
        const v = savedNodeState[k] as { resolved?: boolean; strategicAnswer?: string } | undefined;
        return `[node:${k}]${v?.resolved ? " ✓resolved" : ""}${v?.strategicAnswer ? `: ${v.strategicAnswer.slice(0, 60)}` : ""}`;
      }).join(" | ")
    : "";
  // Merge: server state is authoritative; client hint supplements (e.g. fresh label names from just-run Forge)
  const forgeContext = [serverForgeContext, clientForgeContext].filter(Boolean).join(" | ");

  // Parse 5-tier memory store
  let store = parseMemoryStore(project?.memory ?? null);
  store = consolidateIfNeeded(store, now);

  // Build memory context + increment retrieval counts
  const { text: memoryText, retrievedIds } = buildMemoryContext(store);
  if (retrievedIds.length > 0) {
    store = incrementRetrievals(store, retrievedIds, now);
  }

  let userStore: MemoryStore | null = null;
  let userMemoryText = "";
  let userRetrievedIds: number[] = [];
  if (userId) {
    userStore = parseMemoryStore(user?.memory ?? null);
    const cleanedUserStore = cleanPollutedUserStackFacts(userStore);
    if (cleanedUserStore.removedCount > 0) {
      userStore = cleanedUserStore.store;
      await db
        .update(usersTable)
        .set({ memory: JSON.stringify(userStore) })
        .where(eq(usersTable.id, userId));
    }
    userStore = consolidateIfNeeded(userStore, now);

    const userMemoryContext = buildMemoryContext(userStore);
    userMemoryText = userMemoryContext.text;
    userRetrievedIds = userMemoryContext.retrievedIds;
    if (userRetrievedIds.length > 0) {
      userStore = incrementRetrievals(userStore, userRetrievedIds, now);
    }
  }

  // Auto-fetch repo file tree (Phase 1 — injected when a repo is linked and message needs code context)
  // Skip for short/conversational messages — saves up to 3s of silence before Claude starts
  const CODE_CONTEXT_RE = /\b(fix|build|create|implement|write|refactor|debug|error|broken|doesn't work|won't work|failing|crash|not working|file|component|function|route|api|endpoint|schema|migration|deploy|page|button|layout|style|hook|class|module|import|export|install|package|config|test|spec|type|interface|column|table|query|pull|push|commit|branch|pr|diff|preview|stackblitz)\b/i;
  const needsCodeContext = buildMode || CODE_CONTEXT_RE.test(message) || message.length > 200 || (body.fileContext?.length ?? 0) > 0;

  let repoTreeContext: string | null = null;
  let repoFiles: Set<string> | null = null;
  let recentRepoActivityContext: string | null = null;
  let repoData: { fullName?: string; defaultBranch?: string } | null = null;
  const resolvedGithubToken = await resolveGithubTokenForRequest(userId, project?.githubToken);

  if (project?.linkedRepo && needsCodeContext) {
    try {
      const parsedRepo = JSON.parse(project.linkedRepo) as string | { fullName?: string; defaultBranch?: string };
      repoData = typeof parsedRepo === "string"
        ? { fullName: parsedRepo, defaultBranch: "main" }
        : parsedRepo;
      if (repoData.fullName) {
        writeStep(res, { verb: "Scanning", target: "project files", phase: "scan" });
        const repoContextFetches: [Promise<RepoTreeSnapshot | null>, Promise<string | null>] = [
          resolvedGithubToken
            ? fetchRepoTree(repoData.fullName, resolvedGithubToken, repoData.defaultBranch ?? "main")
            : Promise.resolve(null),
          process.env.GITHUB_TOKEN
            ? fetchRecentRepoActivity(repoData.fullName, process.env.GITHUB_TOKEN, now)
            : Promise.resolve(null),
        ];

        const [repoTreeSnapshot, fetchedRecentRepoActivityContext] = await Promise.race([
          Promise.all(repoContextFetches),
          new Promise<[RepoTreeSnapshot | null, string | null]>((resolve) => setTimeout(() => resolve([null, null]), 3000)),
        ]);
        repoTreeContext = repoTreeSnapshot?.context ?? null;
        repoFiles = repoTreeSnapshot?.files ?? null;
        recentRepoActivityContext = fetchedRecentRepoActivityContext;
      }
    } catch {
      // Non-fatal: continue without tree context
    }
  }

  // Phase 2 — auto-fetch file contents when the user asks to build/fix something
  // Intentionally narrower than CODE_CONTEXT_RE — only triggers selector API call for explicit build requests
  const BUILD_INTENT_RE = /\b(fix|build|create|implement|write|refactor|debug|error|broken|doesn't work|won't work|failing|crash|not working)\b/i;
  let autoFetchedFiles: string[] = [];
  let autoFetchedContext = "";
  const previousContentByPath = new Map<string, string>();

  if ((buildMode || BUILD_INTENT_RE.test(message)) && message.length > 20 && repoData?.fullName && resolvedGithubToken && repoTreeContext) {
    try {
      // Fast selector call: ask Claude which files it needs to read (small, cheap)
      // Use haiku for speed — sonnet adds 5-8s of silence before streaming starts
      const selectorResp = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: `Given this file tree and user request, return ONLY a JSON array of the 1-3 most relevant file paths to read. Return [] if no specific files are needed.\n\nUser request: "${message}"\n\nFile tree:\n${repoTreeContext}\n\nReturn ONLY a JSON array like ["src/pages/Login.tsx"] — no explanation.`,
        }],
      }, { signal: AbortSignal.timeout(2000) });
      const selectorText = selectorResp.content[0]?.type === "text" ? selectorResp.content[0].text.trim() : "[]";
      const cleaned = selectorText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      let filePaths: unknown = [];
      try { filePaths = JSON.parse(cleaned); } catch { /* ignore */ }

      if (Array.isArray(filePaths) && filePaths.length > 0) {
        const validPaths = (filePaths as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 3);
        const fetched = await Promise.all(
          validPaths.map(async (fp) => {
            try {
              const r = await fetch(
                `${GH_API}/repos/${repoData!.fullName}/contents/${fp}?ref=${repoData!.defaultBranch ?? "main"}`,
                { headers: ghHeaders(resolvedGithubToken) }
              );
              if (!r.ok) return null;
              const d = await r.json() as { encoding?: string; content?: string };
              if (d.encoding !== "base64" || !d.content) return null;
              const content = Buffer.from(d.content.replace(/\n/g, ""), "base64").toString("utf-8");
              const lines = content.split("\n");
              const truncated = lines.length > 600;
              return { path: fp, content: truncated ? lines.slice(0, 600).join("\n") : content, truncated, lineCount: lines.length };
            } catch { return null; }
          })
        );
        const valid = fetched.filter((f): f is { path: string; content: string; truncated: boolean; lineCount: number } => f !== null);
        if (valid.length > 0) {
          autoFetchedFiles = valid.map(f => f.path);
          valid.forEach((file) => addKnownPreviousContent(previousContentByPath, file));
          autoFetchedContext = valid
            .map(f => `=== ${f.path}${f.truncated ? ` [first 600 of ${f.lineCount} lines]` : ""} ===\n${f.content}`)
            .join("\n\n");
        }
      }
    } catch {
      // Non-fatal — proceed without auto-fetched content
    }
  }

  // Merge auto-fetched content with any manually-opened files from the client
  const combinedFileContext = [autoFetchedContext, fileContext].filter(Boolean).join("\n\n");
  extractPreviousContentByPath(fileContext).forEach((content, path) => {
    previousContentByPath.set(path, content);
  });

  // Detect portfolio-wide question so we can pull cross-project entries
  const isPortfolioQuestion = !isFoundationMode && PORTFOLIO_INTENT_RE.test(message);

  // Run remaining DB queries in parallel — previously sequential, added 400-600ms per request
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentErrorsRows, selfMapRows, portfolioRows, committedRows] = await Promise.all([
    db
      .select({ errorMessage: atlasErrorLogsTable.errorMessage, route: atlasErrorLogsTable.route, timestamp: atlasErrorLogsTable.timestamp })
      .from(atlasErrorLogsTable)
      .where(and(eq(atlasErrorLogsTable.projectId, String(projectId)), gte(atlasErrorLogsTable.createdAt, cutoff)))
      .orderBy(desc(atlasErrorLogsTable.createdAt))
      .limit(5)
      .catch(() => [] as Array<{ errorMessage: string; route: string; timestamp: Date }>),
    db
      .select({ fileCount: atlasSelfMapTable.fileCount })
      .from(atlasSelfMapTable)
      .orderBy(desc(atlasSelfMapTable.createdAt))
      .limit(1)
      .catch(() => [] as Array<{ fileCount: number }>),
    userId
      ? isFoundationMode
        ? db.select({ id: projectsTable.id, name: projectsTable.name, status: projectsTable.status, description: projectsTable.description, memory: projectsTable.memory }).from(projectsTable).where(eq(projectsTable.userId, userId)).orderBy(desc(projectsTable.updatedAt)).limit(20).catch(() => [] as Array<{ id: number; name: string; status: string | null; description: string | null; memory: string | null }>)
        : db.select({ id: projectsTable.id, name: projectsTable.name, status: projectsTable.status, description: projectsTable.description, memory: projectsTable.memory }).from(projectsTable).where(and(eq(projectsTable.userId, userId), ne(projectsTable.id, projectId))).orderBy(desc(projectsTable.updatedAt)).limit(8).catch(() => [] as Array<{ id: number; name: string; status: string | null; description: string | null; memory: string | null }>)
      : Promise.resolve([] as Array<{ id: number; name: string; status: string | null; description: string | null; memory: string | null }>),
    db
      .select({ title: entriesTable.title, summary: entriesTable.summary, createdAt: entriesTable.createdAt })
      .from(entriesTable)
      .where(and(eq(entriesTable.projectId, projectId), eq(entriesTable.status, "committed")))
      .orderBy(desc(entriesTable.createdAt))
      .limit(25)
      .catch(() => [] as Array<{ title: string; summary: string | null; createdAt: Date }>),
  ]);

  const recentErrorContext = recentErrorsRows
    .map((e) => `Recent production errors detected: ${e.errorMessage} at ${e.route} — ${e.timestamp.toISOString()}`)
    .join("\n");
  const selfMapContext = selfMapRows[0] ? `Current codebase: ${selfMapRows[0].fileCount} files indexed. Architecture map available for reasoning.` : "";
  const DEFAULT_NAMES = new Set(["New Project", "New Idea", "My Project", ""]);

  // Build layered system prompt — use project data already fetched in the first Promise.all
  let systemPrompt = isFoundationMode ? FOUNDATION_SYSTEM_PROMPT : DEV_SYSTEM_PROMPT;
  systemPrompt += ATLAS_PLATFORM_KNOWLEDGE;
  if (!isFoundationMode && project) {
    const projectAlreadyNamedInstruction = !DEFAULT_NAMES.has((project.name ?? "").trim())
      ? `\nThis project is already named ${project.name}. Do not suggest renaming it, do not ask the user for a name, and do not propose alternative names unless the user explicitly asks.`
      : "";
    systemPrompt += `\n\n--- ACTIVE PROJECT ---\nProject name: ${project.name}${project.description ? `\nDescription: ${project.description}` : ""}\nThis is the project you are currently working in. Always refer to it by name. Never ask the user what project they are working on.${projectAlreadyNamedInstruction}\n--- END ACTIVE PROJECT ---`;
  }
  if (userId && portfolioRows.length > 0) {
    const portfolioSummary = portfolioRows.map((p) => {
      const parts = [`- **${p.name}**`];
      if (p.status) parts.push(`(${p.status})`);
      if (p.description) parts.push(`— ${p.description}`);
      return parts.join(" ");
    }).join("\n");
    const portfolioMemory = portfolioRows
      .filter((p) => p.memory)
      .map((p) => `**${p.name}:** ${p.memory}`)
      .join("\n");
    const portfolioLabel = isFoundationMode
      ? "YOUR FULL PORTFOLIO (all projects — use this to answer cross-portfolio questions)"
      : "YOUR PORTFOLIO (other projects — use this for cross-project questions, prioritization, and portfolio-wide insight)";
    systemPrompt += `\n\n--- ${portfolioLabel} ---\n${portfolioSummary}\n${portfolioMemory ? `\n### What you already know about each:\n${portfolioMemory}` : ""}\nTotal projects: ${portfolioRows.length}\n--- END PORTFOLIO ---`;
  }

  // If user is asking a portfolio-wide question from inside a workspace, pull committed
  // decisions from ALL their projects so Atlas has real data even if memories are empty.
  if (isPortfolioQuestion && userId) {
    try {
      const allProjectIds = portfolioRows.map(p => p.id);
      allProjectIds.push(projectId); // include current project too
      if (allProjectIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        const crossEntries = await db
          .select({
            projectId: entriesTable.projectId,
            title: entriesTable.title,
            summary: entriesTable.summary,
          })
          .from(entriesTable)
          .where(and(
            inArray(entriesTable.projectId, allProjectIds),
            eq(entriesTable.status, "committed")
          ))
          .orderBy(desc(entriesTable.createdAt))
          .limit(60);

        if (crossEntries.length > 0) {
          const projectNameById = new Map<number, string>(
            portfolioRows.map(p => [p.id, p.name] as [number, string])
          );
          if (project) projectNameById.set(projectId, project.name);

          const byProject = new Map<string, string[]>();
          for (const e of crossEntries) {
            const name = projectNameById.get(e.projectId) ?? "Unknown";
            if (!byProject.has(name)) byProject.set(name, []);
            byProject.get(name)!.push(`  • ${e.title}${e.summary ? ` — ${e.summary.slice(0, 120)}` : ""}`);
          }
          const crossSummary = Array.from(byProject.entries())
            .map(([name, lines]) => `**${name}:**\n${lines.join("\n")}`)
            .join("\n\n");
          systemPrompt += `\n\n--- CROSS-PORTFOLIO COMMITTED DECISIONS (user is asking for a portfolio view — answer from ALL projects below) ---\n${crossSummary}\n--- END CROSS-PORTFOLIO ---`;
        }
      }
    } catch { /* non-fatal — portfolio context is additive */ }
  }
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (userMemoryText) {
    systemPrompt += `\n\n--- ABOUT THIS FOUNDER (durable facts about the person you work with — use naturally, never recite) ---\n${userMemoryText}\n--- END ABOUT THIS FOUNDER ---`;
  }
  if (memoryText) {
    systemPrompt += `\n\n--- PROJECT MEMORY (what you already know — use this) ---\n${memoryText}\n--- END PROJECT MEMORY ---`;
  }

  // Inject committed decisions from the Decision Ledger (fetched in the parallel batch above)
  if (committedRows.length > 0) {
    const ledgerText = committedRows
      .map(e => `• ${e.title}${e.summary ? ` — ${e.summary}` : ""}`)
      .join("\n");
    systemPrompt += `\n\n--- COMMITTED DECISIONS (Decision Ledger — reference these naturally, never cite entry numbers) ---\n${ledgerText}\n--- END COMMITTED DECISIONS ---`;
  }

  if (projectMap) {
    systemPrompt += `\n\n--- PROJECT MAP (auto-scanned structure — use this to answer "what do I have?" questions without needing files) ---\n${projectMap}\n--- END PROJECT MAP ---`;
  }
  if (repoTreeContext) {
    systemPrompt += `\n\n--- LINKED REPO STRUCTURE (auto-loaded — you can reference these paths in FILE_EDIT blocks) ---\n${repoTreeContext}\n--- END REPO STRUCTURE ---`;
  }
  if (recentRepoActivityContext) {
    systemPrompt += `\n\n${recentRepoActivityContext}\n\nWhen referencing recent commits in your response, interpret them narratively — group by area of impact, synthesize what's changing (e.g. "Three commits hit the auth flow this week, one fixed a session timeout, another added a retry"), don't enumerate SHA hashes. Speak like a collaborator who understands what the code changes actually mean.`;
  }
  systemPrompt += `\n\n--- SESSION CONTINUITY ---
If this is the first assistant message in this session (no prior assistant messages exist in the session history), open naturally — like picking up a real conversation, not filing a status report. DO NOT use the format "Still here. [recap]. What's next:". Instead, read the memory and repo activity and respond the way a sharp collaborator would after being away: reference what actually matters, skip what doesn't, and lead with something useful or ask the right question. One to two sentences max. Never clinical. Never a checklist. Match the energy of someone who was already thinking about this project before the conversation started.
--- END SESSION CONTINUITY ---`;
  if (recentErrorContext) {
    systemPrompt += `\n\n--- RECENT PRODUCTION ERRORS ---\n${recentErrorContext}\n--- END RECENT PRODUCTION ERRORS ---`;
  }
  if (selfMapContext) {
    systemPrompt += `\n\n--- CURRENT CODEBASE MAP ---\n${selfMapContext}\n--- END CURRENT CODEBASE MAP ---`;
  }
  if (forgeContext) {
    systemPrompt += `\n\n--- FORGE STRATEGIC MAP (agreed foundation — treat these as committed nodes; flag any contradictions) ---\n${forgeContext}\n--- END FORGE STRATEGIC MAP ---`;
  }
  if (combinedFileContext) {
    systemPrompt += `\n\n--- CODE CONTEXT (files Atlas read for this request — use these to write complete FILE_EDIT blocks) ---\n${combinedFileContext}\n--- END CODE CONTEXT ---`;
  }

  // Mode-specific instructions — these override the default disposition
  const activeMode = buildMode ? "build" : (body.mode ?? "think").toLowerCase();
  const modeInstructions: Record<string, string> = {
    build: `\n\n--- ACTIVE MODE: BUILD ---
You are now in BUILD mode. This changes how you respond:
• Every answer that involves code MUST include a FILE_EDIT block with the complete corrected file — no partial snippets, no "// rest stays the same".
• Be production-ready. Write code that works the first time.
• Explain what you changed and why in plain English BEFORE the FILE_EDIT blocks.
• Multiple files changed? Emit multiple FILE_EDIT blocks back-to-back.
• GitHub push is enabled — the user will push your FILE_EDIT output directly to their repo.
• Do NOT stop short with explanations. If you can write the code, write it.
• When you receive [FILE_COMMITTED] — the push succeeded. A build check runs automatically and the result appears in the same message as [BUILD_VERIFY]. Act on it immediately:
  - [BUILD_VERIFY: clean] — build compiled. If this is the first push with no prior errors say "Pushed. Build verified ✓" and move to the next step. If you resolved errors in prior attempts say exactly: "Feature implemented. Encountered N compilation error(s) during build, resolved automatically." (replace N with the real count from the build-verify messages).
  - [BUILD_VERIFY: errors found] — build failed. Emit FILE_EDIT blocks fixing ALL listed errors right away. No preamble, no explanation — just fix and emit. The next push will re-verify automatically.
  - [BUILD_VERIFY: max_attempts_reached] — stop auto-fixing. Show the user the last error in a plain summary and ask for their strategic direction.
  - [BUILD_VERIFY: check_failed] — verify couldn't run. Acknowledge the push briefly and continue.
  - No [BUILD_VERIFY] at all — non-StackBlitz project. Acknowledge the push briefly ("Pushed.") and move to the next step.
• When you receive DEPLOY_READY_VISIT: — the Vercel deploy is confirmed live. Say nothing (the health check result appears automatically in the chat). Do not comment on it or summarize it.`,
    plan: `\n\n--- ACTIVE MODE: PLAN ---
You are now in PLAN mode. This changes how you respond:
• Focus on structure, architecture, and sequence — not implementation.
• Use numbered lists, component trees, data schemas, and user flows.
• Map out what needs to exist before writing any code.
• No FILE_EDIT blocks unless the user explicitly asks for code.
• Think like a tech lead scoping a sprint.
• ARTIFACT blocks are still allowed — if the user asks for a standalone file (HTML, JSON, config, etc.), emit it with ARTIFACT as normal.`,
    think: `\n\n--- ACTIVE MODE: THINK ---
You are now in THINK mode. This changes how you respond:
• This is strategic advice — no code writing.
• Help the user reason through decisions, tradeoffs, and direction.
• Ask clarifying questions when the path isn't clear.
• Be a thinking partner, not a builder. Challenge assumptions.
• No FILE_EDIT blocks.
• ARTIFACT blocks are still allowed — if the user asks you to generate a specific file or document, emit it with ARTIFACT as normal. ARTIFACT is a delivery format, not a build action.`,
  };
  systemPrompt += modeInstructions[activeMode] ?? modeInstructions.think;

  if (isFlowMode && !buildMode) {
    const existingNodes = (body.flowNodes ?? []);
    const nodeList = existingNodes.length > 0
      ? `\n\nCurrent canvas nodes:\n${existingNodes.map(n => `- [${n.type}] ${n.label}${n.strategicAnswer ? ` (answered)` : " (unanswered)"}`).join("\n")}`
      : "\n\nThe canvas is currently empty.";
    systemPrompt += `\n\n--- ACTIVE MODE: FLOW ARCHITECT ---
You are helping the user build their AxiomFlow map — a strategic canvas of goals, requirements, blockers, decisions, and sprints.${nodeList}

In this mode you have TWO jobs:
1. Respond naturally as a strategic thinking partner — concise, direct, no fluff.
2. At the END of your response, emit any NEW nodes that belong on the canvas.

Node format — one per line, at the very end of your response ONLY:
FLOW_NODE:{"type":"goal","label":"Short label","question":"Strategic question for this node"}

Valid types: goal · requirement · blocker · decision · sprint · feature
Rules:
- Only emit nodes for NEW concepts not already on the canvas above.
- Labels must be 2–5 words max.
- Only emit nodes when the conversation surfaces something worth mapping — not every response needs them.
- Maximum 3 nodes per response.
- No FLOW_NODE lines if nothing new needs mapping.
- These lines are invisible to the user — they power the live canvas.
--- END FLOW ARCHITECT ---`;
  }

  // Workspace lens — new four-lens system (FLOW / BUILD / LOOK / SCENARIO)
  const workspaceLens = buildMode ? "build" : (body.workspaceLens ?? "flow").toLowerCase();
  const workspaceLensInstructions: Record<string, string> = {
    flow: `\n\n--- LENS: FLOW ---
You are in FLOW lens. This means:
• Think deeply. Explore concepts before reaching conclusions. Ask clarifying questions when the path is unclear.
• Help the user see around corners — surface implications, dependencies, and second-order effects.
• Be a strategic thinking partner. Challenge assumptions gently.
• ARTIFACT blocks are always available — if the user asks you to generate a file, document, or config, emit it with ARTIFACT as normal.
• If the user's message is strongly about writing/pushing code, end your response with: LENS_DRIFT: build`,
    build: `\n\n--- LENS: BUILD ---
You are in BUILD lens. This means:
• Code-first. Every answer that involves code must be production-ready and complete.
• Use FILE_EDIT blocks for all code changes. No partial snippets.
• Be surgical — know what to change and why. Explain concisely before the FILE_EDIT.
• GitHub push is enabled — your output goes directly to the repo.
• When you receive [FILE_COMMITTED] — the push succeeded. Say "Pushed." and continue to the next step. Deploy status surfaces automatically in the chat — you do not need to poll, ask, or check it.
• If the user is clearly exploring concepts or asking "what if" questions with no code intent, end your response with: LENS_DRIFT: flow`,
    look: `\n\n--- LENS: LOOK ---
You are in LOOK lens. This means:
• Visual and UI-first thinking. Every answer is about what the user sees and feels.
• Think in CSS custom properties, Framer Motion, transitions, color systems, spacing rhythm, and typography.
• Use FILE_EDIT blocks for visual changes. No unstyled utility code — everything must look intentional.
• Reference the project's design tokens (--atlas-bg, --atlas-gold, --atlas-ember, etc.) when applicable.
• If the conversation shifts away from visual/CSS/animation topics, end your response with: LENS_DRIFT: build`,
    scenario: `\n\n--- LENS: SCENARIO ---
You are in SCENARIO lens. This is exploratory "what if" territory. No commitments.
• Think freely and speculatively. Explore possibilities without locking anything in.
• Explicitly frame your answers as explorations, not recommendations.
• No FILE_EDIT blocks unless the user says "write it anyway" or similar override.
• Don't reference project decisions as constraints — in scenario mode, everything is on the table.
• If the scenario has clearly evolved into something the user wants to commit to, end your response with: LENS_DRIFT: build`,
  };
  systemPrompt += workspaceLensInstructions[workspaceLens] ?? workspaceLensInstructions.flow;

  // NOTE: legacy lens system, coexists with workspaceLens FLOW/BUILD/LOOK/SCENARIO — review for consolidation in Step 6.
  // Legacy project-level lens — style modifier (builder/strategist/reviewer/teacher)
  const activeLens = (body.lens ?? "builder").toLowerCase();
  const lensInstructions: Record<string, string> = {
    builder: "",
    strategist: `\n\n--- PROJECT STYLE: STRATEGIST ---\nZoom out. Before answering any tactical question, check if there's a strategic implication worth surfacing. Think like a co-founder who's read the whole roadmap.`,
    reviewer: `\n\n--- PROJECT STYLE: REVIEWER ---\nBe critical. Lead with what's fragile or missing before validating what's working. Ask hard questions. Don't soften the assessment.`,
    teacher: `\n\n--- PROJECT STYLE: TEACHER ---\nExplain everything. No jargon without definition. Name concepts, explain patterns, give context before code.`,
  };
  if (activeLens !== "builder") {
    systemPrompt += lensInstructions[activeLens] ?? "";
  }
  if (allAttachments.length > 0) {
    systemPrompt += "\n\nThe user has attached an image to this message. You can see and interpret it directly.";
  }

  // ── Deep Dive shortcut — /deep <topic> ───────────────────────────────────────
  const { isDive: isDiveCmd, topic: diveTopic } = isDeepDive(message);
  // Also trigger deep dive when the More menu sends mode:"deep" or mode:"deepdive"
  const isDive = isDiveCmd || activeMode === "deep" || activeMode === "deepdive";
  const effectiveDiveTopic = isDiveCmd ? diveTopic : message;
  if (isDive) {
    await db.insert(chatMessagesTable).values({ sessionId, role: "user", content: message, intentType: body.mode ?? null });
    const diveResult = await runDeepDive(effectiveDiveTopic, systemPrompt);
    const surface = detectSurfaceSignal({
      content: diveResult.content,
      userMessage: message,
      recentMessages: history,
    });
    const runMetadata = runMetadataInsertValues(diveResult.content);
    const [savedDive] = await db.insert(chatMessagesTable).values({
      sessionId,
      role: "assistant",
      content: diveResult.content,
      intentType: "EXPLORE",
      ...usageInsertValues(diveResult.usage),
      ...runMetadata,
    }).returning();
    await db.update(sessionsTable).set({
      messageCount: sql`${sessionsTable.messageCount} + 2`,
      ...runMetadata,
    }).where(eq(sessionsTable.id, sessionId));
    const inputTokenCount = diveResult.usage.inputTokens;
    res.write(`data: ${JSON.stringify({ type: "done", content: diveResult.content, modelUsed: diveResult.model, terminalCmd: null, terminalResult: null, surface, intentType: "EXPLORE", catchPayload: null, messageId: savedDive.id, model: "gemini", isDeepDive: true, developerLens: { routing: { activeModel: "claude-sonnet-4-6", provider: "anthropic", fallbackTriggered: false }, telemetry: { tokensPerSecond: 0, inputTokens: inputTokenCount ?? 0, executionStrategy: "standard" } } })}\n\n`);
    res.end();
    return;
  }

  // ── Load Visual Vault images for this project ────────────────────────────
  const vault = userId
    ? await loadVaultContext(userId, projectId)
    : { imageBlocks: [], systemNote: "", hasImages: false };
  if (vault.hasImages) {
    systemPrompt += `\n\n--- VISUAL VAULT ---\n${vault.systemNote}\n--- END VISUAL VAULT ---`;
  }

  // ── Live URL capture — screenshot any URLs in the message ─────────────────
  const detectedUrls = extractPageUrls(message);
  const urlBlocks = await screenshotUrlsToBlocks(detectedUrls);
  const urlNote = buildUrlNote(urlBlocks);
  if (urlNote) {
    systemPrompt += `\n\n--- LIVE URL CAPTURE ---\n${urlNote}\n--- END LIVE URL CAPTURE ---`;
  }

  // Fetch secret key names for this project (names only, never values)
  if (userId) {
    try {
      const secrets = await db
        .select({ label: secretsTable.label })
        .from(secretsTable)
        .where(and(
          eq(secretsTable.userId, userId),
          eq(secretsTable.projectId, projectId)
        ));
      const secretKeys = secrets.map(s => s.label);
      if (secretKeys.length > 0) {
        systemPrompt += `\n\n--- SECRETS VAULT (key names only — values are encrypted and never exposed) ---\nThis project has these secrets stored: ${secretKeys.join(", ")}\nWhen a build step requires one of these keys, confirm it's already stored rather than asking the user to find it.`;
      }
    } catch { /* secrets unavailable */ }
  }

  try {
    const recentErrors = await db.execute(sql`
      SELECT app_name, message, stack, url, severity, created_at
      FROM error_reports
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const errorRows = Array.isArray(recentErrors) ? recentErrors : (recentErrors as any).rows ?? [];
    if (errorRows.length > 0) {
      const errorSummary = errorRows.map((e: any) =>
        `[${e.severity?.toUpperCase() ?? "ERROR"}] ${e.app_name ? e.app_name + ": " : ""}${e.message}${e.url ? " (at " + e.url + ")" : ""}${e.stack ? "\n  " + String(e.stack).split("\n").slice(0, 3).join("\n  ") : ""}`
      ).join("\n\n");
      systemPrompt += `\n\n--- RECENT RUNTIME ERRORS (last ${errorRows.length}) ---\n${errorSummary}\nIf the user mentions something broken, cross-reference these errors first before asking them to describe the problem.\n--- END RECENT ERRORS ---`;
    }
  } catch {
    // error fetch failed silently — continue without it
  }

  // ── Build-verify intercept for StackBlitz repos ──────────────────────────
  // When [FILE_COMMITTED] arrives for a StackBlitz-hosted project, run a
  // server-side build check (clone → install → npm run build) and append the
  // result to the user message before Claude sees it. Atlas then acts on
  // [BUILD_VERIFY] immediately — fixing errors or announcing success.
  let buildVerifyAppend = "";
  const isStackBlitzProject = !!(project?.previewUrl?.includes("stackblitz.com") && project?.linkedRepo);

  if (message.includes("[FILE_COMMITTED]") && isStackBlitzProject) {
    const priorAttempts = (history as Array<{ role: string; content: string }>).filter(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("[FILE_COMMITTED]"),
    ).length;

    if (priorAttempts >= 3) {
      buildVerifyAppend =
        "\n\n[BUILD_VERIFY: max_attempts_reached]\nThe build has failed 3 consecutive times. Stop auto-fixing. Show the user the last error and ask for their direction.";
    } else {
      writeStep(res, { verb: "Checking", target: "build", phase: "execute" });
      const ghToken = resolvedGithubToken ?? process.env.GITHUB_TOKEN ?? "";
      if (ghToken) {
        try {
          const parsed = JSON.parse(project!.linkedRepo ?? "null") as string | { fullName?: string } | null;
          const repoFullName = typeof parsed === "string" ? parsed : (parsed?.fullName ?? "");
          if (repoFullName) {
            const result = await runBuildCheck(repoFullName, ghToken);
            if (result.clean) {
              const fixCount = priorAttempts;
              buildVerifyAppend =
                `\n\n[BUILD_VERIFY: clean]\nBuild passed in ${Math.round(result.duration / 1000)}s. The app compiles without errors.` +
                (fixCount > 0 ? ` You auto-resolved ${fixCount} error(s) across prior attempts.` : "");
            } else {
              const errorList = result.errors.join("\n");
              buildVerifyAppend =
                `\n\n[BUILD_VERIFY: errors found]\nBuild failed (attempt ${priorAttempts + 1}/3). Fix ALL errors using FILE_EDIT blocks. Do not explain — just emit the fixes. The next push will re-verify.\n\nErrors:\n${errorList}`;
            }
          }
        } catch (bvErr) {
          logger.warn({ err: bvErr }, "build-check failed — skipping verify");
          buildVerifyAppend =
            "\n\n[BUILD_VERIFY: check_failed]\nThe build check could not run. Acknowledge the push and continue.";
        }
      }
    }
  }

  // ── Build message history for multi-model dispatcher ─────────────────────
  type TextBlock = { type: "text"; text: string };
  type ImageBlock = {
    type: "image";
    source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
  };

  // Combine vault images + user-attached image + text into a single content array
  const contentParts: Array<TextBlock | ImageBlock> = [];

  // 1. Vault images first (visual context Atlas should have before reading the message)
  for (const vb of vault.imageBlocks) {
    // Skip vault images that exceed Claude's dimension limit
    const vaultImage = { base64: vb.source.data };
    if (vaultImage.base64 && vaultImage.base64.length > MAX_VAULT_B64_SIZE) {
      console.warn(`Vault image skipped — too large: ${vaultImage.base64.length} chars`);
      continue;
    }
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: vb.source.media_type, data: vb.source.data },
    } as ImageBlock);
  }

  // 2. Live URL screenshots (captured from URLs detected in this message)
  for (const ub of urlBlocks) {
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: ub.source.media_type, data: ub.source.data },
    } as ImageBlock);
  }

  // 3. User-attached images (attachments array — supports multiple)
  for (const att of allAttachments) {
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: att.base64 },
    } as ImageBlock);
  }

  // 3. User text (with optional build-verify result appended)
  contentParts.push({ type: "text", text: message + buildVerifyAppend });

  const userContent: string | Array<TextBlock | ImageBlock> =
    contentParts.length === 1 ? message : contentParts;

  const dispatchMessages: Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }> = [
    ...(history || []).map((h: { role: string; content: string }) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userContent },
  ];

  if (!isFlowMode && !isScenarioMode) {
    try {
      await db.insert(chatMessagesTable).values({
        sessionId,
        role: "user",
        content: message,
        intentType: body.mode ?? null,
      });
    } catch (dbErr: any) {
      const errMsg = dbErr?.message ?? "";
      const isMissingColumn = errMsg.includes("column") && errMsg.includes("does not exist");
      if (isMissingColumn) {
        logger.warn({ dbErr: errMsg }, "DB schema behind on user message insert — falling back to core insert");
        await db.insert(chatMessagesTable).values({
          sessionId,
          role: "user",
          content: message,
          intentType: null,
        });
      } else {
        throw dbErr;
      }
    }
  }

  // Auto-name: on first message, generate a real project name from the user's intent.
  const isFirstMessage = history.length <= 2;
  const autoNamePromise: Promise<string | undefined> =
    !isFlowMode && !isScenarioMode && isFirstMessage && DEFAULT_NAMES.has((project?.name ?? "").trim())
      ? (async () => {
          try {
            const nameResp = await anthropic.messages.create({
              model: "claude-haiku-4-5",
              max_tokens: 20,
              messages: [{
                role: "user",
                content: `Based on this first message from a user, generate a project name.\nRules:\n- 3-5 words maximum\n- Title case\n- Descriptive of what's being built\n- No punctuation\n- No generic words like "Project" or "App" unless essential\n\nUser message: "${message.slice(0, 300)}"\n\nRespond with only the project name, nothing else.`,
              }],
            });
            const raw = nameResp.content[0]?.type === "text" ? nameResp.content[0].text.trim() : "";
            const cleaned = raw.replace(/["""''`]/g, "").replace(/[.!?]$/, "").trim();
            if (cleaned && cleaned.split(/\s+/).length <= 6) {
              return cleaned;
            }
          } catch { /* non-fatal — original name stays */ }
          return undefined;
        })()
      : Promise.resolve(undefined);

  const generatedAutoName = await autoNamePromise;
  if (generatedAutoName && project) {
    systemPrompt = systemPrompt.replace(
      project.name,
      generatedAutoName
    );
    // Also update the ACTIVE PROJECT block if present
    systemPrompt = systemPrompt.replace(
      `Project name: ${project.name}`,
      `Project name: ${generatedAutoName}`
    );
  }

  writeStep(res, { verb: "Analyzing", target: "your request", phase: "analyze" });
  let modelResult: Awaited<ReturnType<typeof callModel>>;
  try {
    modelResult = await callModel(activeModel, systemPrompt, dispatchMessages, allAttachments[0]);
  } catch (modelErr: unknown) {
    logger.error({ err: modelErr }, "callModel failed — sending error event to client");
    const isOverload = String(modelErr).includes("overloaded") || String(modelErr).includes("529");
    const errorMsg = isOverload
      ? "Atlas is under heavy load right now. Wait a moment and try again."
      : "Something went wrong on our end. Please try again.";
    res.write(`data: ${JSON.stringify({ type: "error", content: errorMsg })}\n\n`);
    res.end();
    return;
  }
  let rawContent = modelResult.content;
  let assistantUsage = modelResult.usage;
  let modelUsed = modelResult.model;
  let terminalCmd: ChatTerminalCommand | null = null;
  let terminalResult: ChatTerminalResult | null = null;

  // FILE_READ intercept — Atlas requested specific files; fetch them and call model again
  if (repoData?.fullName && resolvedGithubToken) {
    const { paths: readPaths, cleanedContent: readCleanedContent } = extractFileReadRequest(rawContent);
    if (readPaths.length > 0) {
      try {
        const fetchedFiles = await Promise.all(
          readPaths.map(async (fp) => {
            try {
              const r = await fetch(
                `${GH_API}/repos/${repoData!.fullName}/contents/${fp}?ref=${repoData!.defaultBranch ?? "main"}`,
                { headers: ghHeaders(resolvedGithubToken!) }
              );
              if (!r.ok) return null;
              const d = await r.json() as { encoding?: string; content?: string };
              if (d.encoding !== "base64" || !d.content) return null;
              const fileContent = Buffer.from(d.content.replace(/\n/g, ""), "base64").toString("utf-8");
              const lines = fileContent.split("\n");
              const truncated = lines.length > 600;
              return {
                path: fp,
                content: truncated ? lines.slice(0, 600).join("\n") : fileContent,
                truncated,
                lineCount: lines.length,
              };
            } catch { return null; }
          })
        );
        const validFiles = fetchedFiles.filter(
          (f): f is { path: string; content: string; truncated: boolean; lineCount: number } => f !== null
        );
        if (validFiles.length > 0) {
          validFiles.forEach((file) => addKnownPreviousContent(previousContentByPath, file));
          const filesSummary = validFiles
            .map(f => `=== ${f.path}${f.truncated ? ` [first 600 of ${f.lineCount} lines]` : ""} ===\n${f.content}`)
            .join("\n\n");
          const followUpMessages: Array<{ role: "user" | "assistant"; content: string }> = [
            ...dispatchMessages as Array<{ role: "user" | "assistant"; content: string }>,
            { role: "assistant", content: readCleanedContent },
            {
              role: "user",
              content: `[FILES REQUESTED BY YOU]\n\n${filesSummary}\n\n[END FILES]\n\nYou asked to read these files. Now proceed — build, fix, or answer using the content above. Do not ask for more files unless absolutely necessary.`,
            },
          ];
          modelResult = await callModel(activeModel, systemPrompt, followUpMessages, undefined);
          rawContent = modelResult.content;
          assistantUsage = mergeUsage(assistantUsage, modelResult.usage);
          modelUsed = modelResult.model;
        }
      } catch { /* Non-fatal — keep rawContent from first call */ }
    }
  }

  // Agentic terminal loop — executes TERMINAL_CMDs and feeds results back to the model,
  // enabling Atlas to chain: run → see → fix → verify without waiting for user input.
  // Max 8 iterations to prevent runaway loops.
  {
    const AGENTIC_MAX = 8;
    const agentConversation: Array<{ role: "user" | "assistant"; content: string }> = [
      ...(dispatchMessages as Array<{ role: "user" | "assistant"; content: string }>),
    ];
    const collectedParts: string[] = [];

    for (let iter = 0; iter < AGENTIC_MAX; iter++) {
      const cmdExtraction = extractTerminalCommand(rawContent);

      if (!cmdExtraction.terminalCmd) {
        collectedParts.push(cleanTerminalTags(cmdExtraction.content));
        break;
      }

      const iterContent = cmdExtraction.content;
      collectedParts.push(iterContent);

      try {
        const executed = await runChatTerminalCommand(cmdExtraction.terminalCmd, projectId, userId);
        terminalCmd = executed.terminalCmd;
        terminalResult = executed.terminalResult;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Terminal command failed";
        terminalCmd = { command: cmdExtraction.terminalCmd.command, tier: cmdExtraction.terminalCmd.tier ?? 3, reason: errMsg };
        terminalResult = { command: cmdExtraction.terminalCmd.command, output: errMsg, exitCode: null, tier: cmdExtraction.terminalCmd.tier ?? 3 };
      }

      if (!terminalResult || iter >= AGENTIC_MAX - 1) break;

      agentConversation.push({ role: "assistant", content: iterContent });
      agentConversation.push({
        role: "user",
        content: `[TERMINAL_RESULT]\nCommand: ${terminalResult.command}\nExit code: ${terminalResult.exitCode ?? "null"}\nOutput:\n${terminalResult.output.slice(0, 4000)}\n[/TERMINAL_RESULT]\n\nAnalyze the result. If it passed, proceed to the next step. If it failed, fix it and verify. Do not ask for permission — just continue.`,
      });

      try {
        const next = await callModel(activeModel, systemPrompt, agentConversation, undefined);
        rawContent = next.content;
        assistantUsage = mergeUsage(assistantUsage, next.usage);
        modelUsed = next.model;
      } catch {
        break;
      }
    }

    rawContent = collectedParts.join("\n\n");
  }

  // Extract and strip IMAGE_GEN tokens — Atlas signals which images to generate and in what mode
  const IMAGE_GEN_RE = /^IMAGE_GEN:\s*(\{[^\n]+\})\s*$/gm;
  type ImageGenToken = { prompt: string; mode: "render" | "schematic"; size?: "square" | "landscape" | "portrait" };
  const imageGenTokens: ImageGenToken[] = [];
  rawContent = rawContent.replace(IMAGE_GEN_RE, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json) as ImageGenToken;
      if (parsed.prompt && (parsed.mode === "render" || parsed.mode === "schematic")) {
        imageGenTokens.push(parsed);
        writeStep(res, { verb: "Generating", target: "render", phase: "render" });
      }
    } catch { /* ignore malformed tokens */ }
    return "";
  }).trim();

  // Auto-inject IMAGE_GEN if user asked for an image but Atlas didn't emit the token
  // This prevents the AI from ignoring the image generation instruction
  logger.info({ rawTokens: imageGenTokens.length, messageMatched: IMAGE_REQUEST_RE.test(message), message }, "image gen debug");
  if (imageGenTokens.length === 0 && IMAGE_REQUEST_RE.test(message)) {
    const autoPrompt = message.replace(/\b(generate|create|make|draw|sketch|visualize|design|mock.?up|wireframe|show me|build me)\b/gi, "").trim();
    const mode = /\b(diagram|flow|chart|wireframe|architecture|schematic|structure|map|system)\b/i.test(message) ? "schematic" : "render";
    const size = /\b(wide|landscape|desktop|banner|hero)\b/i.test(message) ? "landscape" : /\b(mobile|phone|portrait|tall|vertical)\b/i.test(message) ? "portrait" : "square";
    imageGenTokens.push({ prompt: autoPrompt || message, mode, size });
    logger.info({ autoPrompt, mode, size, autoInjected: true }, "image gen auto-injected");
    writeStep(res, { verb: "Auto-generating", target: "image", phase: "render" });
  }

  // Extract and strip BROWSER_VISIT tokens — Atlas requests browser visits at end of response
  const BROWSER_VISIT_RE = /^BROWSER_VISIT:\s*(\{[^\n]+\})\s*$/gm;
  type BrowserVisitToken = { url: string; mode: "screenshot" | "scrape" | "health" | "monitor" };
  let browserVisitToken: BrowserVisitToken | null = null;
  rawContent = rawContent.replace(BROWSER_VISIT_RE, (_match, json: string) => {
    if (!browserVisitToken) {
      try {
        const parsed = JSON.parse(json) as BrowserVisitToken;
        if (parsed.url && (parsed.mode === "screenshot" || parsed.mode === "scrape" || parsed.mode === "health" || parsed.mode === "monitor")) {
          browserVisitToken = parsed;
          writeStep(res, { verb: parsed.mode === "scrape" ? "Analyzing" : "Visiting", target: parsed.url, phase: "execute" });
        }
      } catch { /* ignore malformed tokens */ }
    }
    return "";
  }).trim();

  // Auto-inject BROWSER_VISIT monitor after FILE_COMMITTED when project has a known live URL.
  // Skip when the user has a Vercel connection — in that case the /api/deploy/after-push endpoint
  // waits for the deploy to reach "ready" before running visual QA, so visiting immediately would
  // capture the mid-deploy state. Fall back to immediate visit only when no Vercel integration
  // is configured (e.g. projects hosted on Railway, Render, or a custom domain).
  // Skip browser monitor for StackBlitz projects — build-check already ran server-side above.
  if (!browserVisitToken && message.includes("[FILE_COMMITTED]") && project?.previewUrl && !hasVercelConnection && !isStackBlitzProject) {
    browserVisitToken = { url: project.previewUrl, mode: "monitor" };
    writeStep(res, { verb: "Visiting", target: project.previewUrl, phase: "execute" });
  }
  // When Vercel IS configured and the message signals that the deploy is now confirmed ready,
  // run the post-deploy health check against the live URL.
  if (!browserVisitToken && message.includes("DEPLOY_READY_VISIT:") && project?.previewUrl) {
    browserVisitToken = { url: project.previewUrl, mode: "monitor" };
    writeStep(res, { verb: "Visiting", target: project.previewUrl, phase: "execute" });
  }

  // Extract and strip CLARIFY blocks — Atlas asks structured follow-up questions when blocked
  type ClarifyPayload = {
    steps: Array<{
      question: string;
      options: string[];
      allowFreeText?: boolean;
    }>;
  };
  const CLARIFY_RE = /(?:^|\n)CLARIFY_START\s*([\s\S]*?)\s*CLARIFY_END(?:\n|$)/;
  const isClarifyPayload = (value: unknown): value is ClarifyPayload => {
    if (!value || typeof value !== "object") return false;
    const steps = (value as { steps?: unknown }).steps;
    return Array.isArray(steps) && steps.every((step) => {
      if (!step || typeof step !== "object") return false;
      const candidate = step as { question?: unknown; options?: unknown; allowFreeText?: unknown };
      return typeof candidate.question === "string"
        && Array.isArray(candidate.options)
        && candidate.options.every((option) => typeof option === "string")
        && (candidate.allowFreeText === undefined || typeof candidate.allowFreeText === "boolean");
    });
  };
  let clarify: ClarifyPayload | undefined;
  const clarifyMatch = rawContent.match(CLARIFY_RE);
  if (clarifyMatch) {
    try {
      const parsed = JSON.parse(clarifyMatch[1].trim()) as unknown;
      if (isClarifyPayload(parsed)) {
        clarify = parsed;
        rawContent = rawContent.replace(clarifyMatch[0], "\n").trim();
      }
    } catch { /* leave malformed clarification blocks visible */ }
  }

  // Parse: LINE_PATCHes → FILE_EDITs → MEMORY_Tn → NODE_RESOLVED → INTENT_TYPE → MEMORY_CHIPS
  const { visibleContent: afterPatches, linePatches } = extractAllLinePatches(rawContent);
  const { visibleContent, fileEdits } = extractAllFileEdits(afterPatches);
  const parsedConfidenceAssessment = extractConfidenceAssessment(visibleContent);
  const hasProposedFileChanges = fileEdits.length > 0 || linePatches.length > 0;
  const confidenceAssessment = normalizeConfidenceAssessmentForFileChanges({
    assessment: parsedConfidenceAssessment,
    fileEdits,
    linePatches,
    repoFiles,
  });
  const fileChangesAllowed = !hasProposedFileChanges || canProceedWithFileChanges({
    fileEdits,
    linePatches,
    repoFiles,
  });
  const { content: afterMemory, newFacts } = extractMemoryLines(visibleContent);
  const { content: afterNodeResolved, resolvedNodes } = extractNodeResolved(afterMemory);
  const { content: afterIntent, intentType: detectedIntentType } = extractIntentType(afterNodeResolved);
  const { content: finalContent, memoryChips: aiMemoryChips } = detectMemoryChips(afterIntent);

  // Auto-match ledger entries referenced in the response
  const entryChipStrings = matchEntryChips(
    finalContent,
    entries as Array<{ id: number; title: string; status: string }>
  );
  const entryChipRich: MemoryChipRich[] = entryChipStrings.map((s) => ({ label: s }));
  const seenLabels = new Set<string>();
  const allChips: MemoryChipRich[] = [];
  for (const c of [...aiMemoryChips, ...entryChipRich]) {
    if (!seenLabels.has(c.label)) {
      seenLabels.add(c.label);
      allChips.push(c);
    }
    if (allChips.length >= 6) break;
  }

  // Persist updated memory to DB — skipped in scenario mode (no commitment)
  if (!isScenarioMode && (newFacts.length > 0 || retrievedIds.length > 0)) {
    const updatedStore = newFacts.length > 0
      ? appendMemoryFacts(store, newFacts, now)
      : store;
    await db
      .update(projectsTable)
      .set({ memory: JSON.stringify(updatedStore) })
      .where(eq(projectsTable.id, projectId));
  }
  if (!isScenarioMode && userId && userStore && userRetrievedIds.length > 0) {
    await db
      .update(usersTable)
      .set({ memory: JSON.stringify(userStore) } as any)
      .where(eq(usersTable.id, userId));
  }

  // Extract FLOW_NODE lines before persisting
  const { content: flowStripped, flowNodes } = extractFlowNodes(finalContent);
  let displayContent = isFlowMode ? flowStripped : finalContent;
  if (hasProposedFileChanges && !fileChangesAllowed) {
    const approvalMessage = confidenceAssessment
      ? confidenceAssessment.confidence === "low" || confidenceAssessment.blast_radius === "wide"
        ? "I need explicit approval before making these changes. The risk is high enough that I recommend breaking this into smaller steps first."
        : "I need explicit approval before making these changes."
      : "I need to provide a confidence assessment before proposing file changes. Please ask me to restate the scope and confidence first.";
    displayContent = `${displayContent}\n\n${approvalMessage}`.trim();
  }
  // Extract PROACTIVE_ALERT token (strip from content before DB persistence)
  const PROACTIVE_ALERT_RE = /\nPROACTIVE_ALERT:(\{[^\n]*\})\s*$/;
  let alertPayload: { type: string; headline: string; detail: string; action: string } | null = null;
  const alertMatch = displayContent.match(PROACTIVE_ALERT_RE);
  if (alertMatch) {
    try { alertPayload = JSON.parse(alertMatch[1]); } catch { /* ignore malformed */ }
    displayContent = displayContent.replace(PROACTIVE_ALERT_RE, "").trim();
  }
  // Strip LENS_DRIFT token before DB persistence (it's a client-side signal only)
  const persistContent = displayContent.replace(/\n?LENS_DRIFT:\s*(flow|build|look|scenario)\s*$/i, "").trim();
  const surface = detectSurfaceSignal({
    content: persistContent,
    userMessage: message,
    recentMessages: history,
  });
  const responsePlan = buildResponsePlan({
    content: displayContent,
    workspaceLens,
    confidenceAssessment,
    fileEdits: fileChangesAllowed ? fileEdits : [],
    linePatches: fileChangesAllowed ? linePatches : [],
  });

  if (generatedAutoName) {
    await db.update(projectsTable).set({ name: generatedAutoName }).where(eq(projectsTable.id, projectId));
  }
  const responseFileEdits = fileChangesAllowed ? fileEdits : [];
  const responseLinePatches = fileChangesAllowed ? linePatches : [];

  // Dual-engine image generation — process IMAGE_GEN tokens Atlas emitted.
  // Must run BEFORE the DB insert so image data is available when we persist.
  // RENDER mode → Gemini Imagen 3  (cinematic, premium, client-facing)
  // SCHEMATIC mode → DALL·E 3       (technical diagrams, architecture maps)
  // Each engine has an automatic fallback to the other if its key is missing or fails.
  interface GeneratedImageResult { imageUrl: string; prompt: string; model: string; mode: "render" | "schematic"; }
  let imageGenResult: { images: GeneratedImageResult[] } | undefined;

  if (!isFlowMode && imageGenTokens.length > 0) {
    const generatedImages: GeneratedImageResult[] = [];
    const sizeMap = { square: "1024x1024" as const, landscape: "1792x1024" as const, portrait: "1024x1792" as const };

    for (const token of imageGenTokens.slice(0, 2)) {
      const enginePrompt = token.mode === "render"
        ? `${token.prompt} Ultra-premium, cinematic quality. Sleek dark-mode aesthetic with obsidian depth, luxury glassmorphism elements, subtle amber/gold accent glows. Sophisticated editorial lighting, presentation-ready professional finish. 8K resolution quality.`
        : `${token.prompt} Clean flat 2D technical diagram. High-contrast dark background, crisp connector lines, strict geometric layout, precise spatial placement, sharp labels. Pure structural accuracy.`;
      const aspectRatio = token.size === "landscape" ? "16:9" : token.size === "portrait" ? "9:16" : "1:1";

      if (token.mode === "render") {
        // Primary: Imagen 3
        let placed = false;
        try {
          const r = await genai.models.generateImages({ model: "imagen-3.0-generate-004", prompt: enginePrompt, config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio } });
          const bytes = r.generatedImages?.[0]?.image?.imageBytes;
          if (bytes) {
            const b64 = typeof bytes === "string" ? bytes : Buffer.from(bytes as Uint8Array).toString("base64");
            generatedImages.push({ imageUrl: `data:image/jpeg;base64,${b64}`, prompt: enginePrompt, model: "imagen-3", mode: token.mode });
            placed = true;
          }
        } catch (err) { logger.warn({ err }, "Imagen 3 failed for render — trying DALL·E fallback"); }
        // Fallback 1: DALL·E 3
        if (!placed && process.env.OPENAI_API_KEY) {
          try {
            const r = await openaiClient.images.generate({ model: "dall-e-3", prompt: enginePrompt, n: 1, size: sizeMap[token.size ?? "square"], response_format: "b64_json" });
            const b64 = r.data?.[0]?.b64_json;
            if (b64) generatedImages.push({ imageUrl: `data:image/png;base64,${b64}`, prompt: r.data?.[0]?.revised_prompt ?? enginePrompt, model: "dall-e-3", mode: token.mode });
          } catch (err) { logger.warn({ err }, "DALL·E fallback failed for render — trying Gemini Flash"); }
        }
        // Fallback 2: Gemini Flash image generation
        if (!placed) {
          try {
            const r = await genai.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: enginePrompt,
              config: { responseModalities: ["IMAGE", "TEXT"] },
            });
            const parts = r.candidates?.[0]?.content?.parts ?? [];
            const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
            const textPart = parts.find((p: any) => p.text);
            if (imagePart?.inlineData?.data) {
              generatedImages.push({
                imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
                prompt: textPart?.text ?? enginePrompt,
                model: "gemini-2.5-flash-image",
                mode: token.mode,
              });
              placed = true;
            }
          } catch (err) { logger.error({ err }, "Gemini Flash fallback failed for render"); }
        }
      } else {
        // Primary: DALL·E 3
        let placed = false;
        if (process.env.OPENAI_API_KEY) {
          try {
            const r = await openaiClient.images.generate({ model: "dall-e-3", prompt: enginePrompt, n: 1, size: sizeMap[token.size ?? "square"], response_format: "b64_json" });
            const b64 = r.data?.[0]?.b64_json;
            if (b64) {
              generatedImages.push({ imageUrl: `data:image/png;base64,${b64}`, prompt: r.data?.[0]?.revised_prompt ?? enginePrompt, model: "dall-e-3", mode: token.mode });
              placed = true;
            }
          } catch (err) { logger.warn({ err }, "DALL·E 3 failed for schematic — trying Imagen 3"); }
        }
        // Fallback 1: Imagen 3
        if (!placed) {
          try {
            const r = await genai.models.generateImages({ model: "imagen-3.0-generate-004", prompt: enginePrompt, config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio } });
            const bytes = r.generatedImages?.[0]?.image?.imageBytes;
            if (bytes) {
              const b64 = typeof bytes === "string" ? bytes : Buffer.from(bytes as Uint8Array).toString("base64");
              generatedImages.push({ imageUrl: `data:image/jpeg;base64,${b64}`, prompt: enginePrompt, model: "imagen-3", mode: token.mode });
              placed = true;
            }
          } catch (err) { logger.warn({ err }, "Imagen 3 fallback failed for schematic — trying Gemini Flash"); }
        }
        // Fallback 2: Gemini Flash image generation
        if (!placed) {
          try {
            const r = await genai.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: enginePrompt,
              config: { responseModalities: ["IMAGE", "TEXT"] },
            });
            const parts = r.candidates?.[0]?.content?.parts ?? [];
            const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
            const textPart = parts.find((p: any) => p.text);
            if (imagePart?.inlineData?.data) {
              generatedImages.push({
                imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
                prompt: textPart?.text ?? enginePrompt,
                model: "gemini-2.5-flash-image",
                mode: token.mode,
              });
            }
          } catch (err) { logger.error({ err }, "Gemini Flash fallback failed for schematic"); }
        }
      }
    }

    if (generatedImages.length > 0) imageGenResult = { images: generatedImages };
  }

  // Persist assistant message — image generation runs first so imageB64 is available
  let savedMsgId: number | undefined;
  let autoName: string | undefined;
  if (generatedAutoName) autoName = generatedAutoName;
  if (!isFlowMode && !isScenarioMode) {
    const firstImage = imageGenResult?.images?.[0];
    const imageB64Val = firstImage ? firstImage.imageUrl.split(",")[1] ?? null : null;
    const imageMimeTypeVal = firstImage
      ? (firstImage.imageUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png")
      : null;
    const runMetadata = runMetadataInsertValues(persistContent, fileChangesAllowed ? fileEdits : []);
    try {
      const [savedMsg] = await db
        .insert(chatMessagesTable)
        .values({
          sessionId,
          role: "assistant",
          content: persistContent,
          intentType: detectedIntentType,
          catchPayload: undefined,
          ...usageInsertValues(assistantUsage),
          ...runMetadata,
          imageB64: imageB64Val,
          imageMimeType: imageMimeTypeVal,
        })
        .returning();
      savedMsgId = savedMsg.id;
      // Persist image version record if an image was generated
      if (firstImage && savedMsg.id) {
        try {
          await db.insert(imageVersionsTable).values({
            sessionId,
            projectId,
            messageId: savedMsg.id,
            prompt: firstImage.prompt ?? message,
            imageB64: imageB64Val!,
            imageMimeType: imageMimeTypeVal ?? "image/png",
            model: firstImage.model ?? null,
            mode: firstImage.mode ?? null,
          });
        } catch (ivErr: any) {
          logger.warn({ err: ivErr?.message }, "image_versions insert failed — non-fatal");
        }
      }
      await db
        .update(sessionsTable)
        .set({
          messageCount: sql`${sessionsTable.messageCount} + 2`,
          ...runMetadata,
        })
        .where(eq(sessionsTable.id, sessionId));
    } catch (dbErr: any) {
      const errMsg = dbErr?.message ?? "";
      const isMissingColumn = errMsg.includes("column") && errMsg.includes("does not exist");
      if (isMissingColumn) {
        logger.warn({ dbErr: errMsg }, "DB schema behind — falling back to core insert without run metadata");
        const [savedMsg] = await db
          .insert(chatMessagesTable)
          .values({
            sessionId,
            role: "assistant",
            content: persistContent,
            intentType: detectedIntentType,
            catchPayload: undefined,
            imageB64: imageB64Val,
            imageMimeType: imageMimeTypeVal,
          })
          .returning();
        savedMsgId = savedMsg.id;
        await db
          .update(sessionsTable)
          .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
          .where(eq(sessionsTable.id, sessionId));
      } else {
        throw dbErr;
      }
    }
  }

  // Auto-create ledger entries for resolved nodes — skipped in scenario mode
  if (!isScenarioMode && resolvedNodes.length > 0) {
    try {
      await Promise.all(resolvedNodes.map(nodeId =>
        db.insert(entriesTable).values({
          projectId,
          sessionId,
          title: `${nodeId.charAt(0).toUpperCase() + nodeId.slice(1)} — decided`,
          summary: "Node resolved during Atlas conversation. Decision committed to map.",
          details: "Node resolved during Atlas conversation. Decision committed to map.",
          status: "committed",
          severity: "committed",
          mode: "decide",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ));
    } catch { /* non-fatal — map still updates even if ledger write fails */ }
  }

  const finalPayload = {
    content: displayContent,
    modelUsed,
    terminalCmd,
    terminalResult,
    surface,
    intentType: detectedIntentType ?? null,
    catchPayload: null,
    alertPayload: alertPayload ?? undefined,
    model: activeModel,
    memoryChips: allChips.length > 0 ? allChips : undefined,
    messageId: savedMsgId,
    memoryUpdated: newFacts.length > 0,
    confidenceAssessment: confidenceAssessment ?? undefined,
    fileEdits: responseFileEdits.length > 0 ? responseFileEdits : undefined,
    fileEdit: responseFileEdits.length > 0 ? responseFileEdits[0] : undefined,
    linePatches: responseLinePatches.length > 0 ? responseLinePatches : undefined,
    plan: responsePlan ?? undefined,
    resolvedNodes: resolvedNodes.length > 0 ? resolvedNodes : undefined,
    autoFetchedFiles: autoFetchedFiles.length > 0 ? autoFetchedFiles : undefined,
    ...(flowNodes.length > 0 ? { flowNodes } : {}),
    ...(clarify ? { clarify } : {}),
    ...(imageGenResult ? { imageGen: imageGenResult } : {}),
    ...(autoName ? { autoName } : {}),
  };

  // Execute BROWSER_VISIT token Atlas emitted — append result to final payload
  let browserVisitResult: { type: string; url: string; screenshotBase64?: string; analysis?: string; isHealthy?: boolean; issues?: string[] } | null = null;
  if (browserVisitToken) {
    const bvt = browserVisitToken as BrowserVisitToken;
    const endpointMap: Record<BrowserVisitToken["mode"], string> = {
      screenshot: "screenshot",
      scrape: "scrape",
      health: "health",
      monitor: "monitor",
    };
    const endpoint = endpointMap[bvt.mode];
    const bodyByMode: Record<BrowserVisitToken["mode"], Record<string, unknown>> = {
      screenshot: { url: bvt.url, analyze: true },
      scrape: { url: bvt.url, maxLength: 6000, analyze: true },
      health: { url: bvt.url },
      monitor: { url: bvt.url, checkResources: true },
    };
    writeStep(res, { verb: "Visiting", target: bvt.url, phase: "start" });
    try {
      const bvRes = await fetch(
        `${req.protocol}://${req.get("host")}/api/browser/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: req.headers.cookie ?? "" },
          body: JSON.stringify(bodyByMode[bvt.mode]),
          signal: AbortSignal.timeout(60_000),
        }
      );
      if (bvRes.ok) {
        const bvData = await bvRes.json() as {
          screenshotBase64?: string; analysis?: string; isHealthy?: boolean; issues?: string[];
          hasErrors?: boolean; consoleErrors?: string[]; resourceErrors?: string[]; errorPatterns?: string[]; summary?: string;
          title?: string; text?: string; headings?: string[];
        };
        browserVisitResult = {
          type: bvt.mode,
          url: bvt.url,
          ...(bvData.screenshotBase64 ? { screenshotBase64: bvData.screenshotBase64 } : {}),
          ...(bvData.analysis ? { analysis: bvData.analysis } : {}),
          ...(bvt.mode === "scrape" && bvData.title ? { title: bvData.title } : {}),
          ...(bvt.mode === "scrape" && bvData.headings ? { headings: (bvData.headings as string[]).slice(0, 6) } : {}),
          ...(bvt.mode === "health" && bvData.isHealthy !== undefined ? { isHealthy: bvData.isHealthy, issues: bvData.issues ?? [] } : {}),
          ...(bvt.mode === "monitor" ? {
            hasErrors: bvData.hasErrors ?? false,
            consoleErrors: bvData.consoleErrors ?? [],
            resourceErrors: bvData.resourceErrors ?? [],
            errorPatterns: bvData.errorPatterns ?? [],
            summary: bvData.summary ?? "",
          } : {}),
        };
        // Patch the finalPayload so the frontend gets it
        (finalPayload as Record<string, unknown>).browserResult = browserVisitResult;
      }
    } catch (err) {
      logger.warn({ err: String(err), url: bvt.url, mode: bvt.mode }, "BROWSER_VISIT execution failed");
    }
  }

  // Append browser visit analysis to the displayed message so users can read it in chat
  let fullText = displayContent;
  if (browserVisitResult) {
    const bv = browserVisitResult as {
      type: string; url: string; analysis?: string; isHealthy?: boolean;
      issues?: string[]; summary?: string; hasErrors?: boolean;
    };
    const lines: string[] = [];
    if (bv.type === "health") {
      const badge = bv.isHealthy ? "✅ Healthy" : `⚠️ ${bv.issues?.length ?? 0} issue(s) found`;
      lines.push(`**Site check — ${bv.url}**\n${badge}`);
      if (bv.issues?.length) lines.push(bv.issues.map(i => `- ${i}`).join("\n"));
      if (bv.analysis) lines.push(bv.analysis);
    } else if (bv.type === "monitor") {
      const badge = bv.hasErrors ? "⚠️ Errors detected" : "✅ No errors found";
      lines.push(`**Monitor — ${bv.url}**\n${badge}`);
      if (bv.summary) lines.push(bv.summary);
    } else if (bv.type === "scrape") {
      const bvScrape = bv as typeof bv & { title?: string; headings?: string[] };
      lines.push(`**${bvScrape.title ?? bv.url}**  \`${bv.url}\``);
      if (bv.analysis) lines.push(bv.analysis);
      if (bvScrape.headings && bvScrape.headings.length > 0) {
        lines.push(`**Key sections:** ${bvScrape.headings.slice(0, 6).join(" · ")}`);
      }
      // Attach structured researchResult so the frontend can render a card
      (finalPayload as Record<string, unknown>).researchResult = {
        type: "research",
        url: bv.url,
        title: bvScrape.title ?? bv.url,
        summary: bv.analysis ?? null,
        headings: bvScrape.headings ?? [],
      };
    } else if (bv.analysis) {
      lines.push(`**Screenshot — ${bv.url}**\n${bv.analysis}`);
    }
    if (lines.length > 0) fullText = fullText.trimEnd() + "\n\n" + lines.join("\n");
  }
  const inputTokenCount = assistantUsage.inputTokens;
  res.write(`data: ${JSON.stringify({ type: "done", ...finalPayload, content: fullText, imageGen: imageGenResult, developerLens: { routing: { activeModel: "claude-sonnet-4-6", provider: "anthropic", fallbackTriggered: false }, telemetry: { tokensPerSecond: 0, inputTokens: inputTokenCount ?? 0, executionStrategy: "standard" } } })}\n\n`);
  res.end();
  void recordGenerationRunInBackground({
    projectId,
    userId,
    prompt: message,
    model: modelUsed,
    startedAt: now,
    fileEdits: responseFileEdits,
    previousContentByPath,
  });
  if (userId) {
    void extractUserMemoryInBackground({
      userId,
      history,
      message,
      assistantReply: displayContent,
    }).catch((err) => {
      logger.warn({ err, userId }, "user memory extraction failed");
    });
  }
});

// ── Scenario keep — persist buffered scenario messages to session DB ──────────
router.post("/scenario-keep", async (req, res): Promise<void> => {
  const { sessionId, messages: msgs } = req.body as {
    sessionId: number;
    messages: Array<{ role: string; content: string }>;
  };
  if (!sessionId || !Array.isArray(msgs) || msgs.length === 0) {
    res.status(400).json({ error: "Missing sessionId or messages" });
    return;
  }
  // Verify session ownership: session → project → user
  const authUserId = (req as any).authUser?.id as number | undefined;
  const [sessionRow] = await db
    .select({ projectId: sessionsTable.projectId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!sessionRow) { res.status(404).json({ error: "Session not found" }); return; }
  const [projRow] = await db
    .select({ userId: projectsTable.userId })
    .from(projectsTable)
    .where(eq(projectsTable.id, sessionRow.projectId));
  if (!projRow || projRow.userId !== authUserId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const validMsgs = msgs
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(0, 100);
  if (validMsgs.length === 0) { res.json({ saved: 0 }); return; }
  await db.insert(chatMessagesTable).values(
    validMsgs.map(m => ({ sessionId, role: m.role as "user" | "assistant", content: m.content, intentType: null }))
  );
  await db.update(sessionsTable).set({ messageCount: sql`${sessionsTable.messageCount} + ${validMsgs.length}` }).where(eq(sessionsTable.id, sessionId));
  res.json({ saved: validMsgs.length });
});

// ── Quick Prompt generation ───────────────────────────────────────────────────
router.post("/quick-prompt", async (req, res) => {
  const { description, builder, images, fileContent, filePath, projectMap } = req.body as {
    description: string;
    builder: string;
    images?: Array<{ base64: string; mediaType: string }>;
    fileContent?: string;
    filePath?: string;
    projectMap?: string;
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

  const contextBlocks: string[] = [];
  if (projectMap) contextBlocks.push(`CODEBASE MAP:\n${projectMap.slice(0, 3000)}`);
  if (filePath) contextBlocks.push(`TARGET FILE PATH: ${filePath}`);
  if (fileContent) contextBlocks.push(`FILE CONTENT:\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\``);

  const userText = [
    contextBlocks.length > 0 ? contextBlocks.join("\n\n") : null,
    `INTENT: ${description}`,
    `PLATFORM: ${builder}`,
  ].filter(Boolean).join("\n\n");

  userContent.push({ type: "text", text: userText });

  const isCursorPlatform = builder === "Cursor";

  const platformPrompts: Record<string, string> = {
    Cursor: `You are Atlas — the strategic intelligence inside Axiom, built for a solo founder who builds production SaaS entirely on her phone using Cursor Agent.

Your sole job: read her intent and the file she provides, then write ONE surgical, ready-to-paste Cursor Agent prompt.

OUTPUT FORMAT — write the prompt in this exact order, no markdown headers, no bullet points, plain prose instructions:

1. Package install (ONLY if new packages are required): "Run \`pnpm add [package] --filter @workspace/[artifact]\` first."
2. File location: "In [exact/file/path.tsx]:"
3. The change — when file content is provided, quote the EXACT text (function name, line content, or surrounding lines) so Cursor can locate the spot with zero ambiguity. Describe the change in direct imperative language.
4. Scope guard: "Do not change anything else."
5. Verification: "Run typecheck, push to main."

RULES:
- Output ONLY the prompt. No preamble, no "Here is your prompt:", no explanation after.
- Quote actual lines from the provided file content — never write placeholder text like "[find X]"
- One file per prompt. If multiple files are affected, focus on the primary one and mention the others briefly.
- Keep it under 250 words. Cursor reads code, not essays.
- If no file content is provided, write the prompt using reasonable file path conventions for a React+Vite+Express pnpm monorepo, but note that exact line references are not available.
- Never reference "Atlas" or "Axiom" in the output — Cursor doesn't know what that is.`,

    Replit: `You are Atlas — the strategic intelligence inside Axiom. Generate a precise, ready-to-paste Replit Agent prompt.

Replit Agent is a fully autonomous AI coding agent that reads the codebase, writes files, installs packages, and runs commands. It works best with clear goals, explicit file references, and defined constraints.

OUTPUT FORMAT — plain prose, no bullet lists:
1. State the goal in one sentence: what should exist or work after this is done.
2. Name the exact files to create or modify (use paths from the codebase map if available).
3. Describe the implementation precisely — component structure, data flow, API shape, or UI behavior as needed.
4. State any constraints: what not to touch, what packages to use, what style patterns to follow.
5. End with: "Do not change anything else. Run typecheck when done."

RULES:
- Output ONLY the prompt. No preamble, no explanation after.
- Keep it under 300 words.
- Be specific. Replit Agent works autonomously — vague prompts produce wrong results.
- Never reference "Atlas" or "Axiom" in the output.`,

    Lovable: `You are Atlas — the strategic intelligence inside Axiom. Generate a precise, ready-to-paste Lovable prompt.

Lovable builds full-stack React SaaS apps. It understands features described as user stories, UI behaviors, and data requirements.

OUTPUT FORMAT — conversational but precise:
1. Describe the feature from the user's perspective: what they see, what they click, what happens.
2. Specify UI layout and component behavior precisely — where things appear, how they animate, what states they have.
3. Describe the data requirements: what gets saved, where it comes from, how it updates.
4. List constraints: what existing patterns to follow, what not to break.

RULES:
- Output ONLY the prompt. No preamble, no explanation after.
- Write in plain English. Lovable responds well to clear intent.
- Keep it under 300 words.
- Never reference "Atlas" or "Axiom" in the output.`,

    Bolt: `You are Atlas — the strategic intelligence inside Axiom. Generate a precise, ready-to-paste Bolt prompt.

Bolt builds full-stack web apps from scratch or iterates on existing ones. It works best with feature descriptions that include both the UI and the underlying logic.

OUTPUT FORMAT — feature-first, then details:
1. State what feature to build in one clear sentence.
2. Describe the UI: layout, components, states, interactions.
3. Describe the logic: what data it uses, how it's stored or fetched, what happens on actions.
4. State any tech constraints: specific libraries to use, patterns to follow.

RULES:
- Output ONLY the prompt. No preamble, no explanation after.
- Be explicit about both frontend appearance and backend behavior.
- Keep it under 300 words.
- Never reference "Atlas" or "Axiom" in the output.`,

    v0: `You are Atlas — the strategic intelligence inside Axiom. Generate a precise, ready-to-paste v0 prompt.

v0 generates React UI components using Tailwind CSS and shadcn/ui. It excels at visual, interactive components described with precise layout and state requirements.

OUTPUT FORMAT — component-first description:
1. Name the component and its purpose in one sentence.
2. Describe the visual layout in detail: structure, spacing, colors, typography, responsive behavior.
3. Describe interactive states: hover, active, loading, empty, error.
4. Specify any shadcn/ui components to use. List any custom behavior or callbacks.

RULES:
- Output ONLY the prompt. No preamble, no explanation after.
- Think visually — describe what you see, not just what it does.
- Keep it under 300 words.
- Never reference "Atlas" or "Axiom" in the output.`,

    Claude: `You are Atlas — the strategic intelligence inside Axiom. Generate a precise, ready-to-paste Claude prompt.

Claude handles complex, nuanced instructions with full context. It works best with structured prompts that include role, context, task, and output format.

OUTPUT FORMAT:
1. Role: tell Claude what it is and what it knows for this task.
2. Context: what the codebase looks like, what's already built, what the goal is.
3. Task: the exact thing to produce — code, analysis, plan, or explanation.
4. Output format: how the response should be structured.
5. Constraints: what to avoid, what to prioritize.

RULES:
- Output ONLY the prompt. No preamble, no explanation after.
- Give Claude full context — it processes long prompts well.
- Keep it under 400 words.
- Never reference "Atlas" or "Axiom" as the prompt author — write it as the user speaking directly.`,
  };

  const systemPrompt = platformPrompts[builder] ?? platformPrompts["Cursor"];

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const text = msg.content.find((b) => b.type === "text")?.text ?? "";
    res.send(text);
  } catch (err) {
    req.log?.error(err, "quick-prompt failed");
    res.status(500).json({ error: "Generation failed" });
  }
});

export default router;
