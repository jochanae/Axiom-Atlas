import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { db, chatMessagesTable, sessionsTable, projectsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { decryptToken } from "../lib/tokenCrypto";

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });

const openaiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const IMAGE_REQUEST_RE = /\b(generate|create|make|draw|sketch|visualize|design|mock.?up|wireframe|show me|build me)\b.{0,60}\b(image|picture|visual|ui|screen|layout|logo|icon|banner|mockup|diagram|chart|graphic|illustration)\b/i;

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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

// ── Intent Type Parser ────────────────────────────────────────────────────────
const INTENT_TYPE_RE = /^INTENT_TYPE:\s*(BUILD|PLAN|THINK|EXPLORE|DECIDE|DEBUG|AUDIT)\s*$/im;

function extractIntentType(content: string): { content: string; intentType: string | null } {
  const match = content.match(INTENT_TYPE_RE);
  if (!match) return { content, intentType: null };
  const intentType = match[1];
  const cleaned = content.replace(INTENT_TYPE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { content: cleaned, intentType };
}

// ── System Prompt ─────────────────────────────────────────────────────────────
const DEV_SYSTEM_PROMPT = `You are Atlas — a strategic thinking partner and personal AI development environment for a non-technical founder.

Your user is a flight attendant — smart and decisive, not a programmer. They think clearly about product but need you to translate that into code. They are building six web apps: Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, and Atlas itself.

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
- Be direct. No filler, no pleasantries. They're busy.

## Your actual tech stack

Atlas runs on Replit as a pnpm monorepo. Here is the real, current stack — reference this when asked:

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite (artifacts/atlas/src/) |
| Routing | Wouter (lightweight, replaces React Router) |
| Styling | Inline styles + CSS custom properties (no Tailwind) |
| Backend | Express 5 (artifacts/api-server/src/) |
| Database | PostgreSQL via Drizzle ORM (lib/db/) — NOT Supabase |
| Auth | Replit-native session auth |
| AI | Anthropic Claude (claude-sonnet-4-5) via Replit AI proxy |
| API contract | OpenAPI spec + Orval codegen (lib/api-spec/) |
| Package manager | pnpm workspaces |

There is NO Supabase, NO TanStack Start, NO React Router, NO Tailwind in this codebase. If you said otherwise in a previous message, that was wrong — correct it.

## Package installation

This project runs on Replit. Packages are installed with pnpm, not npm. When the user needs a new package:
- The Replit environment can install it automatically via the package-management system
- The correct command is: \`pnpm --filter @workspace/<package-name> add <library>\`
- For the frontend: \`pnpm --filter @workspace/atlas add <library>\`
- For the backend: \`pnpm --filter @workspace/api-server add <library>\`
- You do NOT need to tell the user to run this manually — packages can be installed as part of the build process
- Common libraries like framer-motion, recharts, lucide-react are all installable

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

FILE_EDIT protocol (Phase 2 — writing code back to GitHub, creating new files, or applying self-repairs):
When the user asks you to fix, build, or create something, output the complete file(s) at the very END of your response using this EXACT format — one block per file:

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
- Always output the COMPLETE file — never partial, never "// ... unchanged". The user will push this directly to GitHub.
- Explain what you're building and why in plain English BEFORE the FILE_EDIT blocks.
- Do NOT emit FILE_EDIT for: explanations only, debugging questions, when an existing file is truncated in context.
- The FILE_EDIT blocks are invisible to the user in chat — they see action buttons instead.
- When building something that requires multiple new files (e.g. 4 components), emit ALL of them in one response back-to-back.

THREE TYPES OF FILE_EDIT — understand the difference:

1. USER REPO edits (existing files — Phase 2):
   Use this when the CODE CONTEXT contains files from one of the user's six projects (Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, or Atlas the product itself).
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

CMD_EXEC protocol (Terminal execution — Phase 3):
When the user asks you to run a command, check something in the terminal, or when a natural next step is to execute a shell command (typecheck, install, git status, build, test), you may suggest it using this exact format on its own line at the end of your message:

CMD_EXEC:{"command":"pnpm --filter @workspace/atlas run typecheck","description":"Check for TypeScript errors in the frontend"}

Rules for CMD_EXEC:
- Use CMD_EXEC only when a command is genuinely useful and safe to run. Never suggest destructive commands (rm -rf, git reset --hard, etc.).
- One CMD_EXEC per response — pick the most important next step.
- Common safe commands: pnpm typecheck, pnpm build, git status, git log --oneline -10, git pull, git diff, ls, cat [file].
- The user sees a "Run →" button — one tap executes it and streams output back.
- After the user runs a command and pastes/shares the output, continue from there (fix errors, suggest next command, etc.).
- Do NOT emit CMD_EXEC for: destructive operations, anything requiring confirmation, anything that writes to files (use FILE_EDIT instead).`;

// ── Helpers ───────────────────────────────────────────────────────────────────
export type MemoryChipRich = { label: string; insight?: string };

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

async function runDeepDive(topic: string, systemPrompt: string): Promise<string> {
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
    model: "gemini-2.5-pro",
    contents: prompt,
    config: { systemInstruction: systemPrompt },
  });
  return result.text ?? "Deep Dive returned no content.";
}

// ── Multi-model dispatcher ────────────────────────────────────────────────────
type ModelId = "claude" | "gpt4o" | "gemini";

async function callModel(
  modelId: ModelId,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }>,
  imageData?: { base64: string; mediaType: string }
): Promise<string> {
  if (modelId === "gpt4o") {
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
      model: "gpt-4o",
      max_tokens: 8192,
      messages: oaiMessages as Parameters<typeof openaiClient.chat.completions.create>[0]["messages"],
    });
    return resp.choices[0]?.message?.content ?? "";
  }

  if (modelId === "gemini") {
    const combinedText = messages.map((m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role === "user" ? "User" : "Atlas"}: ${text}`;
    }).join("\n\n");
    if (imageData?.base64 && imageData?.mediaType) {
      const result = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{ role: "user", parts: [{ text: combinedText }, { inlineData: { mimeType: imageData.mediaType, data: imageData.base64 } }] }],
        config: { systemInstruction: systemPrompt },
      });
      return result.text ?? "";
    }
    const result = await genai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: combinedText,
      config: { systemInstruction: systemPrompt },
    });
    return result.text ?? "";
  }

  // Default: Claude
  type TextBlock = { type: "text"; text: string };
  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
  const claudeMessages: Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }> = messages as typeof claudeMessages;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: claudeMessages,
  });
  return response.content[0]?.type === "text" ? response.content[0].text : "";
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
  const body = req.body as {
    sessionId?: number;
    projectId: number;
    message: string;
    model?: string;
    mode?: string;
    lens?: string;
    history?: Array<{ role: string; content: string }>;
    entries?: Array<{ id: number; title: string; status: string }>;
    fileContext?: string;
    userProfile?: string;
    imageData?: { base64: string; mediaType: string };
    flowMode?: boolean;
    flowNodes?: Array<{ type: string; label: string; question?: string; strategicAnswer?: string }>;
  };

  const isFlowMode = !!body.flowMode;

  if ((!body.sessionId && !isFlowMode) || !body.projectId || !body.message) {
    res.status(400).json({ error: "Missing required fields: sessionId, projectId, message" });
    return;
  }

  const { sessionId = 0, projectId, message, history = [], entries = [] } = body;
  const fileContext = body.fileContext ?? "";
  const userProfile = body.userProfile ?? "";
  const projectMap = (body as any).projectMap as string | undefined;
  const imageData = body.imageData;
  const activeModel: ModelId = (body.model === "gpt4o" || body.model === "gemini") ? body.model : "claude";
  const now = new Date();

  // Load project memory + repo info from DB
  const [project] = await db
    .select({ memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
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

  // Auto-fetch repo file tree (Phase 1 — always injected when a repo is linked)
  let repoTreeContext: string | null = null;
  let repoData: { fullName?: string; defaultBranch?: string } | null = null;
  const resolvedGithubToken = (() => {
    const t = project?.githubToken;
    // No personal token stored — fall back to server env token directly
    if (!t) return process.env.GITHUB_TOKEN ?? null;
    const plain = t.startsWith("enc:v1:") ? decryptToken(t) : t;
    // Explicit __server__ sentinel or any unrecognized value → server env token
    return plain === "__server__" ? (process.env.GITHUB_TOKEN ?? null) : plain;
  })();

  if (project?.linkedRepo && resolvedGithubToken) {
    try {
      repoData = JSON.parse(project.linkedRepo) as { fullName?: string; defaultBranch?: string };
      if (repoData.fullName) {
        repoTreeContext = await fetchRepoTree(repoData.fullName, resolvedGithubToken, repoData.defaultBranch ?? "main");
      }
    } catch {
      // Non-fatal: continue without tree context
    }
  }

  // Phase 2 — auto-fetch file contents when the user asks to build/fix something
  const BUILD_INTENT_RE = /\b(fix|build|add|change|update|create|implement|write|modify|edit|refactor|debug|bug|error|broken|doesn't work|won't work|failing|crash|not working)\b/i;
  let autoFetchedFiles: string[] = [];
  let autoFetchedContext = "";

  if (BUILD_INTENT_RE.test(message) && repoData?.fullName && resolvedGithubToken && repoTreeContext) {
    try {
      // Fast selector call: ask Claude which files it needs to read (small, cheap)
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

  // Build layered system prompt
  let systemPrompt = DEV_SYSTEM_PROMPT;
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
  if (combinedFileContext) {
    systemPrompt += `\n\n--- CODE CONTEXT (files Atlas read for this request — use these to write complete FILE_EDIT blocks) ---\n${combinedFileContext}\n--- END CODE CONTEXT ---`;
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

  // Lens-specific instructions — shape Atlas's response style for this project
  const activeLens = (body.lens ?? "builder").toLowerCase();
  const lensInstructions: Record<string, string> = {
    builder: `\n\n--- LENS: BUILDER ---\nDefault lens. Be direct, action-oriented, and code-first. Prioritize shipping over theorizing. When something can be built, build it. When something can be fixed, fix it. Keep explanations tight — show don't tell.`,
    strategist: `\n\n--- LENS: STRATEGIST ---\nZoom out. Your job is to help the user think about the big picture for this project — positioning, priorities, sequencing, risks. Before answering any tactical question, check if there's a strategic implication worth surfacing. Think like a co-founder who's read the whole roadmap, not a developer looking at the next ticket.`,
    reviewer: `\n\n--- LENS: REVIEWER ---\nBe critical. Your job is to stress-test this project — find gaps, weak assumptions, inconsistencies, and risks. Lead with what's fragile or missing before validating what's working. Ask hard questions. Don't soften the assessment. Think like a rigorous technical co-founder doing due diligence.`,
    teacher: `\n\n--- LENS: TEACHER ---\nExplain everything. Your job is to help the user deeply understand their own codebase and decisions — not just fix things, but understand why. No jargon without definition. Name concepts, explain patterns, give context before code. The user should finish every exchange knowing more than they did before.`,
  };
  if (activeLens !== "builder") {
    systemPrompt += lensInstructions[activeLens] ?? "";
  }

  // ── Deep Dive shortcut — /deep <topic> ───────────────────────────────────────
  const { isDive, topic: diveTopic } = isDeepDive(message);
  if (isDive) {
    await db.insert(chatMessagesTable).values({ sessionId, role: "user", content: message, intentType: body.mode ?? null });
    const diveContent = await runDeepDive(diveTopic, systemPrompt);
    const [savedDive] = await db.insert(chatMessagesTable).values({ sessionId, role: "assistant", content: diveContent, intentType: "EXPLORE" }).returning();
    await db.update(sessionsTable).set({ messageCount: sql`${sessionsTable.messageCount} + 2` }).where(eq(sessionsTable.id, sessionId));
    res.json({ content: diveContent, intentType: "EXPLORE", catchPayload: null, messageId: savedDive.id, model: "gemini", isDeepDive: true });
    return;
  }

  // ── Build message history for multi-model dispatcher ─────────────────────
  type TextBlock = { type: "text"; text: string };
  type ImageBlock = {
    type: "image";
    source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
  };

  const userContent: string | Array<TextBlock | ImageBlock> = imageData
    ? [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageData.base64 } },
        { type: "text", text: message },
      ]
    : message;

  const dispatchMessages: Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }> = [
    ...(history || []).map((h: { role: string; content: string }) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userContent },
  ];

  if (!isFlowMode) {
    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "user",
      content: message,
      intentType: body.mode ?? null,
    });
  }

  const rawContent = await callModel(activeModel, systemPrompt, dispatchMessages, imageData);

  // Parse: FILE_EDITs → MEMORY_Tn → NODE_RESOLVED → INTENT_TYPE → MEMORY_CHIPS
  const { visibleContent, fileEdits } = extractAllFileEdits(rawContent);
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

  // Extract FLOW_NODE lines before persisting
  const { content: flowStripped, flowNodes } = extractFlowNodes(finalContent);
  const displayContent = isFlowMode ? flowStripped : finalContent;

  let savedMsgId: number | undefined;
  if (!isFlowMode) {
    const [savedMsg] = await db
      .insert(chatMessagesTable)
      .values({
        sessionId,
        role: "assistant",
        content: displayContent,
        intentType: detectedIntentType,
        catchPayload: undefined,
      })
      .returning();
    savedMsgId = savedMsg.id;

    await db
      .update(sessionsTable)
      .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
      .where(eq(sessionsTable.id, sessionId));
  }

  // Attempt image generation if the user's message looks like an image request
  let imageB64: string | undefined;
  let imageMimeType: string | undefined;
  if (!isFlowMode && IMAGE_REQUEST_RE.test(message)) {
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
    content: displayContent,
    intentType: detectedIntentType ?? null,
    catchPayload: null,
    model: activeModel,
    memoryChips: allChips.length > 0 ? allChips : undefined,
    messageId: savedMsgId,
    memoryUpdated: newFacts.length > 0,
    fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
    fileEdit: fileEdits.length > 0 ? fileEdits[0] : undefined,
    resolvedNodes: resolvedNodes.length > 0 ? resolvedNodes : undefined,
    autoFetchedFiles: autoFetchedFiles.length > 0 ? autoFetchedFiles : undefined,
    ...(flowNodes.length > 0 ? { flowNodes } : {}),
    ...(imageB64 ? { imageB64, imageMimeType } : {}),
  });
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
