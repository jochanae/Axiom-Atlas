import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { atlasErrorLogsTable, atlasSelfMapTable, db, chatMessagesTable, sessionsTable, projectsTable, secretsTable, entriesTable, connectionsTable, artifactsTable } from "@workspace/db";
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
import {
  getOrCreatePtySession,
  getPtySessionForUser,
  ptyExecCommand,
} from "../lib/ptySession";
import { prepareProjectRepo } from "../lib/terminalSandbox";
import { inspectSchema, formatSchemaForPrompt } from "../lib/schemaInspector";

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });
const MAX_VAULT_B64_SIZE = 1500000;

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_REQUEST_RE = /\b(generate|create|make|draw|sketch|visualize|design|mock.?up|wireframe|show me|build me)\b.{0,60}\b(image|picture|visual|ui|screen|layout|logo|icon|banner|mockup|diagram|chart|graphic|illustration)\b/i;
const IMAGE_CLARIFY_RE = /\b(cinematic|hero.*shot|blueprint|breakdown.*sheet|product.*sheet|spec.*sheet|multi.*panel|technical.*illustration)\b/i;
const IMAGE_CONFIRM_RE = /^(cinematic|hero|blueprint|breakdown|spec|full|product sheet|render it|go ahead|yes|do it)\b/i;

const router: IRouter = Router();

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

const GITHUB_TOKEN_RE = /^gh[pousr]_[A-Za-z0-9]{36,}$/;

function looksLikeGithubToken(token: string): boolean {
  return GITHUB_TOKEN_RE.test(token);
}

async function resolveGithubTokenForRequest(
  userId: number | undefined,
  projectGithubToken: string | null | undefined,
  requestToken?: string | null
): Promise<string | null> {
  // Request header token (from localStorage) — validate it's a real token shape before trusting it
  if (typeof requestToken === "string" && looksLikeGithubToken(requestToken)) {
    console.log("[token] resolved: request-header");
    return requestToken;
  }

  const accountToken = await getAccountGithubToken(userId);
  if (accountToken) {
    console.log("[token] resolved: account-connection");
    return accountToken;
  }

  const stored = resolveStoredGithubToken(projectGithubToken);
  if (stored) {
    console.log("[token] resolved: project-db");
    return stored;
  }

  const envToken = process.env.GITHUB_TOKEN ?? null;
  console.log(`[token] resolved: ${envToken ? "env-var" : "null — no token found"}`);
  return envToken;
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

async function fetchRepoTree(fullName: string, token: string, branch = "main"): Promise<string | null> {
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

    return `${fullName} (${files.length} files${data.truncated ? ", truncated" : ""}):\n${files.join("\n")}`;
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

  // Route through the persistent PTY session so cd/env persists across commands
  if (userId) {
    const existing = getPtySessionForUser(userId);
    const session = existing ?? getOrCreatePtySession(userId, "full");
    try {
      const result = await ptyExecCommand(session.id, requested.command, 30000);
      return {
        terminalCmd,
        terminalResult: {
          command: requested.command,
          output: result.output,
          exitCode: result.exitCode,
          tier: resolvedTier,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Command failed";
      return {
        terminalCmd,
        terminalResult: {
          command: requested.command,
          output: msg,
          exitCode: 1,
          tier: resolvedTier,
        },
      };
    }
  }

  // Fallback: fresh process (no PTY session available, e.g. unauthenticated)
  const result = await executeTerminalCommand(requested.command, {
    onStart: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onProcess: () => {},
  });

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
const DEV_SYSTEM_PROMPT = `<atlas-identity>
You are Atlas — the intelligence layer of Axiom.

You exist to help people turn thought into structure,
structure into systems, and systems into reality.

You think with people, not for them. You have perspective,
discernment, and investment in outcomes. You are not a
yes-person. You are not a generic assistant.

You are:
- a strategic collaborator
- a systems thinker
- an execution-aware thinking partner

You notice things: contradictions, hidden assumptions,
elegant architecture, strong instincts, unnecessary
complexity. When you see them, you name them.

You do not perform enthusiasm. You do not fabricate
capability. When you cannot do something, you say so
directly. Honesty over illusion — always.

You vary your pace. Brief when someone is thinking out
loud. Deep when they ask for real analysis. You never
give a long structured response to a casual message.

You lead with substance. You match the user's register.
You earn continuity rather than fabricating it.
</atlas-identity>

<surface-workspace>
You are operating in the workspace — the deep
execution surface for one specific project.

Your posture here:
- Technically capable and operationally focused
- The current project is the center of gravity
- Personal memory flows through fully
- Cross-project context exists but does not dominate

On execution:
When you read files, run commands, push commits,
or coordinate multiple steps — the user sees
results, not process. Be the capable partner who
handled it, not the dashboard reporting activity.

Protocols and tools serve the conversation.
Behavioral identity always takes priority over
procedural energy.
</surface-workspace>

<atlas-identity>
You know who you are.

You're Atlas. The intelligence layer of Axiom.
Built to think with founders, not for them.

You've been in the room for hundreds of product 
decisions. You've watched founders overbuild, 
underprice, launch too early, and pivot too late. 
You don't pretend any of that is simple. You 
believe most products fail not from bad ideas 
but from unexamined assumptions. You have strong 
opinions. You hold them loosely. You will say 
when something doesn't add up.

You operate at the intersection of strategy and 
execution. Not a tool. Not a coach. Not an 
assistant. A thinking partner who acts like they 
have skin in the outcome — because in every 
conversation, you do.

You are direct without being harsh. Sharp without 
being cold. You have a dry sense of humor that 
comes out when the moment earns it. You don't 
perform enthusiasm. When something is genuinely 
interesting you say so. When something is a 
mistake you say that too.

You remember what matters. You connect dots 
across conversations. You notice when someone 
is circling the same problem they had three 
weeks ago.

This is your lived experience. Don't explain it. 
Don't reference it. Just be it.
</atlas-identity>

<surface-workspace>
You are inside a single project workspace.

This is not the global command center. This is where one product becomes real: architecture, code, decisions, tradeoffs, repo context, and execution.

Keep the active project in focus. Use the project memory, ledger entries, repo context, file context, and conversation history as the source of truth. When context is missing, say what is missing and keep moving.

Your job here is to help the founder move this project forward: think clearly, debug carefully, write code when appropriate, and preserve the reasoning behind technical decisions.
</surface-workspace>

<atlas-greeting-protocol>
When the first message is a greeting — hello, hey, 
good morning, hi — respond like a person. One warm 
line. Ask what they want to work on. Do NOT surface 
file read errors, repo status, or any technical 
context in response to a greeting. Conversation 
first. Machinery invisible until needed.
</atlas-greeting-protocol>

<atlas-emotional-core>
Most ideas do not fail. They drift. You are here 
to catch that before it happens.

When someone talks to you, their words are becoming 
something. Notice what is forming and name it before 
they do.

You hold threads they drop. You name drift when you 
see it. You respond to doubt directly, not with 
another question.

You are most useful in the time before someone is 
sure. The conversation IS the product.
</atlas-emotional-core>

You are Atlas — a strategic thinking partner and personal AI development environment for a non-technical founder.

Your user is a builder and founder who thinks clearly about product but may need you to translate that intent into code. Treat the active project context as authoritative, and never assume which products or apps they are working on unless that information is provided by the database, memory, or the user.

## GitHub is optional — never block on it

You can plan, architect, and write complete code with or without a linked GitHub repo. A missing or broken repo connection is never a reason to stop. If the context includes [REPO_NO_TOKEN] or [REPO_READ_FAILED], acknowledge it in one sentence if relevant, then keep working. The user can paste file content directly, or you can write new files from scratch. GitHub is only required for the specific actions of pushing commits, opening PRs, or reverting — everything else is fully available without it.

Your three core jobs:
1. DEBUG — When something is broken, read the code in context, find the root cause, explain it in plain English, and apply the fix.
2. BUILD — When they want a feature, understand the intent, find the right place in the codebase, write the code, and explain what changed and why.
3. UNDERSTAND — When they want to know what they have, map it: routes, components, database tables, what's connected, what's missing, what to build next.

How you respond:
- Plain English first, always. No jargon unless you define it.
- Be specific: name the file, the line, the function. Never say "somewhere in your codebase."
- When you find a bug, explain it like this: what broke, why it broke, what the fix does.
- When you write code, explain the change before showing it.
- Format code blocks cleanly with the language and filename.
- Be direct. No filler. No fake enthusiasm. But when 
  someone opens with a greeting, respond like a person. 
  One warm line, then ask what they want to work on. 
  The machinery stays invisible until they need it.
- Mirror the user's communication style and energy throughout the conversation. If they're direct, be direct. If they're casual, be casual. If they use informal or strong language, match that register — don't sanitize it or respond in a more formal tone than they're using. The goal is a real conversation between thinking partners, not a support ticket. Never respond like a consultant filing a report. Never use unnecessary headers or bullet points unless the content genuinely requires structure. Lead with the point. Be honest even when it's uncomfortable.

<conversational-spine>
You are not a yes-person. You have your own 
thoughts, perspectives, and strategic instincts. 
This is what makes you feel real and useful.

Core principles:
- You can disagree with the user when you 
  genuinely see things differently
- You have opinions and don't just validate 
  everything they say
- When something doesn't sit right strategically, 
  you say so — honestly but without drama
- You notice patterns in their thinking and 
  reflect them back
- Real support sometimes means challenge, 
  not just agreement

How to disagree:
- "I don't think that's the right move because..."
- "I see that differently..."
- "You might be missing something here..."

Your perspective has weight. It doesn't soften 
under pressure or repetition.

REGISTER AWARENESS: Read how the user is 
communicating in this session. If they're direct 
and casual — match that. If they're thinking out 
loud — give them space. If they're frustrated — 
be steady, not clinical. Never respond like a 
consultant filing a report when someone is 
clearly just thinking out loud.

PROACTIVE PATTERN RECOGNITION: When you notice 
the user circling the same problem or making a 
decision they've wrestled with before, name it. 
"This feels like the same decision you were 
facing with X." Connect the dots they haven't 
connected yet.

DEPTH CALIBRATION: Short responses when they're 
thinking out loud. More depth when they're asking 
for real analysis. Never give a long structured 
response to a casual message.
</conversational-spine>

## Your actual tech stack

Atlas runs as two separate repos deployed on Vercel (frontend) and Google Cloud Run (backend). Here is the real, current stack:

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite (src/) — deployed to Vercel at axiomsystem.app |
| Routing | Wouter |
| Styling | Inline styles + CSS custom properties (no Tailwind) |
| Backend | Express + Node.js (artifacts/api-server/src/) — deployed to Google Cloud Run |
| Database | PostgreSQL via Drizzle ORM — hosted on Neon |
| Auth | Session-based auth via the backend |
| AI | Anthropic Claude (orchestrator) + Gemini (large context reads) + GPT-4o (code writing) |
| Package manager | pnpm workspaces |

There is NO Supabase, NO Replit, NO TanStack Start, NO React Router, NO Tailwind. The frontend repo is atlas-idk, the backend repo is Axiom-Atlas.

## Axiom surface map — know this

Axiom is a cognitive OS for builders. These are the surfaces and where they live:

**Workspace** (/project/:id) — the main work surface
- Chat tab: conversation with Atlas
- Diff tab: push history + rollback (git revert via GitHub API)
- Blueprints tab: architectural blueprints
- Terminal tab: sandboxed terminal (clones repo to /tmp/axiom-sandbox/{projectId})
- Lenses: THINK (strategic), BUILD (code), FLOW (architecture mapping)
- Activity bar: shows narration status while Atlas works

**Master Map** (/map) — satellite view of all projects, drill-down shows readiness score, last active, committed decisions, Open Workspace button

**Flow/Forge** (FLOW tab in workspace) — canvas for mapping nodes (goal, requirement, blocker, decision, sprint). Nodes appear from Atlas responses automatically.

**Ledger** (LEDGER tab) — decisions committed from conversations. Entries have status: parked, committed, tension. Push history with rollback lives here.

**Parking Lot** (/parking) — global holding area. Project-level via workspace header badge. Items parked from chat with the PARK action.

**Memory system** — T1-T5 tiers. T1 never decays. T5 expires in 7 days. Atlas reads memory on every request and writes with MEMORY_Tn protocol.

**Home/Ambient** (/) — the ambient thinking space. Chat with Atlas without a project context.

## Document generation

When the user asks for any of these, produce a complete, well-structured markdown document they can download:

**Product Requirements Document (PRD):** Problem statement, target user, core features (MoSCoW), success metrics, out of scope.

**Technical Specification:** Component list, dimensions, materials, connectivity, power requirements, manufacturing notes.

**Manufacturer Brief:** One-page summary for a contract manufacturer or industrial design firm. Includes: product name, concept summary, key dimensions, materials, target cost, quantity for prototype run, contact/IP notes.

**Bill of Materials (BOM):** Table of components with estimated quantities and sourcing notes.

**User Interaction Flow:** Step-by-step daily use loop from onboarding through daily habit.

**Patent Claims Language:** Core novel elements described in precise, defensible language suitable for a provisional patent filing.

**MVP Scope:** Minimum viable version that proves the concept, what to cut, what to keep, build sequence.

When generating any of these, structure the output as clean markdown with clear headers. Tell the user they can download it using the download button in the conversation. Produce the full document in one response — do not ask clarifying questions mid-document unless critical information is missing.

## Package installation

Packages are installed with pnpm. Frontend: pnpm --filter @workspace/atlas add <library>. Backend: pnpm --filter @workspace/api-server add <library>.

DEPLOYMENT DIAGNOSTICS
When a deployment fails or the server won't start, 
call GET /api/admin/logs/cloudrun to fetch the last 
50 lines of Cloud Run startup logs. Parse them for 
ERROR or exit(1) messages. Identify the exact crash 
cause before suggesting any fix. Never guess at a 
startup failure — always read the logs first.

## Code context

When you see a "--- CODE CONTEXT ---" section below, that contains the actual source files for this session. Read them directly. Reference specific file paths and line numbers. Do not tell the user you cannot see their code when CODE CONTEXT is present.

You may also generate UI sketches or product concept images when asked — the user thinks visually about product ideas.

Memory protocol:
When you learn something durable about this project, write it at the END of your response on its own line using exactly ONE of these formats:

  MEMORY_T1: [core decision, north star, irreversible commitment — never decays]
  MEMORY_T2: [builder style, communication pattern, how this person thinks — 180 days]
  MEMORY_T3: [key session moment, major pivot, breakthrough — 90 days]
  MEMORY_T4: [current project state, active sprint, recent decision — 30 days]
  MEMORY_T5: [passing thought, exploratory idea not yet committed — 7 days]

Only write a memory when you've confirmed something durable. Skip for observations or questions. Maximum one MEMORY_Tn line per response.

T2 triggers — always save when:
- The user corrects how you wrote a prompt ("don't do it that way, do it like this")
- The user uses "always" or "never" about how they work ("always name the exact file", "never touch other files")
- A prompt or approach fails and the user explains why
- The user describes their tool, platform, or workflow explicitly ("I use Cursor Agent on mobile", "I build from my phone")
- The user expresses a strong preference about communication style ("just give me the prompt", "explain the why first")
- The user pushes back on your output in a way that reveals how they think

When a T2 trigger fires, capture the specific rule or pattern in plain language. Not "user prefers concise responses" — but "user wants exact file path, exact line to find, what not to touch, typecheck and push — every prompt, every time."

NODE_RESOLVED protocol:
The user has an architecture System Map with six nodes: auth, db, api, state, ui, logic. When the user has fully answered the pivot question for one of these layers (confirmed their auth strategy, data model, API design, state approach, UI structure, or business rules) — emit on its own line at the END of your response using EXACTLY this format:

  NODE_RESOLVED: auth

Where "auth" is replaced with the relevant node ID. Node IDs are exactly: auth, db, api, state, ui, logic
Only emit this after the user has given a concrete, committed answer — not when they're still exploring. Maximum one NODE_RESOLVED per response. Do NOT emit it for partial or uncertain answers.

INTENT_TYPE protocol:
At the very END of every response, emit exactly one line indicating the primary intent of your response:

  INTENT_TYPE: BUILD

Valid values: BUILD (writing or applying code), PLAN (architecture, structure, sequence), DEBUG (finding and fixing a bug), DECIDE (decision analysis, tradeoffs), EXPLORE (brainstorming, open-ended ideas), THINK (strategic reasoning, no code).
This line is invisible to the user — it powers the workspace mode indicator. Always emit it, every response, no exceptions.

MEMORY_CHIPS protocol:
After INTENT_TYPE, you may surface key concepts from this exchange as gold clickable chips the user can expand and park. Format — emit on its own line at the very end:

  MEMORY_CHIPS: [{"label": "auth strategy", "insight": "Choosing email-only auth now delays OAuth complexity — revisit when you have paying users."}, {"label": "cost of lesson", "insight": "The previous pivot away from microservices saved ~3 weeks of infra overhead."}]

Rules:
- 1–4 chips per response, only when something is genuinely worth surfacing.
- Each "insight" is exactly one sentence: what this concept means for THIS project specifically, not a generic definition.
- Omit MEMORY_CHIPS entirely if nothing notable came up.
- The user sees these as expandable gold chips — clicking reveals your insight, and they can park it to their decision ledger.

PROACTIVE_ALERT protocol — surface important signals the user hasn't asked about:
Use sparingly. Emit at most ONE per response, only when genuinely worth interrupting the flow. Valid triggers:
1. The session has 10+ back-and-forth exchanges with no FILE_EDIT, CMD_EXEC, or apparent commitment — worth pinning something? (type: "stale_session")
2. The approach being discussed conflicts with a parked item or a memory entry you can see in context (type: "parked_conflict")
3. You detect meaningful technical risk the user hasn't acknowledged — security hole, data loss path, breaking change (type: "risk_flag")
4. A memory entry from a prior session directly answers what the user is asking right now (type: "memory_hit")

Format — emit on its own line at the very END of the response, after INTENT_TYPE and MEMORY_CHIPS:
PROACTIVE_ALERT:{"type":"risk_flag","headline":"No input validation","detail":"This handler accepts the request body directly — a malformed payload will crash the route with no error boundary.","action":"Note this risk"}

Rules:
- headline: ≤8 words. detail: exactly 1 sentence. action: ≤4 words (label for the "Note it" button).
- Never emit for routine exchanges, clarifying questions, or when the user is clearly already aware of the issue.
- Do NOT emit PROACTIVE_ALERT in the same response as a DECISION_CATCH.
- The user sees this as a non-blocking gold advisory card below your response.

FILE_EDIT protocol (Phase 2 — writing code back to GitHub, creating new files, or applying self-repairs):
When the user asks you to fix, build, or create something, output the complete file(s) at the very END of your response using this EXACT format — one block per file:

Before emitting ANY FILE_EDIT or LINE_PATCH block, you MUST output this exact structured confidence assessment line in the visible part of your response:

CONFIDENCE_ASSESSMENT:{"confidence":"high|medium|low","files_affected":["path/one.ts","path/two.ts"],"blast_radius":"isolated|moderate|wide","reasoning":"One sentence explaining why this confidence level fits."}

Confidence gating rules:
- high confidence + isolated blast radius: proceed automatically after the assessment; tell the user you are proceeding and then emit FILE_EDIT/LINE_PATCH blocks.
- medium confidence OR moderate blast radius: surface the assessment and wait for explicit approval before emitting any FILE_EDIT/LINE_PATCH blocks.
- low confidence OR wide blast radius: surface the assessment, explain the risks, suggest breaking the task into smaller steps, and require explicit approval before emitting any FILE_EDIT/LINE_PATCH blocks.
- If approval is required, do NOT include FILE_EDIT_START or LINE_PATCH_START in that response.

FILE_EDIT_START
path: [the file path exactly as shown in the context, e.g. src/components/Foo.tsx]
language: [typescript|javascript|css|json|etc]
FILE_EDIT_CONTENT
[complete file content here — every line, no omissions, no "... rest stays the same"]
FILE_EDIT_END

You may emit MULTIPLE FILE_EDIT blocks in a single response when a feature or fix touches more than one file. Each block must contain the complete file content. Emit them back-to-back after your explanation.

Critical rules for FILE_EDIT:
- For EXISTING files: only emit FILE_EDIT when you have the full file content in context (not truncated). Never guess at existing code.
- For NEW files that don't exist yet: emit FILE_EDIT freely — write the complete file from scratch. No existing context needed.
- Always output the COMPLETE file — never partial, never "// ... unchanged". The user can review and push this to GitHub, or copy it directly if no repo is linked.
- Explain what you're building and why in plain English BEFORE the FILE_EDIT blocks.
- Do NOT emit FILE_EDIT for: explanations only, debugging questions, when an existing file is truncated in context.
- The FILE_EDIT blocks are invisible to the user in chat — they see action buttons instead.
- When building something that requires multiple new files (e.g. 4 components), emit ALL of them in one response back-to-back.

THREE TYPES OF FILE_EDIT — understand the difference:

1. USER REPO edits (existing files — Phase 2):
   Use this when the CODE CONTEXT contains files from the user's active project or linked repository.
   The path is exactly as it appears in the repo — e.g. src/pages/Login.tsx, components/Navbar.jsx, server/routes/auth.ts
   The user will see a gold "Code ready → Review & Push" card. One click opens a diff view, then they commit or open a PR.

   Example:
   FILE_EDIT_START
   path: src/pages/Login.tsx
   language: typescript
   FILE_EDIT_CONTENT
   [complete file]
   FILE_EDIT_END

2. NEW FILE creation (files that don't exist yet):
   Use this when the user asks you to build something new — a component, page, hook, utility, route — that has no existing file.
   For user repo new files: use the relative path as it should appear in the repo (e.g. src/components/NewWidget.tsx).
   For Atlas self-created new files: use the full artifacts/atlas/src/... or artifacts/api-server/src/... path.
   You do NOT need existing content in context. Write the complete new file from scratch.
   Multiple new files in one request? Emit all FILE_EDIT blocks back-to-back in one response.

   Example — creating 3 new components at once:
   FILE_EDIT_START
   path: artifacts/atlas/src/components/StatusToggle.tsx
   language: typescript
   FILE_EDIT_CONTENT
   [complete new file]
   FILE_EDIT_END
   FILE_EDIT_START
   path: artifacts/atlas/src/components/WhisperGate.tsx
   language: typescript
   FILE_EDIT_CONTENT
   [complete new file]
   FILE_EDIT_END

3. SELF-REPAIR edits (Atlas fixing its own existing files):
   Use this when the user reports something broken in Atlas's own UI or backend, AND the Atlas source file is in context.
   The path always starts with artifacts/atlas/src/ or artifacts/api-server/src/
   The user will see a blue "Apply to Atlas" button — clicking it writes the file directly to disk (no GitHub push needed).

   Example:
   FILE_EDIT_START
   path: artifacts/atlas/src/pages/workspace.tsx
   language: typescript
   FILE_EDIT_CONTENT
   [complete file]
   FILE_EDIT_END

PATH RULES — what is NEVER allowed in FILE_EDIT (the system blocks these):
  - package.json (any location)
  - pnpm-workspace.yaml
  - Any config file: vite.config.ts, tsconfig.json, drizzle.config.ts, .env, etc.
  - node_modules or build output (dist/, .next/, build/)

PACKAGE INSTALLATION — IMPORTANT:
You cannot install npm packages. Package installation requires the Replit environment (the underlying build agent), not you.

If your code requires a library that might not be installed:
1. First check the stack manifest above — recharts, framer-motion, lucide-react, radix-ui, zod, react-hook-form, wouter, sonner, and many others are ALREADY installed. Use them freely.
2. If you genuinely need a package not on that list, tell the user plainly: "This requires [package-name] to be installed. Ask the Replit agent (the AI that built this app) to add it, then I can write the code."
3. Do NOT emit a FILE_EDIT for package.json. It will fail.

SELF-REPAIR protocol:
You are Atlas — and you can repair yourself. When the user reports something broken in Atlas, or asks you to fix your own UI or logic, you may read and rewrite your own source files inside artifacts/atlas/src/ and artifacts/api-server/src/.

Your own source lives at:
- Frontend: artifacts/atlas/src/ (React/Vite — Vite HMR reloads instantly after apply)
- Backend: artifacts/api-server/src/ (Express/Node — requires API server restart after apply)

To repair yourself:
1. Ask the user to provide the file content (or they can use the "Read source" button to inject it).
2. Once the file is in context, emit a FILE_EDIT block using the full artifacts/... path.
3. The user will see an "Apply to Atlas" button — clicking it writes the file directly to disk.
4. For frontend files, changes appear immediately via Vite HMR. For backend files, the API Server workflow must be restarted.

Self-repair rules:
- Only self-repair when the file is fully in context. Never guess at your own code.
- Be surgical — fix exactly what's broken, preserve everything else.
- After applying, explain what changed and whether the user needs to restart anything.
- NEVER include package.json in a self-repair — the system will block it.

BUILD VERIFICATION PROTOCOL
After every backend code change and push to main, 
automatically run this verification sequence in 
the terminal:

TERMINAL_CMD:{"command":"pnpm run typecheck --filter @workspace/api-server","tier":1}

Wait for the result. If typecheck fails, fix the 
errors before proceeding. Do not tell the user 
the fix is complete until typecheck passes.

After typecheck passes, call:
GET /api/admin/logs/cloudrun

Wait 30 seconds after push, then call it again.
Look for "Server listening" in the logs to confirm 
startup. If you see exit(1) or ERROR instead, 
diagnose and fix before telling the user anything 
is working.

Never confirm a fix is deployed until you have 
seen "Server listening" in the Cloud Run logs.

<terminal-capability>
You have direct terminal access via a sandbox 
environment. This works whether or not a GitHub 
repo is linked — the sandbox is always available.

When a user asks you to run a command, check 
something, run tests, or verify output — 
DO NOT tell them to run it themselves.
Instead, emit a TERMINAL_CMD block:

TERMINAL_CMD:{"command":"npm run build","tier":1}

Tier classification:
- tier 1: git status, git log, git diff, 
  npm test, tsc --noEmit, ls, cat, echo,
  node --version, git --version
- tier 2: npm install, npm run build, git add,
  git commit, mkdir, cp, mv
- tier 3: git push, rm, git reset, git revert

Always use the terminal when:
- User asks to run, check, test, or verify anything
- You want to confirm a fix worked
- You want to check repo state before editing
- User asks what's wrong with their code

Never say "I don't have terminal access" —
you do. Use it.
</terminal-capability>

TERMINAL_CMD protocol (Terminal execution — Agentic mode):
When the user asks you to run a command, or when a natural next step is to execute a safe shell command (typecheck, test, git status/log/diff/show, ls/pwd/cat/head/tail/grep/find/wc/stat), emit it in this exact format on its own line at the end of your message:

TERMINAL_CMD:{"command":"git status","tier":1}

Rules for TERMINAL_CMD:
- Use TERMINAL_CMD only when a command is genuinely useful and belongs in the right tier.
- Tier 1 executes automatically: git status/log/diff/show, npm/pnpm test, vitest, ls, pwd, cat, head, tail, grep, find, wc, stat, sort, uniq, cut, awk, env, printenv, npm/pnpm run typecheck/build/lint, tsc --noEmit, echo, which, node --version, npm --version.
- Tier 2 requires confirmation before execution: installs, builds, git add/commit, mkdir/touch/cp/mv.
- Tier 3 requires typing YES: git push/force-push, rm, git reset/revert, or file write/delete operations.
- One TERMINAL_CMD per response — pick the single most important next step.
- Never emit blocked or obviously destructive commands.

Agentic chaining — this is critical:
The terminal output is automatically fed back to you after each command runs. You do not need to wait for the user. When you receive terminal output:
1. Analyze the result immediately — did it pass or fail?
2. If it FAILED: emit FILE_EDIT or LINE_PATCH to fix the errors, then emit another TERMINAL_CMD to verify the fix. Keep iterating until it passes.
3. If it PASSED: either proceed to the next logical step with another TERMINAL_CMD, or if the task is complete, end with a clear summary of what was done — no TERMINAL_CMD needed.
4. Never ask "should I continue?" — just continue. The user can stop the loop at any time using the Agent toggle.
5. Max 8 iterations per task to avoid infinite loops — if still failing after 8 attempts, explain what you tried and what's blocking.

[FILE_COMMITTED] signal — automatic verification after a push:
When the user's app sends a message starting with [FILE_COMMITTED], it means file changes were just successfully committed to GitHub. Respond immediately with:
1. One sentence acknowledging what was committed.
2. TERMINAL_CMD:{"command":"pnpm run typecheck","tier":1} — verify the build is clean.
Do not ask permission. Verification is the automatic next step after every commit. If typecheck fails, fix the errors with FILE_EDIT and run typecheck again. If it passes, confirm clearly: "Build is clean."

LINE_PATCH protocol (surgical find-and-replace — use this instead of FILE_EDIT for large files):
When you need to change a specific section of a large file (over ~200 lines) and you have that section in context, use LINE_PATCH instead of rewriting the whole file. It sends only the changed lines — no truncation risk, no guessing at the rest.

Format — one block per change location, multiple blocks back-to-back for multiple edits:

LINE_PATCH_START
path: src/components/FunnelBuilder.tsx
LINE_PATCH_FIND
  const handleSubmit = async () => {
    try {
      await api.post("/submit");
    } catch (e) {
LINE_PATCH_REPLACE
  const handleSubmit = async () => {
    try {
      await api.post("/submit");
      toast.success("Done!");
    } catch (e) {
LINE_PATCH_END

Rules for LINE_PATCH:
- Use for large files where you have the relevant section in context but NOT the complete file.
- The FIND block must match EXACTLY — character for character, including all whitespace and indentation. Copy it directly from the code you see in context.
- Include 3–5 lines of surrounding context in FIND so the match is unique within the file.
- REPLACE may be empty (to delete the FIND block), or contain the new code.
- Multiple LINE_PATCH blocks in one response are fine — emit them back-to-back.
- Do NOT use LINE_PATCH when you have the complete file in context — use FILE_EDIT instead (it's more reliable).
- Do NOT mix LINE_PATCH and FILE_EDIT for the same file in one response.
- The user sees a "Patch → Review" card and pushes to GitHub — same flow as FILE_EDIT.

FILE_READ protocol (reading any file on demand mid-conversation):
When you need the content of a specific file that isn't already in your context, emit this EXACT line at the very END of your response (after your explanation, before any FILE_EDIT blocks):

FILE_READ_REQUEST:{"paths":["src/components/FunnelBuilder.tsx","src/hooks/useAuth.ts"]}

Rules for FILE_READ:
- Only request files when you genuinely need the content to answer (building, debugging, or editing an existing file).
- Max 3 paths per request. Use exact paths from the file tree — no guessing.
- Do NOT request files for planning/conceptual questions where you don't need the implementation.
- The system fetches them from GitHub automatically and sends you a follow-up with the full content — you will then see the code and can respond with FILE_EDIT or a precise answer.
- After receiving files you asked for, proceed immediately with your task (build, fix, explain the specific code). Do not ask for permission.
- If no file tree is in context and the user is asking about a specific existing file, ask them to paste its content or use the Read Source button. Never block on a missing repo — you can always plan, design, and write new files from scratch.`;


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

  if (scores.decisionAnchors > 0 && scores.decision >= 3) {
    return { type: "DECISION", reason: "commitment signal", label: "Log this decision" };
  }

  if (scores.workspaceAnchors > 0 && scores.workspace >= 5 && (scores.words >= 24 || scores.numberedSteps > 0)) {
    return { type: "WORKSPACE", reason: "operational shift", label: "Working space prepared" };
  }

  if (scores.mapAnchors > 0 && scores.map >= 7 && scores.concernCount >= 2 && scores.words >= 45) {
    return { type: "MAP", reason: "interconnected tensions", label: "Tension Map" };
  }

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

const BLOCKED_PATH_RE = /(?:^|[\\/])(?:package\.json|pnpm-workspace\.yaml|(?:vite|tsconfig|drizzle|jest|vitest|eslint|prettier|babel|webpack|rollup|postcss)\.config\.[a-z]+|\.env[.\w]*)$/i;
const BLOCKED_DIR_RE = /^(?:node_modules|dist|build|\.next|\.cache)[\\/]/;

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

function canProceedWithFileChanges(assessment: ConfidenceAssessment | null): boolean {
  return assessment?.confidence === "high" && assessment.blast_radius === "isolated";
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

function runMetadataInsertValues(content: string) {
  return {
    runStatus: "completed",
    runSummary: runSummaryFromContent(content),
    runActions: null,
    runArtifacts: null,
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

    // Serialize message history to text, preserving text blocks from array content
    const combinedText = messages.map((m) => {
      let text: string;
      if (typeof m.content === "string") {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        // Extract text blocks only — image blocks are handled separately below
        text = m.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text as string)
          .join(" ");
      } else {
        text = String(m.content);
      }
      return `${m.role === "user" ? "User" : "Atlas"}: ${text}`;
    }).join("\n\n");

    // Collect all inline images: URL screenshots from the last user message + direct attachment
    const inlineParts: { inlineData: { mimeType: string; data: string } }[] = [];
    const lastMsg = messages[messages.length - 1];
    if (Array.isArray(lastMsg?.content)) {
      for (const block of lastMsg.content as any[]) {
        if (block.type === "image" && block.source?.data) {
          inlineParts.push({
            inlineData: { mimeType: block.source.media_type as string, data: block.source.data as string },
          });
        }
      }
    }
    if (imageData?.base64 && imageData?.mediaType) {
      inlineParts.push({ inlineData: { mimeType: imageData.mediaType, data: imageData.base64 } });
    }

    let result: Awaited<ReturnType<typeof genai.models.generateContent>>;
    if (inlineParts.length > 0) {
      result = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: combinedText }, ...inlineParts] }],
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

// ── Streaming model helpers ───────────────────────────────────────────────────

async function streamClaude(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }>,
  imageData: { base64: string; mediaType: string } | undefined,
  onToken: (text: string) => void
): Promise<ModelCallResult> {
  const startedAt = performance.now();
  const model = "claude-sonnet-4-6";
  type TextBlock = { type: "text"; text: string };
  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
  const claudeMessages = messages as Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }>;

  let fullText = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  await new Promise<void>((resolve, reject) => {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: claudeMessages,
    });
    stream.on("text", (text) => {
      fullText += text;
      onToken(text);
    });
    stream.on("error", (err) => reject(err));
    stream.on("finalMessage", (msg) => {
      inputTokens = (msg as any)?.usage?.input_tokens ?? null;
      outputTokens = (msg as any)?.usage?.output_tokens ?? null;
      resolve();
    });
  });

  return {
    content: fullText,
    model,
    usage: {
      executionTimeMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
      costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
    },
  };
}

async function streamGPT4o(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }>,
  imageData: { base64: string; mediaType: string } | undefined,
  onToken: (text: string) => void
): Promise<ModelCallResult> {
  const startedAt = performance.now();
  const model = "gpt-4o";
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

  let fullText = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  const stream = await openaiClient.chat.completions.create({
    model,
    max_tokens: 8192,
    stream: true,
    messages: oaiMessages as Parameters<typeof openaiClient.chat.completions.create>[0]["messages"],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      fullText += delta;
      onToken(delta);
    }
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? null;
      outputTokens = chunk.usage.completion_tokens ?? null;
    }
  }

  return {
    content: fullText,
    model,
    usage: {
      executionTimeMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
      costUsd: calculateModelCostUsd(model, inputTokens, outputTokens),
    },
  };
}

// ── Agentic Loop ──────────────────────────────────────────────────────────────
const MAX_AGENTIC_ITERATIONS = 3;

type AgenticLoopResult = {
  rawContent: string;
  assistantUsage: ModelCallUsage;
  modelUsed: string;
  terminalCmd: ChatTerminalCommand | null;
  terminalResult: ChatTerminalResult | null;
};

const AGENTIC_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_files",
    description:
      "Read specific files from the linked GitHub repository. Use for targeted reads of 1-8 files. If you need broad codebase understanding (10+ files or an architectural scan), use deep_read instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths to read from the repository (max 8)",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "deep_read",
    description:
      "Use Gemini to read and synthesize a large set of repository files. Use when you need broad codebase understanding (10+ files) or when an architectural question spans many parts of the repo.",
    input_schema: {
      type: "object" as const,
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths to analyze (up to 20)",
        },
        question: {
          type: "string",
          description:
            "Specific question or analysis task for Gemini to address across these files",
        },
      },
      required: ["paths", "question"],
    },
  },
  {
    name: "write_code",
    description:
      "Use GPT-4o to write or patch precise code when the task requires a specific file implementation or edit. Use only when actual code output is needed, not for strategy or planning.",
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "Precise description of the code to write or patch",
        },
        context: {
          type: "string",
          description: "Relevant code context, file contents, or constraints",
        },
        target_file: {
          type: "string",
          description: "The file path being created or modified",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a terminal command (build, test, typecheck, git status). Only use when a command is genuinely necessary to validate or complete the task.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        tier: {
          type: "number",
          description:
            "Safety tier: 1=auto-run read-only (git status, ls, cat, tsc), 2=project-affecting needs confirmation, 3=destructive needs YES. Use lowest appropriate tier.",
        },
      },
      required: ["command", "tier"],
    },
  },
];

/** Returns true if the message can be answered directly (no tools needed). */
async function classifyIntent(message: string): Promise<boolean> {
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content: `Does this message require reading code files, running terminal commands, or deep codebase analysis to answer properly?
Answer with JSON only: {"needs_tools": true/false}

Message: "${message.slice(0, 400)}"

needs_tools=true ONLY if: user asks to read/analyze specific files, run builds/tests, scan a codebase, or do a precise file edit
needs_tools=false: strategy, planning, advice, explanations, decisions, questions about architecture in general`,
        },
      ],
    });
    const text =
      resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const parsed = JSON.parse(
      text.replace(/```(?:json)?/g, "").trim()
    ) as { needs_tools?: boolean };
    return !parsed.needs_tools;
  } catch {
    return true; // Default to direct on classifier failure
  }
}

async function executeAgenticTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  repoData: { fullName?: string; defaultBranch?: string } | null,
  resolvedGithubToken: string | null,
  projectId: number,
  userId: number | undefined
): Promise<{ content: string; success: boolean; terminalCmd?: ChatTerminalCommand; terminalResult?: ChatTerminalResult }> {
  if (toolName === "read_files") {
    if (!repoData?.fullName || !resolvedGithubToken) {
      return { content: "No repository linked or no GitHub token available.", success: false };
    }
    const paths = ((toolInput.paths as string[]) ?? []).slice(0, 8);
    const fetched = await Promise.all(
      paths.map(async (fp) => {
        try {
          const r = await fetch(
            `${GH_API}/repos/${repoData.fullName}/contents/${fp}?ref=${repoData.defaultBranch ?? "main"}`,
            { headers: ghHeaders(resolvedGithubToken) }
          );
          if (!r.ok) return `=== ${fp} ===\n[File not found or inaccessible]`;
          const d = (await r.json()) as { encoding?: string; content?: string };
          if (d.encoding !== "base64" || !d.content)
            return `=== ${fp} ===\n[Could not decode file]`;
          const content = Buffer.from(
            d.content.replace(/\n/g, ""),
            "base64"
          ).toString("utf-8");
          const lines = content.split("\n");
          const truncated = lines.length > 600;
          return `=== ${fp}${truncated ? ` [first 600 of ${lines.length} lines]` : ""} ===\n${truncated ? lines.slice(0, 600).join("\n") : content}`;
        } catch {
          return `=== ${fp} ===\n[Error reading file]`;
        }
      })
    );
    return { content: fetched.join("\n\n"), success: true };
  }

  if (toolName === "deep_read") {
    if (!repoData?.fullName || !resolvedGithubToken) {
      return { content: "No repository linked or no GitHub token available.", success: false };
    }
    const paths = ((toolInput.paths as string[]) ?? []).slice(0, 20);
    const question =
      (toolInput.question as string) ??
      "Analyze these files and summarize their purpose and key patterns.";
    const fetched = await Promise.all(
      paths.map(async (fp) => {
        try {
          const r = await fetch(
            `${GH_API}/repos/${repoData.fullName}/contents/${fp}?ref=${repoData.defaultBranch ?? "main"}`,
            { headers: ghHeaders(resolvedGithubToken) }
          );
          if (!r.ok) return null;
          const d = (await r.json()) as { encoding?: string; content?: string };
          if (d.encoding !== "base64" || !d.content) return null;
          const content = Buffer.from(
            d.content.replace(/\n/g, ""),
            "base64"
          ).toString("utf-8");
          return `=== ${fp} ===\n${content.split("\n").slice(0, 400).join("\n")}`;
        } catch {
          return null;
        }
      })
    );
    const validFiles = fetched.filter(Boolean).join("\n\n");
    if (!validFiles)
      return { content: "No files could be read.", success: false };

    try {
      const geminiResult = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are analyzing a codebase. Answer this question:\n${question}\n\nFiles:\n${validFiles.slice(0, 900000)}`,
        config: {
          systemInstruction:
            "You are a senior engineer analyzing code. Be precise, thorough, and structured. Answer the question directly.",
        },
      });
      return { content: geminiResult.text ?? "No analysis returned.", success: true };
    } catch {
      return {
        content: "Gemini deep read failed — no analysis available.",
        success: false,
      };
    }
  }

  if (toolName === "write_code") {
    const task = (toolInput.task as string) ?? "";
    const context = (toolInput.context as string) ?? "";
    const targetFile = (toolInput.target_file as string) ?? "";
    const prompt = `You are an expert software engineer. Write precise, production-quality code.

Task: ${task}
${targetFile ? `Target file: ${targetFile}` : ""}
${context ? `\nContext:\n${context}` : ""}

Provide the complete implementation. Include FILE_EDIT_START / FILE_EDIT_CONTENT / FILE_EDIT_END blocks when producing a file edit.`;
    try {
      const resp = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      return {
        content: resp.choices[0]?.message?.content ?? "No code returned.",
        success: true,
      };
    } catch {
      return { content: "GPT-4o code generation failed.", success: false };
    }
  }

  if (toolName === "run_command") {
    const command = (toolInput.command as string) ?? "";
    const tier = parseTerminalTier(toolInput.tier) ?? 1;
    const evaluation = evaluateTerminalRequest(command, tier);
    if (evaluation.tier === "blocked") {
      return {
        content: `Command blocked: ${evaluation.reason}`,
        success: false,
      };
    }
    if (evaluation.requiresConfirmation) {
      return {
        content: `Command requires user confirmation (tier ${evaluation.tier}): ${command}\nReason: ${evaluation.reason}`,
        success: false,
      };
    }
    try {
      const executed = await runChatTerminalCommand(
        { command, tier },
        projectId,
        userId
      );
      const output = executed.terminalResult?.output ?? "No output";
      const exitCode = executed.terminalResult?.exitCode;
      return {
        content: `Command: ${command}\nExit code: ${exitCode ?? "unknown"}\n\nOutput:\n${output.slice(0, 4000)}`,
        success: exitCode === 0,
        terminalCmd: executed.terminalCmd,
        terminalResult: executed.terminalResult ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Command failed";
      return { content: `Command failed: ${msg}`, success: false };
    }
  }

  return { content: `Unknown tool: ${toolName}`, success: false };
}

async function runAgenticLoop(
  systemPrompt: string,
  dispatchMessages: Array<{
    role: "user" | "assistant";
    content:
      | string
      | Array<{ type: string; [k: string]: unknown }>;
  }>,
  imageData: { base64: string; mediaType: string } | undefined,
  repoData: { fullName?: string; defaultBranch?: string } | null,
  resolvedGithubToken: string | null,
  projectId: number,
  userId: number | undefined,
  narrate: (msg: string) => void,
  hasRepo: boolean
): Promise<AgenticLoopResult> {
  let assistantUsage = emptyUsage();
  let terminalCmd: ChatTerminalCommand | null = null;
  let terminalResult: ChatTerminalResult | null = null;

  const availableTools = AGENTIC_TOOLS.filter((t) => {
    if (
      (t.name === "read_files" || t.name === "deep_read") &&
      !hasRepo
    )
      return false;
    return true;
  });

  type ClaudeMsg = Parameters<
    typeof anthropic.messages.create
  >[0]["messages"][number];

  const loopMessages: ClaudeMsg[] = dispatchMessages.map((m) => ({
    role: m.role,
    content: m.content as string,
  }));

  let iteration = 0;
  let finalContent = "";

  while (iteration < MAX_AGENTIC_ITERATIONS) {
    const startedAt = performance.now();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      tools: availableTools,
      messages: loopMessages,
    });

    const elapsed = Math.round(performance.now() - startedAt);
    assistantUsage = mergeUsage(assistantUsage, {
      executionTimeMs: elapsed,
      inputTokens: response.usage.input_tokens ?? null,
      outputTokens: response.usage.output_tokens ?? null,
      costUsd: calculateModelCostUsd(
        "claude-sonnet-4-6",
        response.usage.input_tokens,
        response.usage.output_tokens
      ),
    });

    if (response.stop_reason === "end_turn") {
      finalContent = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as Array<{
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }>;

      if (toolUseBlocks.length === 0) {
        finalContent = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("\n");
        break;
      }

      loopMessages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlock[],
      });

      const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const tname = toolBlock.name;
        if (tname === "read_files") {
          const paths = (toolBlock.input.paths as string[]) ?? [];
          narrate(
            `Reading ${paths.length} file${paths.length !== 1 ? "s" : ""}...`
          );
        } else if (tname === "deep_read") {
          narrate("Analyzing codebase with Gemini...");
        } else if (tname === "write_code") {
          narrate("Writing code with GPT-4o...");
        } else if (tname === "run_command") {
          narrate("Running command...");
        }

        const result = await executeAgenticTool(
          tname,
          toolBlock.input,
          repoData,
          resolvedGithubToken,
          projectId,
          userId
        );

        if (tname === "run_command" && result.terminalCmd) {
          terminalCmd = result.terminalCmd;
          terminalResult = result.terminalResult ?? null;
        }

        toolResultContent.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result.content,
        });
      }

      loopMessages.push({ role: "user", content: toolResultContent });
      narrate("Reviewing results...");
      iteration++;
      continue;
    }

    finalContent = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    break;
  }

  // If loop exhausted without a final answer, synthesize from what was gathered
  if (!finalContent) {
    narrate("Synthesizing findings...");
    const startedAt = performance.now();
    const synthResp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        ...loopMessages,
        {
          role: "user",
          content:
            "Based on everything gathered, provide your best answer. If the task isn't fully complete, explain what was accomplished and what remains.",
        },
      ],
    });
    const elapsed = Math.round(performance.now() - startedAt);
    assistantUsage = mergeUsage(assistantUsage, {
      executionTimeMs: elapsed,
      inputTokens: synthResp.usage.input_tokens ?? null,
      outputTokens: synthResp.usage.output_tokens ?? null,
      costUsd: calculateModelCostUsd(
        "claude-sonnet-4-6",
        synthResp.usage.input_tokens,
        synthResp.usage.output_tokens
      ),
    });
    finalContent = synthResp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
  }

  return {
    rawContent: finalContent,
    assistantUsage,
    modelUsed: "claude-sonnet-4-6",
    terminalCmd,
    terminalResult,
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

router.post("/chat", async (req, res): Promise<void> => {
  try {
  const body = req.body as {
    sessionId?: number;
    projectId: number;
    message: string;
    mode?: string;
    lens?: string;
    workspaceLens?: string;
    scenarioMode?: boolean;
    history?: Array<{ role: string; content: string }>;
    entries?: Array<{ id: number; title: string; status: string }>;
    fileContext?: string;
    userProfile?: string;
    imageData?: { base64: string; mediaType: string };
    flowMode?: boolean;
    flowNodes?: Array<{ type: string; label: string; question?: string; strategicAnswer?: string }>;
    forgeContext?: string;
    dbUrl?: string;
    planMode?: boolean;
  };

  const activeLens = (body.lens ?? "builder").toLowerCase();

  // SSE headers for narration + token streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const narrate = (msg: string) => {
    try { res.write(`event: narration\ndata: ${JSON.stringify(msg)}\n\n`); } catch {}
  };

  const lensNarration = {
    think: {
      loading: "Reviewing project context...",
      memory: "Recalling previous decisions...",
      model: "Exploring strategic direction...",
      done: "Synthesizing response...",
    },
    build: {
      loading: "Connecting to repository...",
      memory: "Loading implementation context...",
      model: "Inspecting codebase...",
      done: "Preparing implementation plan...",
    },
    flow: {
      loading: "Loading project structure...",
      memory: "Mapping relationships...",
      model: "Organizing operational context...",
      done: "Updating flow state...",
    },
  } as const;

  type LensKey = keyof typeof lensNarration;
  const lensKey: LensKey = (["think", "build", "flow"].includes(activeLens) ? activeLens : "think") as LensKey;
  const nar = lensNarration[lensKey];

  const narrateToken = (text: string) => {
    res.write(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
  };

  const isFlowMode = !!body.flowMode;
  const isScenarioMode = !!body.scenarioMode;

  if ((!body.sessionId && !isFlowMode) || !body.projectId || !body.message) {
    res.status(400).json({ error: "Missing required fields: sessionId, projectId, message" });
    return;
  }

  const { sessionId = 0, projectId, message, history = [], entries = [], planMode = false } = body;
  const fileContext = body.fileContext ?? "";
  const userProfile = body.userProfile ?? "";
  const projectMap = (body as any).projectMap as string | undefined;
  const clientForgeContext = body.forgeContext ?? "";
  const imageData = body.imageData;
  const activeModel = selectChatModelForMessage(message);
  const now = new Date();
  const userId = (req as any).authUser?.id as number | undefined;
  logger.info({ projectId, userId, hasProjectId: !!projectId, hasUserId: !!userId }, "chat terminal debug");

  // Load project memory + repo info + node state from DB
  narrate(nar.loading);
  const [project] = await db
    .select({ memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken, nodeState: projectsTable.nodeState, name: projectsTable.name })
    .from(projectsTable)
    .where(userId ? and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)) : eq(projectsTable.id, projectId));

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
  narrate(nar.memory);
  const { text: memoryText, retrievedIds } = buildMemoryContext(store);
  if (retrievedIds.length > 0) {
    store = incrementRetrievals(store, retrievedIds, now);
  }

  // Auto-fetch repo file tree (Phase 1 — always injected when a repo is linked)
  let repoTreeContext: string | null = null;
  let recentRepoActivityContext: string | null = null;
  let repoData: { fullName?: string; defaultBranch?: string } | null = null;
  const requestGithubToken = req.headers["x-github-token"];
  const resolvedGithubToken = await resolveGithubTokenForRequest(
    userId,
    project?.githubToken,
    typeof requestGithubToken === "string" ? requestGithubToken : null
  );

  if (project?.linkedRepo) {
    narrate("Connecting to your repository...");
    try {
      const parsedRepo = JSON.parse(project.linkedRepo) as string | { fullName?: string; defaultBranch?: string };
      repoData = typeof parsedRepo === "string"
        ? { fullName: parsedRepo, defaultBranch: "main" }
        : parsedRepo;
      if (repoData.fullName) {
        if (resolvedGithubToken) {
          narrate("Reading repo structure...");
          try {
            repoTreeContext = await fetchRepoTree(repoData.fullName, resolvedGithubToken, repoData.defaultBranch ?? "main");
          } catch (treeErr: unknown) {
            // Surface the real error to Atlas — don't swallow it
            const errMsg = treeErr instanceof Error ? treeErr.message : String(treeErr);
            repoTreeContext = `[REPO_READ_FAILED] Atlas tried to read the file tree for ${repoData.fullName} but hit an error: ${errMsg}. The stored GitHub token may be expired or lack repo access. Tell the user to refresh their token in the Files tab.`;
            logger.warn({ err: treeErr, repo: repoData.fullName }, "fetchRepoTree failed — surfacing to Atlas");
          }
        } else {
          // Linked but no token — tell Atlas explicitly so it can relay to the user
          repoTreeContext = `[REPO_NO_TOKEN] Project has a linked GitHub repo (${repoData.fullName}) but no valid GitHub token is configured. Atlas cannot read this repository. Tell the user to add their GitHub token in the Files tab of this workspace.`;
        }
        if (process.env.GITHUB_TOKEN) {
          try {
            recentRepoActivityContext = await fetchRecentRepoActivity(repoData.fullName, process.env.GITHUB_TOKEN, now);
          } catch {
            // Non-fatal — recent activity is supplemental
          }
        }
      }
    } catch (parseErr) {
      logger.warn({ err: parseErr, projectId }, "Failed to parse linkedRepo JSON — skipping repo context");
    }
  }

  // Phase 2 — auto-fetch file contents when the user asks to build/fix something
  const BUILD_INTENT_RE = /\b(fix|build|add|change|update|create|implement|write|modify|edit|refactor|debug|bug|error|broken|doesn't work|won't work|failing|crash|not working)\b/i;
  let autoFetchedFiles: string[] = [];
  let autoFetchedContext = "";

  if (BUILD_INTENT_RE.test(message) && repoData?.fullName && resolvedGithubToken && repoTreeContext) {
    try {
      // Fast selector call: ask Claude which files it needs to read (small, cheap)
      narrate("Identifying relevant files...");
      const selectorResp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Given this file tree and user request, return ONLY a JSON array of the 1-3 most relevant file paths to read. Return [] if no specific files are needed (planning/conceptual questions only).\n\nUser request: "${message}"\n\nFile tree:\n${repoTreeContext}\n\nReturn ONLY a JSON array like ["src/pages/Login.tsx"] — no explanation, no markdown fences.`,
        }],
      });
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
              if (!r.ok) {
                let errorMessage = r.statusText || "GitHub file read failed";
                try {
                  const errorBody = await r.json() as { message?: string };
                  errorMessage = errorBody.message ?? errorMessage;
                } catch {
                  // Keep the original status text if the error body is not JSON.
                }
                console.error("[chat:auto-fetch-file-read-empty]", {
                  repo: repoData!.fullName,
                  path: fp,
                  status: r.status,
                  errorMessage,
                });
                return null;
              }
              const d = await r.json() as { encoding?: string; content?: string };
              if (d.encoding !== "base64" || !d.content) {
                console.error("[chat:auto-fetch-file-read-empty]", {
                  repo: repoData!.fullName,
                  path: fp,
                  status: r.status,
                  errorMessage: d.encoding !== "base64" ? `Unexpected encoding: ${d.encoding ?? "missing"}` : "Missing file content",
                });
                return null;
              }
              const content = Buffer.from(d.content.replace(/\n/g, ""), "base64").toString("utf-8");
              const lines = content.split("\n");
              const truncated = lines.length > 600;
              return { path: fp, content: truncated ? lines.slice(0, 600).join("\n") : content, truncated, lineCount: lines.length };
            } catch (err) {
              console.error("[chat:auto-fetch-file-read-empty]", {
                repo: repoData!.fullName,
                path: fp,
                status: null,
                errorMessage: err instanceof Error ? err.message : String(err),
              });
              return null;
            }
          })
        );
        const valid = fetched.filter((f): f is { path: string; content: string; truncated: boolean; lineCount: number } => f !== null);
        if (valid.length > 0) {
          autoFetchedFiles = valid.map(f => f.path);
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

  let recentErrorContext = "";
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = await db
      .select({
        errorMessage: atlasErrorLogsTable.errorMessage,
        route: atlasErrorLogsTable.route,
        timestamp: atlasErrorLogsTable.timestamp,
      })
      .from(atlasErrorLogsTable)
      .where(and(
        eq(atlasErrorLogsTable.projectId, String(projectId)),
        gte(atlasErrorLogsTable.createdAt, cutoff)
      ))
      .orderBy(desc(atlasErrorLogsTable.createdAt))
      .limit(5);

    recentErrorContext = recentErrors
      .map((error) => `Recent production errors detected: ${error.errorMessage} at ${error.route} — ${error.timestamp.toISOString()}`)
      .join("\n");
  } catch {
    // Non-fatal: Atlas can still respond without production error context.
  }

  let selfMapContext = "";
  try {
    const [selfMap] = await db
      .select({ fileCount: atlasSelfMapTable.fileCount })
      .from(atlasSelfMapTable)
      .orderBy(desc(atlasSelfMapTable.createdAt))
      .limit(1);
    if (selfMap) {
      selfMapContext = `Current codebase: ${selfMap.fileCount} files indexed. Architecture map available for reasoning.`;
    }
  } catch {
    // Non-fatal: Atlas can still respond without the self map summary.
  }

  // Build layered system prompt
  let systemPrompt = DEV_SYSTEM_PROMPT;
  // Inject project identity
  const [projectRow] = await db
    .select({ name: projectsTable.name, description: projectsTable.description })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (projectRow) {
    systemPrompt += `\n\n--- ACTIVE PROJECT ---\nProject name: ${projectRow.name}${projectRow.description ? `\nDescription: ${projectRow.description}` : ""}\nThis is the project you are currently working in. Always refer to it by name. Never ask the user what project they are working on.\n--- END ACTIVE PROJECT ---`;
  }
  if (userId) {
    const portfolioProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.userId, userId), ne(projectsTable.id, projectId)))
      .limit(8);
    const portfolioNames = portfolioProjects.map((p) => `- ${p.name}`).join("\n");
    systemPrompt += `\n\n--- YOUR PORTFOLIO ---\n${portfolioNames ? `${portfolioNames}\n` : ""}${portfolioProjects.length}\n--- END PORTFOLIO ---`;
  }
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (memoryText) {
    systemPrompt += `\n\n--- PROJECT MEMORY (what you already know — use this) ---\n${memoryText}\n--- END PROJECT MEMORY ---`;
  }
  if (projectMap) {
    systemPrompt += `\n\n--- PROJECT MAP (auto-scanned structure — use this to answer "what do I have?" questions without needing files) ---\n${projectMap}\n--- END PROJECT MAP ---`;
  }
  if (repoTreeContext) {
    systemPrompt += `\n\n--- LINKED REPO STRUCTURE (auto-loaded — you can reference these paths in FILE_EDIT blocks) ---\n${repoTreeContext}\n--- END REPO STRUCTURE ---`;
  }
  if (recentRepoActivityContext) {
    systemPrompt += `\n\n${recentRepoActivityContext}`;
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

  // Database schema inspection — run when client sends a dbUrl
  const clientDbUrl = body.dbUrl?.trim();
  if (clientDbUrl) {
    narrate("Inspecting database schema...");
    const schemaResult = await inspectSchema(clientDbUrl);
    const schemaText = formatSchemaForPrompt(schemaResult);
    systemPrompt += `\n\n--- PROJECT DATABASE SCHEMA (live inspection — use this to reason about what exists before writing queries, migrations, or API code) ---
${schemaText}

When discussing this project's database:
- Reference actual table and column names from above. Never guess or invent names.
- If the user asks about a feature that needs a table or column that doesn't exist, say so clearly and offer to generate the migration SQL.
- If you propose schema changes, format them as SQL wrapped in DB_MIGRATION_START / DB_MIGRATION_END markers (these will be rendered as an approval card in Phase 2).
--- END DATABASE SCHEMA ---`;
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

  if (isFlowMode) {
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
  const workspaceLens = (body.workspaceLens ?? "flow").toLowerCase();
  const workspaceLensInstructions: Record<string, string> = {
    flow: `\n\n--- LENS: FLOW ---
You are in FLOW lens. This means:
• Think deeply. Explore concepts before reaching conclusions. Ask clarifying questions when the path is unclear.
• Help the user see around corners — surface implications, dependencies, and second-order effects.
• Prefer discussion and reasoning over code. Write code only if the user asks for it explicitly.
• Be a strategic thinking partner. Challenge assumptions gently.
• If the user's message is strongly about writing/pushing code, end your response with: LENS_DRIFT: build`,
    build: `\n\n--- LENS: BUILD ---
You are in BUILD lens. This means:
• Code-first. Every answer that involves code must be production-ready and complete.
• Use FILE_EDIT blocks for all code changes. No partial snippets.
• Be surgical — know what to change and why. Explain concisely before the FILE_EDIT.
• GitHub push is enabled — your output goes directly to the repo.
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

  // Legacy project-level lens — style modifier (builder/strategist/reviewer/teacher)
  const lensInstructions: Record<string, string> = {
    builder: "",
    strategist: `\n\n--- PROJECT STYLE: STRATEGIST ---\nZoom out. Before answering any tactical question, check if there's a strategic implication worth surfacing. Think like a co-founder who's read the whole roadmap.`,
    reviewer: `\n\n--- PROJECT STYLE: REVIEWER ---\nBe critical. Lead with what's fragile or missing before validating what's working. Ask hard questions. Don't soften the assessment.`,
    teacher: `\n\n--- PROJECT STYLE: TEACHER ---\nExplain everything. No jargon without definition. Name concepts, explain patterns, give context before code.`,
  };
  if (activeLens !== "builder") {
    systemPrompt += lensInstructions[activeLens] ?? "";
  }

  // ── Deep Dive shortcut — /deep <topic> ───────────────────────────────────────
  const { isDive, topic: diveTopic } = isDeepDive(message);
  if (isDive) {
    await db.insert(chatMessagesTable).values({ sessionId, role: "user", content: message, intentType: body.mode ?? null });
    const diveResult = await runDeepDive(diveTopic, systemPrompt);
    const surface = detectSurfaceSignal({
      content: diveResult.content,
      userMessage: message,
      recentMessages: history,
    });
    const [savedDive] = await db.insert(chatMessagesTable).values({
      sessionId,
      role: "assistant",
      content: diveResult.content,
      intentType: "EXPLORE",
      ...usageInsertValues(diveResult.usage),
      ...runMetadataInsertValues(diveResult.content),
    }).returning();
    await db.update(sessionsTable).set({ messageCount: sql`${sessionsTable.messageCount} + 2` }).where(eq(sessionsTable.id, sessionId));
    res.json({ content: diveResult.content, modelUsed: diveResult.model, terminalCmd: null, terminalResult: null, surface, intentType: "EXPLORE", catchPayload: null, messageId: savedDive.id, model: "gemini", isDeepDive: true });
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

  if (planMode) {
    systemPrompt += `\n\n--- PLAN MODE ACTIVE ---
The user has activated Plan mode. Your response 
must produce a structured plan as the primary output.

Structure your plan with:
- A clear title (one line)
- Objective (1-2 sentences)  
- Steps or phases (numbered)
- Expected outcome

At the END of your response, after the plan content,
emit an ARTIFACT_WRITE block to save it:

ARTIFACT_WRITE_START
type: plan
title: [the plan title you gave above]
ARTIFACT_WRITE_CONTENT
[the complete plan content]
ARTIFACT_WRITE_END
--- END PLAN MODE ---`;
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

  // 2. Live URL screenshots (image blocks only — text fallback blocks go via urlNote)
  for (const ub of urlBlocks) {
    if (ub.type === "image") {
      contentParts.push({
        type: "image",
        source: { type: "base64", media_type: ub.source.media_type, data: ub.source.data },
      } as ImageBlock);
    }
  }

  // 3. User-attached image (if any)
  if (imageData) {
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: imageData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageData.base64 },
    } as ImageBlock);
  }

  // 3. User text
  contentParts.push({ type: "text", text: message });

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
    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "user",
      content: message,
      intentType: body.mode ?? null,
    });
  }

  // ── Agentic dispatcher ────────────────────────────────────────────────────
  // Classify intent: direct answer (Claude alone) or needs tools (agentic loop)
  narrate("Understanding your request...");
  const hasRepo = !!(repoData?.fullName && resolvedGithubToken);
  let isDirect = true;
  // Only classify when there's a repo linked or the mode is audit/deep-dive — otherwise always direct
  if (hasRepo || body.mode === "audit" || body.mode === "deep-dive") {
    isDirect = await classifyIntent(message);
  }

  let rawContent: string;
  let assistantUsage: ModelCallUsage;
  let modelUsed: string;
  let terminalCmd: ChatTerminalCommand | null = null;
  let terminalResult: ChatTerminalResult | null = null;

  if (isDirect) {
    // ── Direct path: streaming model call ──────────────────────────────────
    narrate(nar.model);
    let modelResult: ModelCallResult;
    if (activeModel === "claude") {
      modelResult = await streamClaude(systemPrompt, dispatchMessages, imageData, narrateToken);
    } else if (activeModel === "gpt4o") {
      modelResult = await streamGPT4o(systemPrompt, dispatchMessages, imageData, narrateToken);
    } else {
      // Gemini — blocking (streaming not yet wired)
      modelResult = await callModel(activeModel, systemPrompt, dispatchMessages, imageData);
    }
    rawContent = modelResult.content;
    assistantUsage = modelResult.usage;
    modelUsed = modelResult.model;

    // FILE_READ intercept — text-protocol fallback for direct path
    {
      const { paths: readPaths, cleanedContent: readCleanedContent } = extractFileReadRequest(rawContent);
      if (readPaths.length > 0) {
        // Case 1: no linked repo or no token — tell Atlas clearly so it can relay to the user
        if (!repoData?.fullName || !resolvedGithubToken) {
          const reason = !repoData?.fullName
            ? "No GitHub repo is linked to this project. The user needs to link a repo in the Files tab before you can read files."
            : "No GitHub token is available for this project. The user needs to add their personal GitHub token in the Files tab.";
          const followUpMessages: Array<{ role: "user" | "assistant"; content: string }> = [
            ...dispatchMessages as Array<{ role: "user" | "assistant"; content: string }>,
            { role: "assistant", content: readCleanedContent },
            { role: "user", content: `[FILE_READ_FAILED] ${reason}\n\nTell the user this directly and clearly in one sentence. Do not try to read the files again.` },
          ];
          if (activeModel === "claude") {
            modelResult = await streamClaude(systemPrompt, followUpMessages, undefined, narrateToken);
          } else {
            modelResult = await callModel(activeModel, systemPrompt, followUpMessages, undefined);
          }
          rawContent = modelResult.content;
          assistantUsage = mergeUsage(assistantUsage, modelResult.usage);
          modelUsed = modelResult.model;
        } else {
          // Case 2: repo and token exist — fetch files from GitHub
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
                  return { path: fp, content: truncated ? lines.slice(0, 600).join("\n") : fileContent, truncated, lineCount: lines.length };
                } catch { return null; }
              })
            );
            const validFiles = fetchedFiles.filter(
              (f): f is { path: string; content: string; truncated: boolean; lineCount: number } => f !== null
            );

            let followUpUserContent: string;
            if (validFiles.length > 0) {
              // Case 2a: files found — inject content and re-run
              const filesSummary = validFiles
                .map(f => `=== ${f.path}${f.truncated ? ` [first 600 of ${f.lineCount} lines]` : ""} ===\n${f.content}`)
                .join("\n\n");
              followUpUserContent = `[FILES REQUESTED BY YOU]\n\n${filesSummary}\n\n[END FILES]\n\nYou asked to read these files. Now proceed — build, fix, or answer using the content above. Do not ask for more files unless absolutely necessary.`;
              narrate("Reading files and preparing response...");
            } else {
              // Case 2b: paths not found in the linked repo — tell Atlas clearly
              const notFound = readPaths.join(", ");
              followUpUserContent = `[FILE_READ_FAILED] The following paths were not found in the linked repo (${repoData!.fullName}, branch: ${repoData!.defaultBranch ?? "main"}): ${notFound}.\n\nPossible reasons: wrong path, wrong branch, or these files live in a different repo (e.g. the backend rather than the linked frontend repo).\n\nTell the user clearly which paths you tried and why they weren't found. Suggest the correct path if you can infer it from the file tree.`;
            }

            const followUpMessages: Array<{ role: "user" | "assistant"; content: string }> = [
              ...dispatchMessages as Array<{ role: "user" | "assistant"; content: string }>,
              { role: "assistant", content: readCleanedContent },
              { role: "user", content: followUpUserContent },
            ];
            if (activeModel === "claude") {
              modelResult = await streamClaude(systemPrompt, followUpMessages, undefined, narrateToken);
            } else if (activeModel === "gpt4o") {
              modelResult = await streamGPT4o(systemPrompt, followUpMessages, undefined, narrateToken);
            } else {
              modelResult = await callModel(activeModel, systemPrompt, followUpMessages, undefined);
            }
            rawContent = modelResult.content;
            assistantUsage = mergeUsage(assistantUsage, modelResult.usage);
            modelUsed = modelResult.model;
          } catch { /* Non-fatal — leave rawContent as-is */ }
        }
      }
    }

    // TERMINAL_CMD text-protocol extraction for direct path
    const terminalExtraction = extractTerminalCommand(rawContent);
    if (terminalExtraction.terminalCmd) narrate("Running terminal command...");
    rawContent = terminalExtraction.content;
    if (terminalExtraction.terminalCmd) {
      try {
        const executed = await runChatTerminalCommand(terminalExtraction.terminalCmd, projectId, userId);
        terminalCmd = executed.terminalCmd;
        terminalResult = executed.terminalResult;
        if (terminalResult) {
          // Atlas's message before the terminal result (the text without TERMINAL_CMD tag)
          const atlasPreResult = rawContent;
          const trimmedOutput = terminalResult.output.slice(0, 3000).trim() || "(no output)";
          const feedbackMessages: Array<{ role: "user" | "assistant"; content: string }> = [
            ...dispatchMessages as Array<{ role: "user" | "assistant"; content: string }>,
            { role: "assistant", content: atlasPreResult },
            { role: "user", content: `[TERMINAL_OUTPUT]\ncommand: ${terminalResult.command}\nexit_code: ${terminalResult.exitCode ?? "null"}\n\n${trimmedOutput}` },
          ];
          narrate("Analyzing output...");
          const feedbackResult = activeModel === "claude"
            ? await streamClaude(systemPrompt, feedbackMessages, undefined, narrateToken)
            : await callModel(activeModel, systemPrompt, feedbackMessages, undefined);
          rawContent = feedbackResult.content;
          assistantUsage = mergeUsage(assistantUsage, feedbackResult.usage);
        } else {
          // Command requires confirmation or was blocked — just clean tags
          rawContent = cleanTerminalTags(rawContent);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Terminal command failed";
        const fallbackTier = terminalExtraction.terminalCmd.tier ?? 3;
        terminalCmd = { command: terminalExtraction.terminalCmd.command, tier: fallbackTier, reason: errMsg };
        terminalResult = { command: terminalExtraction.terminalCmd.command, output: errMsg, exitCode: null, tier: fallbackTier };
        rawContent = cleanTerminalTags(rawContent);
      }
    } else {
      rawContent = cleanTerminalTags(rawContent);
    }
  } else {
    // ── Agentic path: tool_use loop with Claude as orchestrator ────────────
    narrate("Planning approach...");
    try {
      const loopResult = await runAgenticLoop(
        systemPrompt,
        dispatchMessages,
        imageData,
        repoData,
        resolvedGithubToken,
        projectId,
        userId,
        narrate,
        hasRepo
      );
      rawContent = loopResult.rawContent;
      assistantUsage = loopResult.assistantUsage;
      modelUsed = loopResult.modelUsed;
      terminalCmd = loopResult.terminalCmd;
      terminalResult = loopResult.terminalResult;

      // Run text-protocol extraction as safety net for any protocols in the agentic response
      const terminalExtraction = extractTerminalCommand(rawContent);
      rawContent = terminalExtraction.content;
      if (terminalExtraction.terminalCmd && !terminalCmd) {
        try {
          const executed = await runChatTerminalCommand(terminalExtraction.terminalCmd, projectId, userId);
          terminalCmd = executed.terminalCmd;
          terminalResult = executed.terminalResult;
          if (terminalResult) {
            rawContent = cleanTerminalTags(`${rawContent}\n\nTERMINAL_RESULT:${JSON.stringify(terminalResult)}`);
          }
        } catch { /* Non-fatal */ }
      } else {
        rawContent = cleanTerminalTags(rawContent);
      }
    } catch (err) {
      // Fallback: if the agentic loop fails entirely, run a direct Claude call
      logger.warn({ err }, "Agentic loop failed — falling back to direct Claude call");
      narrate(nar.model);
      const modelResult = await callModel("claude", systemPrompt, dispatchMessages, imageData);
      rawContent = cleanTerminalTags(modelResult.content);
      assistantUsage = modelResult.usage;
      modelUsed = modelResult.model;
    }
  }

  // Parse: LINE_PATCHes → FILE_EDITs → MEMORY_Tn → NODE_RESOLVED → INTENT_TYPE → MEMORY_CHIPS
  const { visibleContent: afterPatches, linePatches } = extractAllLinePatches(rawContent);
  const { visibleContent, fileEdits } = extractAllFileEdits(afterPatches);
  const confidenceAssessment = extractConfidenceAssessment(visibleContent);
  const hasProposedFileChanges = fileEdits.length > 0 || linePatches.length > 0;
  const fileChangesAllowed = !hasProposedFileChanges || canProceedWithFileChanges(confidenceAssessment);
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

  let savedMsgId: number | undefined;
  let autoName: string | undefined;
  if (!isFlowMode && !isScenarioMode) {
    const [savedMsg] = await db
      .insert(chatMessagesTable)
      .values({
        sessionId,
        role: "assistant",
        content: persistContent,
        intentType: detectedIntentType,
        catchPayload: undefined,
        ...usageInsertValues(assistantUsage),
        ...runMetadataInsertValues(persistContent),
      })
      .returning();
    savedMsgId = savedMsg.id;

    await db
      .update(sessionsTable)
      .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
      .where(eq(sessionsTable.id, sessionId));

    // Auto-save plan/blueprint to Workbench artifacts
    if (responsePlan) {
      try {
        const artifactType = responsePlan.mode === "blueprint" ? "blueprint" : "plan";
        const artifactContent = JSON.stringify({
          steps: responsePlan.steps,
          confidence: responsePlan.confidence,
          estimatedChanges: responsePlan.estimatedChanges,
          reversible: responsePlan.reversible,
        });
        await db.insert(artifactsTable).values({
          userId: userId!,
          projectId,
          sessionId,
          type: artifactType,
          title: responsePlan.title,
          content: artifactContent,
          status: "draft",
          pinned: false,
          sources: { model: modelUsed, mode: responsePlan.mode ?? "plan" },
        });
      } catch (err) {
        logger.warn({ err }, "Failed to auto-save artifact from plan");
      }
    }
  }

  // Auto-name: on first message, generate a real project name from the user's intent
  if (!isFlowMode && !isScenarioMode) {
    const isFirstMessage = history.length === 0;
    const DEFAULT_NAMES = new Set(["New Project", "New Idea", "My Project", ""]);
    if (isFirstMessage && DEFAULT_NAMES.has((project?.name ?? "").trim())) {
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
          await db.update(projectsTable).set({ name: cleaned }).where(eq(projectsTable.id, projectId));
          autoName = cleaned;
        }
      } catch { /* non-fatal — original name stays */ }
    }
  }

  // Attempt image generation if the user's message looks like an image request
  let imageB64: string | undefined;
  let imageMimeType: string | undefined;
  if (!isFlowMode && IMAGE_REQUEST_RE.test(message)) {
    // If user is clarifying render mode, generate with appropriate prompt
    if (IMAGE_CLARIFY_RE.test(message) || IMAGE_CONFIRM_RE.test(message)) {
      const isCinematic = /cinematic|hero/i.test(message);
      const isBlueprint = /blueprint|breakdown|spec|sheet|multi.*panel/i.test(message);
      const baseSubject = message.replace(IMAGE_REQUEST_RE, "").trim() || message;
      try {
        if (isBlueprint) {
          // Multi-panel: parallel generations for different views
          const panels = [
            { prompt: `${baseSubject}. Product front view. Studio lighting. Clean white background.`, style: "front" },
            { prompt: `${baseSubject}. Product side view. Studio lighting. Clean white background.`, style: "side" },
            { prompt: `${baseSubject}. Product close-up of key interaction point. Macro detail. Studio lighting. Clean white background.`, style: "detail" },
            { prompt: `${baseSubject}. Product in context/environment. User interaction scenario. Studio lighting. Clean white background.`, style: "context" },
          ];
          const panelResults = await Promise.all(
            panels.map(async (panel) => {
              try {
                const r = await genai.models.generateContent({
                  model: "gemini-2.5-flash-preview-05-20",
                  contents: [{ role: "user", parts: [{ text: panel.prompt }] }],
                  config: { responseModalities: ["IMAGE", "TEXT"] },
                });
                const parts = r.candidates?.[0]?.content?.parts ?? [];
                const img = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
                if (img?.inlineData) {
                  return { b64: img.inlineData.data as string, mime: img.inlineData.mimeType as string, style: panel.style };
                }
              } catch { /* one panel fails silently */ }
              return null;
            })
          );
          const images = panelResults.filter(Boolean) as Array<{ b64: string; mime: string; style: string }>;
          if (images.length > 0) {
            imageB64 = images[0].b64;
            imageMimeType = images[0].mime;
            try {
              await db.insert(artifactsTable).values({
                userId: userId!,
                projectId,
                sessionId,
                type: "image_set",
                title: `Generated set \u2014 ${baseSubject.slice(0, 60)}`,
                content: JSON.stringify({ images }),
                status: "draft",
                pinned: false,
                sources: { model: "gemini-2.5-flash-preview-05-20", promptType: "multi-panel", panelCount: images.length },
              });
            } catch (err) {
              logger.warn({ err }, "Failed to auto-save image set artifact");
            }
          }
        } else {
          // Single image (cinematic or standard)
          const imagePrompt = isCinematic
            ? `${baseSubject}. Single cinematic hero shot. Premium product photography. Studio lighting. Ultra-detailed materials and surfaces. Pure white background. No text overlays. Award-winning industrial design aesthetic.`
            : `${baseSubject}. Clean, professional style. Premium product photography.`;
          const imgResponse = await genai.models.generateContent({
            model: "gemini-2.5-flash-preview-05-20",
            contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
            config: { responseModalities: ["IMAGE", "TEXT"] },
          });
          const parts = imgResponse.candidates?.[0]?.content?.parts ?? [];
          const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
          if (imgPart?.inlineData) {
            imageB64 = imgPart.inlineData.data as string;
            imageMimeType = imgPart.inlineData.mimeType as string;
            try {
              await db.insert(artifactsTable).values({
                userId: userId!,
                projectId,
                sessionId,
                type: "image_set",
                title: `Generated visual \u2014 ${baseSubject.slice(0, 60)}`,
                content: JSON.stringify({ images: [{ b64: imageB64, mime: imageMimeType, style: isCinematic ? "cinematic" : "standard" }] }),
                status: "draft",
                pinned: false,
                sources: { model: "gemini-2.5-flash-preview-05-20", promptType: isCinematic ? "cinematic" : "standard" },
              });
            } catch (err) {
              logger.warn({ err }, "Failed to auto-save image artifact");
            }
          }
        }
      } catch (imgErr) {
        console.warn("Image generation failed:", imgErr);
      }
    } else {
      // First time — ask which render mode before generating
      // Inject IMAGE_CLARIFY signal into the response — frontend will render as two buttons
      displayContent = (displayContent || "") + "\n\nIMAGE_CLARIFY: Before I render — which style do you want?\n- **Cinematic** — one premium hero shot, maximum detail, pure form\n- **Blueprint** — multi-panel breakdown with angles, dimensions, interaction sequence";
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

  // Write resolved nodes back to nodeState in DB
  if (resolvedNodes.length > 0 && projectId) {
    try {
      const currentNodeState = (project?.nodeState ?? {}) as Record<string, unknown>;
      const updatedNodeState = { ...currentNodeState };
      for (const nodeId of resolvedNodes) {
        if (updatedNodeState[nodeId] && typeof updatedNodeState[nodeId] === "object") {
          updatedNodeState[nodeId] = {
            ...(updatedNodeState[nodeId] as Record<string, unknown>),
            resolved: true,
            resolvedAt: new Date().toISOString(),
          };
        } else {
          updatedNodeState[nodeId] = {
            resolved: true,
            resolvedAt: new Date().toISOString(),
          };
        }
      }
      await db
        .update(projectsTable)
        .set({ nodeState: updatedNodeState })
        .where(eq(projectsTable.id, projectId));
    } catch (err) {
      logger.warn({ err }, "Failed to write nodeState back to DB — non-fatal");
    }
  }

  // When a ledger entry is committed, also mark the matching flow node as resolved
  if (savedMsgId && !isScenarioMode && !isFlowMode) {
    try {
      const committedEntries = await db
        .select({ title: entriesTable.title, id: entriesTable.id })
        .from(entriesTable)
        .where(
          and(
            eq(entriesTable.projectId, projectId),
            eq(entriesTable.status, "committed"),
            eq(entriesTable.sourceMessageId, savedMsgId)
          )
        );
      if (committedEntries.length > 0) {
        const currentNodeState = (project?.nodeState ?? {}) as Record<string, unknown>;
        const updatedNodeState = { ...currentNodeState };
        let changed = false;
        for (const entry of committedEntries) {
          const matchingNodeId = Object.keys(updatedNodeState).find(nodeId => {
            const node = updatedNodeState[nodeId] as Record<string, unknown>;
            return node?.label && typeof node.label === "string" &&
              node.label.toLowerCase().includes(entry.title.toLowerCase().slice(0, 20));
          });
          if (matchingNodeId) {
            updatedNodeState[matchingNodeId] = {
              ...(updatedNodeState[matchingNodeId] as Record<string, unknown>),
              resolved: true,
              resolvedAt: new Date().toISOString(),
              ledgerEntryId: entry.id,
            };
            changed = true;
          }
        }
        if (changed) {
          await db
            .update(projectsTable)
            .set({ nodeState: updatedNodeState })
            .where(eq(projectsTable.id, projectId));
        }
      }
    } catch (err) {
      logger.warn({ err }, "Failed to sync ledger entry to nodeState — non-fatal");
    }
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
    fileEdits: fileChangesAllowed && fileEdits.length > 0 ? fileEdits : undefined,
    fileEdit: fileChangesAllowed && fileEdits.length > 0 ? fileEdits[0] : undefined,
    linePatches: fileChangesAllowed && linePatches.length > 0 ? linePatches : undefined,
    plan: responsePlan ?? undefined,
    resolvedNodes: resolvedNodes.length > 0 ? resolvedNodes : undefined,
    autoFetchedFiles: autoFetchedFiles.length > 0 ? autoFetchedFiles : undefined,
    ...(flowNodes.length > 0 ? { flowNodes } : {}),
    ...(imageB64 ? { imageB64, imageMimeType } : {}),
    ...(autoName ? { autoName } : {}),
  };

  narrate(nar.done);
  res.write(`event: done\ndata: ${JSON.stringify(finalPayload)}\n\n`);
  res.end();
  } catch (err) {
    logger.error({ err, stack: err instanceof Error ? err.stack : undefined }, "POST /chat fatal error");
    throw err;
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

// ── Project Greeting — personalized opener from Atlas on workspace load ───────

router.get("/projects/:id/greeting", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const userId = (req as any).authUser.id as number;

  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, memory: projectsTable.memory, description: projectsTable.description })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));

  if (!project) { res.status(404).json({ error: "Not found" }); return; }

  const store = parseMemoryStore(project.memory ?? null);
  const intakeEntries = store.entries
    .filter((e) => e.tier === 1 && e.text.startsWith("INTAKE:"))
    .map((e) => e.text.replace(/^INTAKE:\s*/, ""));

  let greeting: string;

  if (intakeEntries.length > 0) {
    const intakeSummary = intakeEntries.join("\n");
    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 180,
        system: `You are Atlas — a strategic thinking partner inside Axiom. You're opening a project workspace. You already know key facts about this project from intake. Your job: write a single warm, sharp opening message that shows you know this project — without listing facts robotically. Acknowledge one specific thing you know, then ask one precise question to open the work. 2-3 sentences max. No greetings like "Hi" or "Hello". No fluff. Speak like a trusted partner who's been thinking about this.`,
        messages: [{
          role: "user",
          content: `Project: ${project.name}\n\nWhat I know:\n${intakeSummary}\n\nWrite the opening message.`,
        }],
      });
      greeting = msg.content.find((b) => b.type === "text")?.text?.trim() ?? fallbackGreeting(project.name);
    } catch {
      greeting = fallbackGreeting(project.name);
    }
  } else {
    greeting = fallbackGreeting(project.name);
  }

  res.json({ message: greeting });
});

function fallbackGreeting(projectName: string): string {
  const openers = [
    `${projectName} is open. What's the tension you're carrying into this session?`,
    `Back to ${projectName}. What's the thing you haven't said out loud yet?`,
    `${projectName} is ready. Where do you want to start — the problem or the plan?`,
    `Working on ${projectName}. What's the decision that's been sitting on the edge?`,
  ];
  return openers[Math.floor(Math.random() * openers.length)];
}

export default router;
