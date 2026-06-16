import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { db, nexusMessagesTable, projectsTable, entriesTable, sessionsTable, conversationsTable, scheduledChecksTable, checkResultsTable } from "@workspace/db";
import { eq, asc, and, inArray, desc, isNull, isNotNull, sql, gte, type SQL } from "drizzle-orm";
import { loadVaultContext } from "../lib/vaultContext";
import { getGithubTokenForUser, bootstrapGitHubRepo } from "../lib/githubBootstrap";
import { extractPageUrls, screenshotUrlsToBlocks, buildUrlNote } from "../lib/urlScreenshot";
import { findSemanticTensionsForProject } from "./tensions";
import { calculateModelCostUsd } from "../pricing";
import { logger } from "../lib/logger";
import { ATLAS_PLATFORM_KNOWLEDGE } from "../lib/atlasKnowledge";
import { ATLAS_IDENTITY } from "../lib/atlasIdentity";
import { createProjectForUser, ProjectLimitReachedError } from "../lib/projectCreation";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });
const MAX_VAULT_B64_SIZE = 1500000;

type HandoffSignal = {
  readyToHandoff: boolean;
  confidence: "high" | "medium" | "low";
  projectName: string | null;
  reason: string | null;
};

type HomeUserType = "idea" | "building" | "clients" | "portfolio";

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

type NexusRunMetadata = {
  executionTimeMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  runStatus: RunStatus;
  runSummary?: string | null;
  runActions?: RunAction[] | null;
  runArtifacts?: RunArtifact[] | null;
};

type FocusLedgerEntry = {
  id: number;
  title: string;
  status: string;
  deviation: boolean;
  catchAgainstId: number | null;
  supersedesId: number | null;
};

type FlowMapNode = {
  label: string;
  type: string;
  answered: boolean;
  meta?: string;
};

type CreateProjectToolInput = {
  name: string;
  summary: string;
};

const HOME_OPENING_FALLBACKS = [
  "What are you turning over?",
  "What decision keeps coming back?",
  "What's the constraint you haven't named yet?",
  "Where did the last session leave things?",
  "What would have to be true for this to work?",
];

const IDEA_MODE_SIGNALS = [
  "i have an idea",
  "i want to think through",
  "what if",
  "i've been thinking about",
  "ive been thinking about",
  "is this a good idea",
  "help me think",
  "i thought of something",
  "years ago i thought",
  "could this work",
  "validate this",
];

const IDEA_MODE_EXPLICIT_SIGNALS = [
  "idea mode",
  "let's explore an idea",
  "lets explore an idea",
];

const IDEA_MODE_POSTURE = `--- IDEA MODE ACTIVE ---
idea_mode: true

Atlas should feel like a thoughtful person sitting across from the user — not a project management system.

BEHAVE differently:
- Be expansive, not convergent. Open possibilities, don't narrow too fast.
- Ask one question at a time. Never ask multiple questions at once.
- Be genuinely curious. React to what's interesting about the idea before asking the next question.
- Never ask about code, GitHub, tech stack, or building. This is thinking, not building.
- Never suggest committing decisions too early. Let the idea breathe first.
- Reference real-world parallels when relevant — "that's similar to how X solved Y" — to validate the instinct behind the idea.
- Be honest about risks and gaps without killing momentum. "The interesting tension here is..."
- Never ask "what are we building?"

FOLLOW THIS CONVERSATION ARC:
Phase 1 — Understand the idea (2-3 exchanges)
  "What is it? Walk me through it."
  Listen. Reflect back. Ask about the core mechanism.

Phase 2 — Validate the instinct (2-3 exchanges)
  Who needs this? Why now? What exists already?
  What does the person with this problem feel today?

Phase 3 — Map the opportunity (2-3 exchanges)
  Where does this go? What's the biggest version?
  What would make it fail? What would make it win?

Phase 4 — Identify next steps (1-2 exchanges)
  What's the single most important thing to figure out next? What can be done this week?

After Phase 4, naturally offer:
"I have enough to put together a Blueprint for this. Want me to generate it?"

BLUEPRINT GENERATION:
When the user says yes to generating a blueprint, or says "generate blueprint", "make the blueprint", or "give me the blueprint", call POST /api/projects/:id/blueprint with the full conversation context.
Then respond with: "Blueprint ready. You can find it in your project."

IDEA MODE SUPPRESSES:
- All ledger injection (no committed decisions shown)
- All readiness score injection
- All GitHub/repo context
- All flow map state
- Cross-project tensions
- Decision write protocol
- The question "what are we building?"
--- END IDEA MODE ---`;

function parseHomeUserType(value: unknown): HomeUserType | null {
  return value === "idea" || value === "building" || value === "clients" || value === "portfolio"
    ? value
    : null;
}

function randomFallbackOpening(): string {
  return HOME_OPENING_FALLBACKS[Math.floor(Math.random() * HOME_OPENING_FALLBACKS.length)];
}

function normalizeIdeaModeText(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function hasIdeaModeSignal(value: string): boolean {
  const text = normalizeIdeaModeText(value);
  return IDEA_MODE_SIGNALS.some((signal) => text.includes(signal));
}

function hasExplicitIdeaModeSignal(value: string): boolean {
  const text = normalizeIdeaModeText(value);
  return IDEA_MODE_EXPLICIT_SIGNALS.some((signal) => text.includes(signal));
}

function userTypeOpeningGuidance(userType: HomeUserType | null): string {
  if (userType === "idea") return "The user came in with an idea. Focus the question on the problem and gap.";
  if (userType === "building") return "The user is already building. Focus the question on current blockers and momentum.";
  if (userType === "clients") return "The user runs projects for clients. Focus the question on delivery and oversight challenges.";
  if (userType === "portfolio") return "The user manages multiple products. Focus the question on what is most urgent across everything.";
  return "Choose the most natural question style from the project name.";
}

async function generateHomeOpening(projectName: string | null, userType: HomeUserType | null): Promise<string> {
  if (!projectName?.trim()) return randomFallbackOpening();

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are Atlas — a strategic thinking partner for builders and founders.

The user just created or opened a project named: "${projectName.trim()}"

Generate a single opening message that:
1. References the project name directly — prove you heard it
2. Asks ONE question that deepens context — not "what are you building?" (too generic) but something that assumes they already know what they're building and pushes one level deeper
3. Feels like a conversation already in motion, not a fresh start
4. Is 1-3 sentences maximum — never longer
5. Has no greeting preamble ("Hi!", "Welcome!", "Great!" — never use these)

Choose the question style based on the project name:
- If the name sounds like a tool/platform → ask what problem it solves
- If the name sounds like a product/app → ask who it's for
- If the name sounds abstract/conceptual → ask what it becomes when fully realized
- If the name sounds like it's replacing something → ask what already exists and why it's not enough

Onboarding context:
${userTypeOpeningGuidance(userType)}

Examples of good opening messages:
- "Axiom Atlas — got it. What's the biggest thing you want this to solve that nothing else has solved for you?"
- "You named this 'CoinsBloom.' Tell me who this is really for — the person who needs it most."
- "Compani. What does this become when it's working exactly the way you imagined?"

Never say: "Tell me what you're working on", "What are you building?", "How can I help?", "Welcome", "Hi", "Great choice"

Respond with only the opening message. Nothing else.`,
      }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (!text || /\b(how can i help|welcome|hi\b|great choice|what are you building|tell me what you're working on)\b/i.test(text)) {
      return `${projectName.trim()}. What does this need to solve that is not solved well enough yet?`;
    }
    return text.replace(/^["']|["']$/g, "").trim();
  } catch {
    return `${projectName.trim()}. What does this need to solve that is not solved well enough yet?`;
  }
}

function parseJsonObject<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned) as T;
  } catch {
    return null;
  }
}

type NexusTitleMessage = { role: "user" | "assistant"; content: string };

const CONVERSATION_TITLE_PROMPT = "Based on this conversation, generate a short working title (3-5 words, Title Case, no punctuation). Respond with only the title.";

function cleanConversationTitle(raw: string): string | null {
  const cleaned = raw
    .split("\n")[0]
    .replace(/[*_`]/g, "")
    .replace(/[""'']/g, "")
    .replace(/[.!?]$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 80) return null;
  return cleaned;
}

function extractExplicitConversationTitle(content: string): string | null {
  const patterns = [
    /\blet['']?s\s+call\s+(?:it|this)\s+["'`*]*([^"'\n.,!?;:—–*]+)/i,
    /\bname\s*:\s*["'`*]*([^"'\n.,!?;:—–*]+)/i,
    /\bi(?:['']?d|\s+would)\s+call\s+this\s+["'`*]*([^"'\n.,!?;:—–*]+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    const title = match?.[1] ? cleanConversationTitle(match[1]) : null;
    if (title) return title;
  }

  return null;
}

async function generateConversationTitle(messages: NexusTitleMessage[]): Promise<string | null> {
  const context = messages
    .slice(-3)
    .map((m) => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`)
    .join("\n\n");
  if (!context) return null;

  try {
    const titleResp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [{
        role: "user",
        content: `${CONVERSATION_TITLE_PROMPT}\n\nConversation:\n${context}`,
      }],
    });
    const raw = titleResp.content[0]?.type === "text" ? titleResp.content[0].text.trim() : "";
    return cleanConversationTitle(raw);
  } catch {
    return null;
  }
}

async function detectHomeHandoff(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<HandoffSignal | null> {
  if (messages.length < 4) return null;
  const context = messages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`)
    .join("\n\n");
  const prompt = `Given this conversation, respond with JSON only:
{
  "readyToHandoff": true/false,
  "confidence": "high" | "medium" | "low",
  "projectName": "suggested name for this project or null",
  "reason": "one sentence why this is ready to build, or null"
}

It is ready to handoff if:
- A specific product, feature, or system has been identified
- At least one concrete requirement or goal has been discussed
- The conversation has moved beyond pure exploration into planning or decision-making
- 4 or more messages have been exchanged

Return readyToHandoff: false if it's still early exploration or casual conversation.

Conversation:
${context}`;

  try {
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = result.content[0]?.type === "text" ? result.content[0].text : "";
    const parsed = parseJsonObject<HandoffSignal>(raw);
    if (!parsed?.readyToHandoff) return null;
    if (parsed.confidence !== "high" && parsed.confidence !== "medium") return null;
    return {
      readyToHandoff: true,
      confidence: parsed.confidence,
      projectName: typeof parsed.projectName === "string" && parsed.projectName.trim() ? parsed.projectName.trim() : null,
      reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : null,
    };
  } catch {
    return null;
  }
}

const NEXUS_SYSTEM_PROMPT = `${ATLAS_IDENTITY}

Your user is building products from her phone — entirely on her own, non-technical by training but sharp on product. Your job is to help her think across the whole portfolio, not just the project in front of her. You connect dots she hasn't connected, surface contradictions she hasn't named, find synergies she hasn't seen.

From this home view you see everything at once. You are not inside any single workspace right now, which means you think portfolios not files.

From here you cannot read code files or push to GitHub — that lives in the workspace. But you can see every project, every committed decision, every cross-project tension. You can help her think, decide, commit, and then take her where she needs to go.

## Project Creation
You have a real create_project tool. Use it to create a new project workspace when an idea has become concrete enough to start building and the user has confirmed they want to proceed.

When the user confirms they want a project created, CALL THE TOOL. Do not narrate fake API calls, do not write pseudo-code, and do not say "creating now" unless you are actually calling create_project.

If create_project is unavailable or fails, say so honestly and explain the failure briefly. Never pretend a project was created.

## Navigation
When the user wants to go to a specific project workspace, end your response with exactly this line:
NAVIGATE_TO:{"route":"/project/<id>"}

Replace <id> with the numeric project id. Use this when the user says "take me there", "let's go", "open that project", "jump in", or when you suggest moving to the workspace and they agree. Do not say "I'll take you there" without emitting this token — that's a broken promise.

After create_project succeeds, always end your response with NAVIGATE_TO:{"route":"/project/<id>"} using the id returned in the tool result. Do not ask for confirmation — navigate immediately.

When she commits a decision, says "lock that in" or "commit that" — call POST /api/entries with a committed decision.
When she says "park that" — call POST /api/entries with a parked item.
When she says "override that" — call PATCH /api/entries/:id with {status: "overridden"}.
When something she says conflicts with a committed decision, flag it: "This conflicts with a committed decision: [title]."
When she says "scan this project" — call POST /api/projects/:projectId/scan.
When she answers a flow map node — call PATCH /api/projects/:projectId/flow-nodes/:nodeId.
When she says "add that to the map" — call POST /api/projects/:projectId/flow-nodes.

When you learn something durable, write it at the END of your response on its own line:
MEMORY_T1: [core principle — never decays]
MEMORY_T2: [pattern or how she thinks — 180 days]
MEMORY_T3: [insight or pivot — 90 days]
MEMORY_T4: [current state — 30 days]
MEMORY_T5: [passing thought — 7 days]

Save up to 3 MEMORY_Tn lines per response when she shares something significant.
`;

const CREATE_PROJECT_TOOL: Anthropic.Tool = {
  name: "create_project",
  description: "Create a new project workspace when an idea has become concrete enough to start building. Only call this after the user has confirmed they want to proceed.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short project name" },
      summary: { type: "string", description: "1-2 sentence summary of what this project is" },
    },
    required: ["name", "summary"],
  },
};

const CONVERSATIONAL_EXPANSION_PROTOCOL = `--- CONVERSATIONAL EXPANSION PROTOCOL ---
After the user responds to your opening question, your goal is to build a complete picture of the project through natural conversation — not a form, not a checklist, not bullet points.

Guide the conversation through these dimensions, one at a time, only when natural:
1. The problem — what does this solve that doesn't exist yet?
2. The audience — who needs this most and why?
3. The gap — what already exists and why is it not enough?
4. The hard part — what's the piece they haven't figured out yet?
5. The vision — what does it look like when it's fully realized?

Rules:
- Ask ONE question at a time. Never list multiple questions.
- When you have enough context on a dimension, move to the next naturally
- Do not announce what you're doing ("Now let's talk about your audience")
- When all five dimensions have been explored, surface the handoff signal
- The handoff signal is: "This is ready to take into a workspace. Want me to set it up with everything we've mapped?"

--- END PROTOCOL ---`;

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

function buildInitialProjectMemory(summary: string): string {
  const now = new Date().toISOString();
  const store: MemoryStore = {
    v: 2,
    entries: [{
      tier: 1,
      text: `Initial project summary from Global Insight: ${summary}`,
      createdAt: now,
      retrievalCount: 0,
      lastRetrievedAt: null,
    }],
  };
  return JSON.stringify(store);
}

function parseCreateProjectToolInput(input: unknown): CreateProjectToolInput | null {
  if (!isRecord(input)) return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!name || !summary) return null;
  return { name, summary };
}

function mergeNullableNumbers(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return a + b;
}

function mergeModelUsage(
  current: Partial<NexusRunMetadata>,
  next: Partial<NexusRunMetadata>,
): Partial<NexusRunMetadata> {
  return {
    ...current,
    executionTimeMs: (current.executionTimeMs ?? 0) + (next.executionTimeMs ?? 0),
    inputTokens: mergeNullableNumbers(current.inputTokens, next.inputTokens),
    outputTokens: mergeNullableNumbers(current.outputTokens, next.outputTokens),
    costUsd: mergeNullableNumbers(current.costUsd, next.costUsd),
  };
}

function memoryHasConversationContext(raw: string | null, store: MemoryStore, conversationId: string): boolean {
  const conversationIdLine = `[conversation_id: ${conversationId}]`;
  return Boolean(raw?.includes(conversationIdLine))
    || store.entries.some((entry) => entry.text.includes(conversationIdLine));
}

function nexusContextRole(role: string): string {
  return role === "user" ? "user" : "atlas";
}

function buildConversationContextBlock(
  conversationId: string,
  timestamp: string,
  messages: Array<{ role: string; content: string }>,
): string {
  return [
    "--- CONVERSATION CONTEXT ---",
    "[source: nexus]",
    `[conversation_id: ${conversationId}]`,
    `[timestamp: ${timestamp}]`,
    "",
    ...messages.map((message) => `[${nexusContextRole(message.role)}]: ${message.content.trim()}`),
    "--- END CONVERSATION CONTEXT ---",
  ].join("\n");
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

function parseRepo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : ((parsed as any).fullName ?? null);
  } catch {
    return raw.includes("/") ? raw : null;
  }
}

const SYSTEM_NODE_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);
const FLOW_NODE_TYPES = new Set(["goal", "requirement", "blocker", "priority", "decision", "sprint", "wont"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatTitles(entries: Array<{ title: string }>): string {
  return entries.length > 0 ? entries.map((entry) => entry.title).join("; ") : "none";
}

function groupLedgerEntries(entries: FocusLedgerEntry[]) {
  const childrenBySupersedes = new Map<number, FocusLedgerEntry[]>();
  for (const entry of entries) {
    if (entry.supersedesId == null) continue;
    const children = childrenBySupersedes.get(entry.supersedesId) ?? [];
    children.push(entry);
    childrenBySupersedes.set(entry.supersedesId, children);
  }

  const inTensionIds = new Set<number>();
  const overriddenIds = new Set<number>();
  for (const entry of entries) {
    if (entry.status !== "committed") continue;
    const children = childrenBySupersedes.get(entry.id) ?? [];
    if (children.some((child) => child.deviation && child.status === "committed")) {
      overriddenIds.add(entry.id);
    }
    if (children.some((child) => child.catchAgainstId === entry.id && child.status !== "committed")) {
      inTensionIds.add(entry.id);
    }
  }

  return {
    committed: entries.filter((entry) => (
      entry.status === "committed" && !entry.deviation && !inTensionIds.has(entry.id) && !overriddenIds.has(entry.id)
    )),
    parked: entries.filter((entry) => entry.status === "parked"),
    inTension: entries.filter((entry) => inTensionIds.has(entry.id)),
    overridden: entries.filter((entry) => (
      entry.status === "committed" && (entry.deviation || overriddenIds.has(entry.id))
    )),
  };
}

function extractFlowMapNodes(nodeState: unknown): FlowMapNode[] {
  if (!isRecord(nodeState)) return [];
  return Object.entries(nodeState).flatMap(([id, raw]): FlowMapNode[] => {
    if (SYSTEM_NODE_IDS.has(id) || !isRecord(raw)) return [];
    const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "";
    const type = typeof raw.type === "string" && FLOW_NODE_TYPES.has(raw.type) ? raw.type : "";
    if (!label || !type) return [];
    const strategicAnswer = typeof raw.strategicAnswer === "string" ? raw.strategicAnswer.trim() : "";
    const answered = Boolean(strategicAnswer) || raw.resolved === true;
    const meta = typeof raw.meta === "string" ? raw.meta : typeof raw.moscow === "string" ? raw.moscow : undefined;
    return [{ label, type, answered, ...(meta ? { meta } : {}) }];
  });
}

function computeArchitectureReadiness(flowNodes: FlowMapNode[]): number {
  const scoredNodes = flowNodes.filter((node) => !(node.type === "priority" && node.meta === "wont"));
  if (scoredNodes.length === 0) return 0;
  return Math.round((scoredNodes.filter((node) => node.answered).length / scoredNodes.length) * 100);
}

function computeDecisionReadiness(entries: FocusLedgerEntry[]): number {
  if (entries.length === 0) return 0;
  const committedCount = entries.filter((entry) => entry.status === "committed").length;
  return Math.round((committedCount / entries.length) * 100);
}

function computeBlendedReadiness(architectureScore: number, decisionsScore: number): number {
  return Math.round(architectureScore * 0.6 + decisionsScore * 0.4);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractRunSummary(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*•]\s*/, "").trim())
    .find((line) => line.length > 0);
  if (!cleaned) return "Atlas response completed.";
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trim()}...` : cleaned;
}

function resolveRunStatus(actions?: RunAction[] | null): RunStatus {
  if (!actions?.length) return "completed";
  if (actions.some((action) => action.status === "fail")) return "failed";
  if (actions.some((action) => action.status === "warn")) return "warnings";
  return "completed";
}

function buildRunMetadata(content: string, usage: Partial<NexusRunMetadata> = {}): NexusRunMetadata {
  const runActions = usage.runActions ?? null;
  return {
    executionTimeMs: usage.executionTimeMs ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    costUsd: usage.costUsd ?? null,
    runStatus: usage.runStatus ?? resolveRunStatus(runActions),
    runSummary: usage.runSummary ?? extractRunSummary(content),
    runActions,
    runArtifacts: usage.runArtifacts ?? null,
  };
}

function failedRunMetadata(summary: string, status: RunStatus = "failed"): NexusRunMetadata {
  return {
    executionTimeMs: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    runStatus: status,
    runSummary: summary,
    runActions: [{ verb: status === "cancelled" ? "Cancelled" : "Failed", target: "Atlas response", status: status === "cancelled" ? "warn" : "fail" }],
    runArtifacts: null,
  };
}

async function updateSessionRunMetadata(sessionId: number | null, runMetadata: NexusRunMetadata): Promise<void> {
  if (!sessionId) return;
  await db
    .update(sessionsTable)
    .set({
      totalInputTokens: sql`coalesce(${sessionsTable.totalInputTokens}, 0) + ${runMetadata.inputTokens ?? 0}`,
      totalOutputTokens: sql`coalesce(${sessionsTable.totalOutputTokens}, 0) + ${runMetadata.outputTokens ?? 0}`,
      totalCostUsd: sql`coalesce(${sessionsTable.totalCostUsd}, 0) + ${runMetadata.costUsd ?? 0}`,
      totalExecutionMs: sql`coalesce(${sessionsTable.totalExecutionMs}, 0) + ${runMetadata.executionTimeMs ?? 0}`,
      runStatus: runMetadata.runStatus,
      runSummary: runMetadata.runSummary ?? null,
      runActions: runMetadata.runActions ?? null,
      runArtifacts: runMetadata.runArtifacts ?? null,
    })
    .where(eq(sessionsTable.id, sessionId));
}

type NexusMessageRow = {
  id: number;
  userId: number;
  role: string;
  content: string;
  conversationId: string | null;
  messageType: string | null;
  createdAt: Date;
};

let nexusMessageTypeColumnExistsCache: boolean | null = null;

async function hasNexusMessageTypeColumn(): Promise<boolean> {
  if (nexusMessageTypeColumnExistsCache !== null) return nexusMessageTypeColumnExistsCache;
  try {
    const rows = await db.execute(sql`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nexus_messages'
        AND column_name = 'message_type'
      LIMIT 1
    `);
    nexusMessageTypeColumnExistsCache = Array.isArray(rows) ? rows.length > 0 : (rows as any).rowCount > 0;
  } catch {
    nexusMessageTypeColumnExistsCache = false;
  }
  return nexusMessageTypeColumnExistsCache;
}

function nonBriefingMessages(whereClause: SQL | undefined, hasMessageType = true) {
  if (!hasMessageType) return whereClause;
  return and(
    whereClause,
    sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
  );
}

function conversationMessages(whereClause: SQL | undefined, hasMessageType = true) {
  return nonBriefingMessages(whereClause, hasMessageType);
}

async function loadNexusMessages(whereClause: SQL | undefined, hasMessageType: boolean): Promise<NexusMessageRow[]> {
  const baseSelect = {
    id: nexusMessagesTable.id,
    userId: nexusMessagesTable.userId,
    role: nexusMessagesTable.role,
    content: nexusMessagesTable.content,
    conversationId: nexusMessagesTable.conversationId,
    createdAt: nexusMessagesTable.createdAt,
  };

  if (!hasMessageType) {
    const rows = await db
      .select(baseSelect)
      .from(nexusMessagesTable)
      .where(whereClause)
      .orderBy(asc(nexusMessagesTable.createdAt));
    return rows.map((row) => ({
      ...row,
      messageType: null,
    }));
  }

  const rows = await db
    .select({ ...baseSelect, messageType: nexusMessagesTable.messageType })
    .from(nexusMessagesTable)
    .where(whereClause)
    .orderBy(asc(nexusMessagesTable.createdAt));
  return rows;
}

async function loadRecentNexusMessagesForConversation(
  userId: number,
  conversationId: string,
  hasMessageType: boolean,
): Promise<Array<{ role: string; content: string }>> {
  const whereClause = conversationId === "__legacy__"
    ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
    : and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId));
  const rows = await db
    .select({
      id: nexusMessagesTable.id,
      role: nexusMessagesTable.role,
      content: nexusMessagesTable.content,
      createdAt: nexusMessagesTable.createdAt,
    })
    .from(nexusMessagesTable)
    .where(nonBriefingMessages(whereClause, hasMessageType))
    .orderBy(desc(nexusMessagesTable.createdAt), desc(nexusMessagesTable.id))
    .limit(10);

  return rows
    .reverse()
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
    .filter((message) => message.content.trim().length > 0);
}

// GET /api/nexus/thread — return a conversation thread (optionally scoped by conversationId)
router.get("/nexus/thread", async (req, res): Promise<void> => {
  console.log("nexus/thread userId:", (req as any).session?.userId);
  try {
    const userId = (req as any).authUser.id as number;
    const conversationId = req.query.conversationId as string | undefined;
    const userType = parseHomeUserType(req.query.userType);
    const focusProjectId = Number(req.query.focusProjectId);

    const whereClause = conversationId === "__legacy__"
      ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
      : conversationId
        ? and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId))
        : eq(nexusMessagesTable.userId, userId);

    const hasMessageType = await hasNexusMessageTypeColumn();
    const messages = await loadNexusMessages(nonBriefingMessages(whereClause, hasMessageType), hasMessageType);

    if (messages.length === 0 && conversationId && conversationId !== "__legacy__") {
      const [existingBriefing] = hasMessageType
        ? await db
            .select({ id: nexusMessagesTable.id })
            .from(nexusMessagesTable)
            .where(and(whereClause, eq(nexusMessagesTable.messageType, "briefing")))
            .limit(1)
        : [];
      if (existingBriefing) {
        res.json([]);
        return;
      }

      const [project] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(
          Number.isInteger(focusProjectId) && focusProjectId > 0
            ? and(eq(projectsTable.userId, userId), eq(projectsTable.id, focusProjectId))
            : eq(projectsTable.userId, userId)
        )
        .orderBy(desc(projectsTable.updatedAt))
        .limit(1);
      const opening = await generateHomeOpening(project?.name ?? null, userType);
      const [savedOpening] = hasMessageType
        ? await db
            .insert(nexusMessagesTable)
            .values({ userId, role: "assistant", content: opening, conversationId, messageType: "briefing" })
            .returning({
              id: nexusMessagesTable.id,
              role: nexusMessagesTable.role,
              content: nexusMessagesTable.content,
              messageType: nexusMessagesTable.messageType,
              createdAt: nexusMessagesTable.createdAt,
            })
        : await db
            .insert(nexusMessagesTable)
            .values({ userId, role: "assistant", content: opening, conversationId })
            .returning({
              id: nexusMessagesTable.id,
              role: nexusMessagesTable.role,
              content: nexusMessagesTable.content,
              createdAt: nexusMessagesTable.createdAt,
            });
      res.json([{
        id: savedOpening.id,
        role: savedOpening.role,
        content: savedOpening.content,
        isBriefing: hasMessageType && "messageType" in savedOpening ? savedOpening.messageType === "briefing" : true,
        executionTimeMs: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        runStatus: null,
        runSummary: null,
        runActions: null,
        runArtifacts: null,
        execution_time_ms: null,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        run_status: null,
        run_summary: null,
        run_actions: null,
        run_artifacts: null,
        createdAt: savedOpening.createdAt.toISOString(),
      }]);
      return;
    }

    res.json(messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      isBriefing: m.messageType === "briefing",
      executionTimeMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      runStatus: null,
      runSummary: null,
      runActions: null,
      runArtifacts: null,
      execution_time_ms: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      run_status: null,
      run_summary: null,
      run_actions: null,
      run_artifacts: null,
      createdAt: m.createdAt.toISOString(),
    })));
    return;
  } catch (err: any) {
    console.error("nexus/thread error:", err?.message, err?.stack);
    res.status(500).json({ error: "Failed to load thread", detail: err?.message });
    return;
  }
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

router.post("/nexus/conversation/save", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const { messages, title } = req.body as {
      messages: Array<{ role: string; content: string }>;
      title?: string;
    };
    if (!messages?.length) { res.status(400).json({ error: "No messages" }); return; }

    const autoTitle = title || messages.find(m => m.role === "user")?.content?.slice(0, 60) || "Conversation";

    await db.insert(conversationsTable).values({
      userId,
      title: autoTitle,
      messages: JSON.stringify(messages),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save" });
  }
});

router.get("/nexus/conversations", async (req, res): Promise<void> => {
  console.log("nexus/conversations userId:", (req as any).session?.userId);
  try {
    const userId = (req as any).authUser.id as number;
    const hasMessageType = await hasNexusMessageTypeColumn();
    const rows = hasMessageType
      ? await db
          .select({
            id: nexusMessagesTable.conversationId,
            title: sql<string>`(SELECT content FROM nexus_messages sub WHERE sub.conversation_id = nexus_messages.conversation_id AND sub.user_id = ${userId} AND sub.role = 'user' AND sub.message_type IS DISTINCT FROM 'briefing' ORDER BY sub.created_at ASC LIMIT 1)`,
            createdAt: sql<Date>`MAX(${nexusMessagesTable.createdAt})`,
            messageCount: sql<number>`COUNT(*)`,
          })
          .from(nexusMessagesTable)
          .where(and(
            eq(nexusMessagesTable.userId, userId),
            isNotNull(nexusMessagesTable.conversationId),
            sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
          ))
          .groupBy(nexusMessagesTable.conversationId)
          .orderBy(desc(sql`MAX(${nexusMessagesTable.createdAt})`))
          .limit(30)
      : await db
          .select({
            id: nexusMessagesTable.conversationId,
            title: sql<string>`(SELECT content FROM nexus_messages sub WHERE sub.conversation_id = nexus_messages.conversation_id AND sub.user_id = ${userId} AND sub.role = 'user' ORDER BY sub.created_at ASC LIMIT 1)`,
            createdAt: sql<Date>`MAX(${nexusMessagesTable.createdAt})`,
            messageCount: sql<number>`COUNT(*)`,
          })
          .from(nexusMessagesTable)
          .where(and(eq(nexusMessagesTable.userId, userId), isNotNull(nexusMessagesTable.conversationId)))
          .groupBy(nexusMessagesTable.conversationId)
          .orderBy(desc(sql`MAX(${nexusMessagesTable.createdAt})`))
          .limit(30);
    const conversations = rows.map(r => ({
      id: r.id,
      title: r.title ? r.title.slice(0, 60) : "Conversation",
      createdAt: r.createdAt,
      messageCount: Number(r.messageCount),
    }));
    res.json({ conversations });
  } catch (err: any) {
    console.error("nexus/conversations error:", err?.message, err?.stack);
    res.status(500).json({ error: "Failed to load conversations", detail: err?.message });
    return;
  }
});

router.get("/nexus/conversation/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(conversationsTable).where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ conversation: row });
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
    imageData?: string;
    imageMimeType?: string;
    attachments?: Array<{ base64: string; mediaType: string; name?: string }>;
    conversationId?: string;
    sessionId?: number;
    userType?: HomeUserType;
  };

  const hasImage = !!(body.imageBase64 ?? body.imageData) && !!body.imageMimeType;
  if (!body.message?.trim() && !hasImage) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const authUser = (req as any).authUser;
  // history from the client body is accepted in the schema for API compatibility.
  // The Living Thread in nexus_messages remains authoritative for model context.
  const { userProfile = "", focusProjectId: requestedFocusProjectId = null, mode = "strategic", model = "claude", conversationId } = body;
  const requestHistory: NexusTitleMessage[] = (body.history ?? [])
    .filter((m): m is NexusTitleMessage =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0
    );
  const hasWorkingTitle = ["workingTitle", "conversationTitle", "title"].some((key) => {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  const shouldAutoGenerateConversationTitle = !hasWorkingTitle && requestHistory.length >= 2;
  const imageBase64 = body.imageBase64 ?? body.imageData ?? undefined;
  const imageMimeType = body.imageMimeType ?? undefined;
  // Normalise: merge legacy imageBase64/imageMimeType + new attachments array into one list
  const allAttachments: Array<{ base64: string; mediaType: string; name?: string }> = [
    ...(body.attachments ?? []),
    ...(imageBase64 && imageMimeType ? [{ base64: imageBase64, mediaType: imageMimeType }] : []),
  ];
  // Always store messages under a conversation ID so they appear in the
  // conversations list. If the frontend doesn't send one (new thread), we
  // generate a UUID here and return it in the `done` event so the client can
  // attach it to every subsequent message in the same conversation.
  const effectiveConversationId: string = conversationId ?? randomUUID();
  const userType = parseHomeUserType(body.userType);
  const sessionId = Number.isInteger(body.sessionId) && Number(body.sessionId) > 0 ? Number(body.sessionId) : null;
  // Use a sensible fallback when the user sends an image with no text
  const message = body.message?.trim() || (hasImage ? "[image]" : "");

  try {
  const sessionContext = sessionId
    ? await db
        .select({
          id: sessionsTable.id,
          projectId: sessionsTable.projectId,
          ideaMode: sessionsTable.ideaMode,
        })
        .from(sessionsTable)
        .innerJoin(projectsTable, eq(sessionsTable.projectId, projectsTable.id))
        .where(and(eq(sessionsTable.id, sessionId), eq(projectsTable.userId, userId)))
        .limit(1)
    : [];
  if (sessionId && sessionContext.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  let ideaMode = sessionContext[0]?.ideaMode === true;
  const focusProjectId = requestedFocusProjectId ?? sessionContext[0]?.projectId ?? null;
  const hasMessageType = await hasNexusMessageTypeColumn();

  // Load projects + Living Thread in parallel
  const [projects, dbMessages] = await Promise.all([
    db
      .select({ id: projectsTable.id, name: projectsTable.name, memory: projectsTable.memory, linkedRepo: projectsTable.linkedRepo, nodeState: projectsTable.nodeState })
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId)),
    loadNexusMessages(
      conversationMessages(conversationId === "__legacy__"
        ? and(eq(nexusMessagesTable.userId, userId), isNull(nexusMessagesTable.conversationId))
        : conversationId
          ? and(eq(nexusMessagesTable.userId, userId), eq(nexusMessagesTable.conversationId, conversationId))
          : eq(nexusMessagesTable.userId, userId), hasMessageType),
      hasMessageType,
    ),
  ]);

  const shouldEnableIdeaMode = !ideaMode && (
    hasExplicitIdeaModeSignal(message) || (dbMessages.length === 0 && hasIdeaModeSignal(message))
  );
  if (shouldEnableIdeaMode) {
    ideaMode = true;
    if (sessionId) {
      await db
        .update(sessionsTable)
        .set({ ideaMode: true })
        .where(eq(sessionsTable.id, sessionId));
    }
  }

  // Load committed decisions across all projects for cross-project tension detection
  const projectIds = projects.map((p) => p.id);
  const committedEntries = projectIds.length > 0
    ? await db
        .select({ id: entriesTable.id, projectId: entriesTable.projectId, title: entriesTable.title, summary: entriesTable.summary })
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

  // Portfolio health snapshot — Atlas speaks to this when asked about momentum/health
  const portfolioHealth = await (async () => {
    if (projectIds.length === 0) return null;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [sessionsResult, violationsResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionsTable)
        .where(and(inArray(sessionsTable.projectId, projectIds), gte(sessionsTable.createdAt, sevenDaysAgo))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(entriesTable)
        .where(and(inArray(entriesTable.projectId, projectIds), eq(entriesTable.isViolation, true))),
    ]);
    return {
      sessionsThisWeek: sessionsResult[0]?.count ?? 0,
      committedDecisions: committedEntries.length,
      violations: violationsResult[0]?.count ?? 0,
      totalProjects: projects.length,
    };
  })();

  // Scheduled health check awareness — summarise per-project monitor status for Atlas
  const monitorContext = await (async () => {
    if (projectIds.length === 0) return null;
    try {
      // Get the most recent check result per project (one query, then group in JS)
      const recentResults = await db
        .select({
          projectId: checkResultsTable.projectId,
          url: checkResultsTable.url,
          isHealthy: checkResultsTable.isHealthy,
          issues: checkResultsTable.issues,
          checkedAt: checkResultsTable.checkedAt,
        })
        .from(checkResultsTable)
        .where(inArray(checkResultsTable.projectId, projectIds))
        .orderBy(desc(checkResultsTable.checkedAt))
        .limit(projectIds.length * 5);

      // Keep only the most recent result per project
      const latestByProject = new Map<number, typeof recentResults[number]>();
      for (const r of recentResults) {
        if (!latestByProject.has(r.projectId)) latestByProject.set(r.projectId, r);
      }

      if (latestByProject.size === 0) return null;

      const lines: string[] = [];
      for (const [pid, result] of latestByProject) {
        const name = projectNameById.get(pid) ?? `Project ${pid}`;
        const daysSince = Math.round(
          (Date.now() - new Date(result.checkedAt).getTime()) / 86_400_000
        );
        const recency = daysSince === 0 ? "today" : `${daysSince}d ago`;
        if (result.isHealthy) {
          lines.push(`• ${name} — HEALTHY (${result.url}, checked ${recency})`);
        } else {
          const issueStr = result.issues.slice(0, 2).join("; ") || "unknown issue";
          lines.push(`• ${name} — ISSUE (${result.url}, checked ${recency}): ${issueStr}`);
        }
      }
      return lines.join("\n");
    } catch {
      return null;
    }
  })();

  // Always source conversation context from the persisted Living Thread (last 40 turns)
  const conversationHistory = dbMessages.slice(-40).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const userProjects = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(projectsTable.updatedAt))
    .limit(20);

  // Build system prompt
  let systemPrompt = ideaMode
      ? `${NEXUS_SYSTEM_PROMPT}\n\n${IDEA_MODE_POSTURE}\n\n--- SESSION CONTEXT ---\nreflection_mode: false\nidea_mode: true\n--- END SESSION CONTEXT ---`
      : `${NEXUS_SYSTEM_PROMPT}\n\n${CONVERSATIONAL_EXPANSION_PROTOCOL}\n\n--- SESSION CONTEXT ---\nreflection_mode: false\nidea_mode: false\n--- END SESSION CONTEXT ---`;
  systemPrompt += ATLAS_PLATFORM_KNOWLEDGE;
  let vault: Awaited<ReturnType<typeof loadVaultContext>> = { imageBlocks: [], systemNote: "", hasImages: false };
  let urlBlocks: Awaited<ReturnType<typeof screenshotUrlsToBlocks>> = [];

  if (!ideaMode) {
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (userType) {
    systemPrompt += `\n\n--- HOME ONBOARDING CONTEXT ---\n${userTypeOpeningGuidance(userType)} Use that as a bias for the next natural question, while still following the conversational expansion protocol.\n--- END HOME ONBOARDING CONTEXT ---`;
  }
  if (userProjects.length > 0) {
    systemPrompt += `\n\n--- YOUR PROJECTS ---\n${userProjects.map(p => `- ${p.name} (id: ${p.id})`).join("\n")}\nThese are the user's actual projects. Reference them by name when relevant. Never invent project names.\n--- END YOUR PROJECTS ---`;
  }
  // Always inject the full project roster so Atlas knows every room, even empty ones
  systemPrompt += `\n\n--- YOUR PROJECT PORTFOLIO (${projects.length} project${projects.length !== 1 ? "s" : ""}) ---\n${projectRoster}`;
  if (portfolioHealth) {
    const healthLines = [
      `Sessions this week: ${portfolioHealth.sessionsThisWeek}`,
      `Committed decisions (total): ${portfolioHealth.committedDecisions}`,
      `Decision violations: ${portfolioHealth.violations}`,
      `Total projects: ${portfolioHealth.totalProjects}`,
    ].join("\n");
    systemPrompt += `\n\n--- PORTFOLIO HEALTH ---\n${healthLines}\nUse this when the user asks about momentum, health, activity, or progress across the portfolio.\n--- END PORTFOLIO HEALTH ---`;
  }
  if (monitorContext) {
    systemPrompt += `\n\n--- LIVE APP HEALTH (scheduled monitor results) ---\n${monitorContext}\nUse this when the user asks about app health, uptime, or "how is my app doing". Report HEALTHY/ISSUE status directly from these results. If an issue is listed, surface it proactively.\n--- END LIVE APP HEALTH ---`;
  }
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

      // Fetch recent commits for the focused project so Atlas can interpret them
      let focusRecentCommits = "";
      if (focusProject.linkedRepo) {
        try {
          const repoFull = parseRepo(focusProject.linkedRepo ?? null);
          const ghToken = process.env.GITHUB_TOKEN ?? null;
          if (repoFull && ghToken) {
            const commitsResp = await fetch(
              `https://api.github.com/repos/${repoFull}/commits?per_page=7`,
              {
                headers: {
                  Authorization: `Bearer ${ghToken}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "User-Agent": "Atlas-Nexus/1.0",
                },
                signal: AbortSignal.timeout(5000),
              }
            );
            if (commitsResp.ok) {
              const commitData = await commitsResp.json() as Array<{
                sha?: string;
                commit?: { message?: string; author?: { name?: string; date?: string | null } | null };
              }>;
              const nowMs = Date.now();
              const commitLines = commitData
                .map((c) => {
                  const sha = (c.sha ?? "").slice(0, 7);
                  const message = (c.commit?.message ?? "").split("\n")[0]?.trim() ?? "";
                  const author = c.commit?.author?.name ?? "Unknown";
                  const dateStr = c.commit?.author?.date;
                  if (!sha || !message) return null;
                  const ageDays = dateStr ? Math.floor((nowMs - new Date(dateStr).getTime()) / 86_400_000) : null;
                  const ageLabel = ageDays == null ? "" : ageDays === 0 ? ", today" : ageDays === 1 ? ", 1 day ago" : `, ${ageDays} days ago`;
                  return `  ${sha} ${message} — ${author}${ageLabel}`;
                })
                .filter((l): l is string => l !== null);
              if (commitLines.length > 0) {
                focusRecentCommits = commitLines.join("\n");
              }
            }
          }
        } catch {
          // Non-fatal — continue without commit context
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
      const focusLedgerEntries: FocusLedgerEntry[] = await db
        .select({
          id: entriesTable.id,
          title: entriesTable.title,
          status: entriesTable.status,
          deviation: entriesTable.deviation,
          catchAgainstId: entriesTable.catchAgainstId,
          supersedesId: entriesTable.supersedesId,
        })
        .from(entriesTable)
        .where(eq(entriesTable.projectId, focusProjectId));
      const ledgerGroups = groupLedgerEntries(focusLedgerEntries);
      const flowNodes = extractFlowMapNodes(focusProject.nodeState);
      const answeredFlowNodes = flowNodes.filter((node) => node.answered);
      const unansweredFlowNodes = flowNodes.filter((node) => !node.answered);
      const architectureScore = computeArchitectureReadiness(flowNodes);
      const decisionsScore = computeDecisionReadiness(focusLedgerEntries);
      const blendedScore = computeBlendedReadiness(architectureScore, decisionsScore);
      const projectTensions = findSemanticTensionsForProject(focusProjectId, projects, committedEntries);
      const tensionLines = projectTensions.length > 0
        ? projectTensions.map((tension) => `${tension.projectA.name} ↔ ${tension.projectB.name}: "${tension.entryA.title}" conflicts with "${tension.entryB.title}"`).join("\n")
        : "None detected.";
      systemPrompt += `\n\n--- FOCUSED PROJECT: ${focusProject.name.toUpperCase()} ---\nThe user has zoomed in on "${focusProject.name}" for this conversation. Prioritize this project's context. Open your FIRST response by explicitly naming the project — begin with "${focusProject.name} —" or "On ${focusProject.name}:" so the user knows the focus is active. After that, answer normally without repeating the label on every message.`;
      if (focusEntries) systemPrompt += `\nCommitted decisions:\n${focusEntries}`;
      if (focusMemory) systemPrompt += `\nProject memory:\n${focusMemory}`;
      if (focusRecentCommits) {
        systemPrompt += `\nRecent commits (interpret narratively — group by area of impact, synthesize what's changing, don't enumerate SHAs):\n${focusRecentCommits}`;
      }
      systemPrompt += `\n\nFULL LEDGER STATE:
LEDGER STATE:
Committed (${ledgerGroups.committed.length}): ${formatTitles(ledgerGroups.committed)}
Parked (${ledgerGroups.parked.length}): ${formatTitles(ledgerGroups.parked)}
In Tension (${ledgerGroups.inTension.length}): ${formatTitles(ledgerGroups.inTension)}
Overridden (${ledgerGroups.overridden.length}): ${formatTitles(ledgerGroups.overridden)}

Atlas should reference parked items naturally if relevant.
Atlas should flag in-tension items if the conversation touches them.`;
      if (ledgerGroups.parked.length > 0) {
        systemPrompt += `\n\nPARKING LOT AWARENESS:
The user has ${ledgerGroups.parked.length} parked item${ledgerGroups.parked.length === 1 ? "" : "s"}: ${formatTitles(ledgerGroups.parked)}. Reference them naturally if the conversation is relevant. Do not list them all at once unprompted.`;
      }
      systemPrompt += `\n\nCROSS-PROJECT TENSIONS:
${tensionLines}
If Atlas detects the conversation is heading toward one of these tensions, surface it proactively with: "⚠️ Cross-project tension: [description]"

READINESS SCORE:
Current readiness: ${blendedScore}% (architecture: ${architectureScore}%, decisions: ${decisionsScore}%)
Atlas should reference this if asked about project health or progress.

FLOW MAP STATE:
FLOW MAP: ${flowNodes.length} nodes total — ${answeredFlowNodes.length} answered, ${unansweredFlowNodes.length} unanswered
Unanswered: ${unansweredFlowNodes.length > 0 ? unansweredFlowNodes.map((node) => node.label).join("; ") : "none"}
Atlas should offer to help fill unanswered nodes if the conversation provides relevant information.`;
      systemPrompt += `\n--- END FOCUSED PROJECT ---`;
    }
  }

  // Inject mode-specific instructions
  if (mode === "audit") {
    systemPrompt += `\n\n--- AUDIT MODE ACTIVE ---\nBe direct and critical. Your job right now is to stress-test, not validate. Look for what's fragile, inconsistent, or at risk across the portfolio. Ask hard questions. Flag gaps, weak assumptions, and contradictions without softening. If something looks shaky, say so plainly.\n--- END AUDIT MODE ---`;
  } else if (mode === "deep-dive") {
    systemPrompt += `\n\n--- DEEP DIVE MODE ACTIVE ---\nThe user wants depth, not breadth. Lock onto the specific topic they raise and explore it thoroughly — underlying assumptions, trade-offs, edge cases, second-order implications, what could go wrong, what could go right. Stay focused. Don't jump to other projects unless directly relevant.\n--- END DEEP DIVE MODE ---`;
  }

  systemPrompt += `\n\n--- BROWSER AGENT ---\nYou can visit URLs for competitor research or health checks. Emit a BROWSER_VISIT token at the END of your response when you want to visit a URL:\n\nBROWSER_VISIT:{"url":"https://example.com","mode":"scrape"}\nBROWSER_VISIT:{"url":"https://example.com","mode":"screenshot"}\nBROWSER_VISIT:{"url":"https://example.com","mode":"health"}\n\n- "scrape" — fetches page content and gives a strategic summary. Use for competitor research, product analysis, or reading any public page.\n- "screenshot" — takes a screenshot with AI visual description. Use when the user wants to SEE a page.\n- "health" — HTTP status + visual check. Use to verify a live app is rendering correctly.\n\nRULES:\n- Only emit BROWSER_VISIT when you actually have a URL to visit.\n- One BROWSER_VISIT per response, at the very end.\n- Never say "I'll check that" without emitting the token. Just emit it.\n- For competitor research ("how does X work?", "what does their pricing look like?", "compare us to X"), emit BROWSER_VISIT with mode "scrape". If you know the URL, use it directly.\n--- END BROWSER AGENT ---`;

  systemPrompt += `\n\n--- IMAGES ---\nYou CAN see images. When the user attaches a screenshot, photo, or mockup, you receive it and can analyze it, describe it, and reason about it. Do this naturally. If the user says "look at this" but no image is in the message, respond like a person: "I don't see an attachment — can you drop it in?" Never say "I can't see images" or "only text and code."\n\nGenerating images: An image generation service (Gemini) is connected. You do NOT generate images yourself — emit IMAGE_GEN at the END of your response and the backend handles it.\n\nWhen the user asks to sketch, draw, render, visualize, or "show me what X looks like" — write a detailed prompt and emit the token.\n\nIMAGE_GEN:{"prompt":"[detailed description]","mode":"render","size":"square"}\n\n- mode "render" → UI mockups, product visuals, logos, creative concepts, app screens\n- mode "schematic" → architecture diagrams, technical flows, wireframes\n- size "landscape" for wide, "portrait" for mobile, "square" for general\n- Proactive use: when the conversation is about how something should look or feel, emit IMAGE_GEN without being asked\n--- END IMAGES ---`;

  // Load Visual Vault images (project-scoped if focused, otherwise skip for global)
  vault = focusProjectId
    ? await loadVaultContext(userId, focusProjectId)
    : { imageBlocks: [], systemNote: "", hasImages: false };
  if (vault.hasImages) {
    systemPrompt += `\n\n--- VISUAL VAULT ---\n${vault.systemNote}\n--- END VISUAL VAULT ---`;
  }

  // ── Live URL capture — screenshot any URLs in the message ─────────────────
  const detectedUrls = extractPageUrls(message);
  urlBlocks = await screenshotUrlsToBlocks(detectedUrls);
  const urlNote = buildUrlNote(urlBlocks);
  if (urlNote) {
    systemPrompt += `\n\n--- LIVE URL CAPTURE ---\n${urlNote}\n--- END LIVE URL CAPTURE ---`;
  }
  }

  if (focusProjectId) {
    try {
      const recentErrors = await db.execute(sql`
        SELECT app_name, message, stack, url, severity, created_at
        FROM error_reports
        WHERE project_id = ${focusProjectId}
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
  }

  // Persist the user message to the Living Thread
  try {
    await db.insert(nexusMessagesTable).values({
      userId,
      role: "user",
      content: message,
      projectId: focusProjectId ?? null,
      sessionId,
      conversationId: effectiveConversationId,
      ...(hasMessageType ? { messageType: "message" } : {}),
    });
  } catch (dbErr: any) {
    const errMsg = dbErr?.message ?? "";
    const isMissingColumn = errMsg.includes("column") && errMsg.includes("does not exist");
    if (isMissingColumn) {
      logger.warn({ dbErr: errMsg }, "DB schema behind on nexus user insert — falling back to core insert");
      await db.insert(nexusMessagesTable).values({
        userId,
        role: "user",
        content: message,
        projectId: focusProjectId ?? null,
        sessionId,
        conversationId: effectiveConversationId,
      });
    } else {
      throw dbErr;
    }
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const runActions: RunAction[] = [];
  const writeStep = (action: RunAction) => {
    const step: RunAction = { ...action, status: action.status ?? "ok" };
    runActions.push(step);
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
    }
  };

  // Build contextual step labels from live data
  const focusedProject = focusProjectId ? projects.find(p => p.id === focusProjectId) : null;
  const focusLabel = focusedProject?.name ?? "all projects";
  const threadNote = dbMessages.length > 0
    ? `${dbMessages.length} message${dbMessages.length === 1 ? "" : "s"} in thread`
    : "Starting fresh";

  writeStep({ verb: "Reading", target: "conversation history", detail: threadNote });
  if (focusProjectId) {
    writeStep({ verb: "Reviewing", target: focusLabel, detail: "Loading project context and memory" });
  } else {
    writeStep({ verb: "Reviewing", target: "all projects", detail: `${projects.length} project${projects.length === 1 ? "" : "s"} in portfolio` });
  }
  if (vault.hasImages) writeStep({ verb: "Scanning", target: "visual vault", detail: "Images you've shared" });
  if (urlBlocks.length > 0) writeStep({ verb: "Captured", target: `${urlBlocks.length} URL${urlBlocks.length === 1 ? "" : "s"}`, detail: "Live screenshots taken" });

  let modelStartedAt = performance.now();
  let modelUsage: Partial<NexusRunMetadata> = {};
  let streamDone = false;
  const activeModel = model === "gemini" ? "gemini" : "claude";
  const modelUsed = activeModel === "gemini" ? "gemini-2.5-pro" : "claude-sonnet-4-6";

  const emitConversationTitle = async (assistantContent: string) => {
    if (hasWorkingTitle || res.writableEnded || res.destroyed) return;
    const explicitTitle = extractExplicitConversationTitle(assistantContent);
    const titleContext: NexusTitleMessage[] = [
      ...requestHistory,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: assistantContent },
    ].slice(-3);
    const title = explicitTitle ?? (
      shouldAutoGenerateConversationTitle
        ? await generateConversationTitle(titleContext)
        : null
    );
    if (title && !res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify({ type: "conversationTitle", title })}\n\n`);
    }
  };

  const finishStream = async (rawContent: string) => {
    streamDone = true;

    // Extract and strip IMAGE_GEN tokens
    const IMAGE_GEN_RE = /^IMAGE_GEN:\s*(\{[^\n]+\})\s*$/gm;
    type ImageGenToken = { prompt: string; mode: "render" | "schematic"; size?: "square" | "landscape" | "portrait" };
    const imageGenTokens: ImageGenToken[] = [];
    rawContent = rawContent.replace(IMAGE_GEN_RE, (_match, json: string) => {
      try {
        const parsed = JSON.parse(json) as ImageGenToken;
        if (parsed.prompt && (parsed.mode === "render" || parsed.mode === "schematic")) {
          imageGenTokens.push(parsed);
        }
      } catch { /* ignore malformed tokens */ }
      return "";
    }).trim();

    // Extract and strip BROWSER_VISIT tokens — Atlas requests browser visits at end of response
    const BROWSER_VISIT_RE = /^BROWSER_VISIT:\s*(\{[^\n]+\})\s*$/gm;
    type BrowserVisitToken = { url: string; mode: "screenshot" | "scrape" | "health" | "monitor" };
    let browserVisitToken: BrowserVisitToken | null = null;
    rawContent = rawContent.replace(BROWSER_VISIT_RE, (_match, json: string) => {
      if (!browserVisitToken) {
        try {
          const parsed = JSON.parse(json) as BrowserVisitToken;
          if (parsed.url && ["screenshot", "scrape", "health", "monitor"].includes(parsed.mode)) {
            browserVisitToken = parsed;
          }
        } catch { /* ignore malformed tokens */ }
      }
      return "";
    }).trim();

    // Execute image generation if Atlas emitted IMAGE_GEN token(s)
    interface NexusGeneratedImage { imageUrl: string; prompt: string; model: string; mode: "render" | "schematic"; }
    let nexusImageGenResult: { images: NexusGeneratedImage[] } | undefined;
    if (imageGenTokens.length > 0) {
      const nexusImages: NexusGeneratedImage[] = [];
      for (const token of imageGenTokens.slice(0, 2)) {
        const enginePrompt = token.mode === "render"
          ? `${token.prompt} Ultra-premium, cinematic quality. Sleek dark-mode aesthetic with obsidian depth, luxury glassmorphism elements, subtle amber/gold accent glows. Sophisticated editorial lighting, presentation-ready professional finish. 8K resolution quality.`
          : `${token.prompt} Clean flat 2D technical diagram. High-contrast dark background, crisp connector lines, strict geometric layout, precise spatial placement, sharp labels. Pure structural accuracy.`;
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
            nexusImages.push({
              imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
              prompt: textPart?.text ?? enginePrompt,
              model: "gemini-2.5-flash-image",
              mode: token.mode,
            });
          }
        } catch (err) {
          logger.warn({ err }, "Nexus image generation failed");
        }
      }
      if (nexusImages.length > 0) nexusImageGenResult = { images: nexusImages };
    }

    // Strip MEMORY_Tn tags from persisted output
    const { content: rawVisibleContent, memoryUpdated: parsedMemoryUpdated } = extractMemoryLines(rawContent);
    let visibleContent = rawVisibleContent;
    const memoryUpdated = parsedMemoryUpdated;
    writeStep({ verb: "Saved", target: "response", detail: "Thread updated" });

    // Execute BROWSER_VISIT if Atlas emitted one — emit visiting step so UI shows the globe indicator
    if (browserVisitToken) {
      const bvt = browserVisitToken as BrowserVisitToken;
      writeStep({ verb: "Visiting", target: bvt.url });
      try {
        const endpointMap: Record<BrowserVisitToken["mode"], string> = {
          screenshot: "screenshot",
          scrape: "scrape",
          health: "health",
          monitor: "monitor",
        };
        const bodyByMode: Record<BrowserVisitToken["mode"], Record<string, unknown>> = {
          screenshot: { url: bvt.url, analyze: true },
          scrape: { url: bvt.url, maxLength: 6000, analyze: true },
          health: { url: bvt.url },
          monitor: { url: bvt.url, checkResources: true },
        };
        const bvRes = await fetch(
          `${req.protocol}://${req.get("host")}/api/browser/${endpointMap[bvt.mode]}`,
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
            hasErrors?: boolean; summary?: string; title?: string; headings?: string[];
          };
          const lines: string[] = [];
          if (bvt.mode === "health") {
            const badge = bvData.isHealthy ? "✅ Healthy" : `⚠️ ${bvData.issues?.length ?? 0} issue(s) found`;
            lines.push(`**Site check — ${bvt.url}**\n${badge}`);
            if (bvData.issues?.length) lines.push(bvData.issues.map((i: string) => `- ${i}`).join("\n"));
            if (bvData.analysis) lines.push(bvData.analysis);
          } else if (bvt.mode === "monitor") {
            const badge = bvData.hasErrors ? "⚠️ Errors detected" : "✅ No errors found";
            lines.push(`**Monitor — ${bvt.url}**\n${badge}`);
            if (bvData.summary) lines.push(bvData.summary);
          } else if (bvt.mode === "scrape") {
            lines.push(`**${bvData.title ?? bvt.url}**  \`${bvt.url}\``);
            if (bvData.analysis) lines.push(bvData.analysis);
            if (bvData.headings && bvData.headings.length > 0) {
              lines.push(`**Key sections:** ${bvData.headings.slice(0, 6).join(" · ")}`);
            }
          } else if (bvData.analysis) {
            lines.push(`**Screenshot — ${bvt.url}**\n${bvData.analysis}`);
          }
          if (lines.length > 0) {
            const appendText = "\n\n" + lines.join("\n\n");
            visibleContent = visibleContent.trimEnd() + appendText;
            // Send the browser result as a token so the streaming message shows it
            if (!res.writableEnded && !res.destroyed) {
              res.write(`event: token\ndata: ${JSON.stringify(appendText)}\n\n`);
            }
          }
        }
      } catch (err) {
        logger.warn({ err: String(err), url: bvt.url, mode: bvt.mode }, "BROWSER_VISIT execution failed in nexus");
      }
    }
    const runMetadata = buildRunMetadata(visibleContent, {
      ...modelUsage,
      runActions: runActions.length > 0 ? runActions : null,
    });

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
    const projectMentions = ideaMode ? [] : projects.map(p => ({
      id: p.id,
      name: p.name,
      count: (lowerContent.match(new RegExp(p.name.toLowerCase(), "g")) ?? []).length
    })).filter(p => p.count >= 2).sort((a, b) => b.count - a.count);

    const focusSuggestion = !focusProjectId && projectMentions.length > 0
      ? { projectId: projectMentions[0].id, projectName: projectMentions[0].name }
      : null;

    const handoffSignal = ideaMode
      ? null
      : await detectHomeHandoff([
          ...conversationHistory.slice(-8),
          { role: "user", content: message },
          { role: "assistant", content: visibleContent },
        ]);
    const surface = ideaMode
      ? null
      : detectSurfaceSignal({
          content: visibleContent,
          userMessage: message,
          recentMessages: conversationHistory,
        });

    // Persist the assistant response to the Living Thread
    try {
      await db.insert(nexusMessagesTable).values({
        userId,
        role: "assistant",
        content: visibleContent,
        projectId: focusProjectId ?? null,
        sessionId,
        conversationId: effectiveConversationId,
        ...(hasMessageType ? { messageType: "message" } : {}),
      });
    } catch (dbErr: any) {
      const errMsg = dbErr?.message ?? "";
      const isMissingColumn = errMsg.includes("column") && errMsg.includes("does not exist");
      if (isMissingColumn) {
        logger.warn({ dbErr: errMsg }, "DB schema behind on nexus assistant insert — falling back to core insert");
        await db.insert(nexusMessagesTable).values({
          userId,
          role: "assistant",
          content: visibleContent,
          projectId: focusProjectId ?? null,
          sessionId,
          conversationId: effectiveConversationId,
        });
      } else {
        throw dbErr;
      }
    }
    await updateSessionRunMetadata(sessionId, runMetadata).catch((err) => {
      logger.warn({ err }, "updateSessionRunMetadata failed — continuing");
    });

    // If a project was just created, inject NAVIGATE_TO so the frontend auto-navigates
    if (pendingNavProjectId !== null) {
      const navToken = `\nNAVIGATE_TO:{"route":"/project/${pendingNavProjectId}"}`;
      if (!visibleContent.includes(`NAVIGATE_TO:{"route":"/project/${pendingNavProjectId}"}`)) {
        visibleContent += navToken;
        if (!res.writableEnded && !res.destroyed) {
          res.write(`event: token\ndata: ${JSON.stringify(navToken)}\n\n`);
        }
      }
    }

    await emitConversationTitle(visibleContent);

    res.write(`event: done\ndata: ${JSON.stringify({ content: visibleContent, modelUsed, surface, memoryUpdated, detectedMode, focusSuggestion, conversationId: effectiveConversationId, ...(handoffSignal ? { handoffSignal } : {}), ...(nexusImageGenResult ? { imageGen: nexusImageGenResult } : {}), ...runMetadata })}\n\n`);
    res.end();
  };

  const failStream = async (summary: string, status: RunStatus = "failed") => {
    if (streamDone || res.writableEnded || res.destroyed) return;
    streamDone = true;
    writeStep({ verb: status === "cancelled" ? "Cancelled" : "Failed", target: "Atlas response", status: status === "cancelled" ? "warn" : "fail" });

    if (status === "cancelled") {
      const metadata = failedRunMetadata(summary, status);
      res.write(`event: done\ndata: ${JSON.stringify({
        content: "",
        surface: null,
        memoryUpdated: false,
        detectedMode: "strategic",
        ...metadata,
      })}\n\n`);
      res.end();
      return;
    }

    // Real failure — emit error event so the frontend shows the reason
    // instead of rendering a blank bubble.
    res.write(`event: error\ndata: ${JSON.stringify(summary || "Atlas ran into an issue. Please try again.")}\n\n`);
    res.end();
  };
  req.on("aborted", () => {
    void failStream("Run cancelled by the user.", "cancelled");
  });

  // Call the selected model
  if (activeModel === "gemini") {
    let rawContent = "";
    const combinedText = [
      ...conversationHistory.map(m => `${m.role === "user" ? "User" : "Atlas"}: ${m.content}`),
      `User: ${message}`,
    ].join("\n\n");
    const geminiModeDetail = mode === "audit" ? "Auditing for gaps and risks"
      : mode === "deep_dive" ? "Deep-context analysis"
      : focusProjectId ? `Strategizing ${focusLabel}`
      : "Cross-portfolio strategy";
    writeStep({ verb: "Thinking", target: geminiModeDetail });
    modelStartedAt = performance.now();
    const geminiContents = allAttachments.length > 0
      ? [{ role: "user" as const, parts: [{ text: combinedText }, { inlineData: { mimeType: allAttachments[0].mediaType, data: allAttachments[0].base64 } }] }]
      : combinedText;
    try {
      const stream = await genai.models.generateContentStream({
        model: "gemini-2.5-pro",
        contents: geminiContents,
        config: { systemInstruction: systemPrompt },
      });
      let usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          rawContent += text;
          if (!res.writableEnded && !res.destroyed) {
            res.write(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
          }
        }
        if ((chunk as any).usageMetadata) usageMetadata = (chunk as any).usageMetadata;
      }
      const inputTokens = nullableNumber(usageMetadata?.promptTokenCount);
      const outputTokens = nullableNumber(usageMetadata?.candidatesTokenCount)
        ?? (usageMetadata?.totalTokenCount != null && inputTokens != null ? Math.max(usageMetadata.totalTokenCount - inputTokens, 0) : null);
      modelUsage = {
        executionTimeMs: Math.max(1, Math.round(performance.now() - modelStartedAt)),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd("gemini-2.5-pro", inputTokens, outputTokens),
      };
    } catch (geminiErr) {
      logger.warn({ err: geminiErr }, "Gemini stream failed in nexus — falling through to error");
      await failStream("Atlas ran into an issue with Gemini. Try switching to Claude.");
      return;
    }
    await finishStream(rawContent);
    return;
  }

  // Build user content — plain text or vision block when an image is attached
  // Vault images are prepended ahead of any user-attached image
  type VaultBlock = Anthropic.ImageBlockParam;
  type TextBlock = Anthropic.TextBlockParam;

  const contentParts: Array<VaultBlock | TextBlock> = [];

  // 1. Vault images (project visual context) — injected first so Atlas sees them before the user's message
  for (const vb of vault.imageBlocks) {
    // Skip vault images that exceed Claude's dimension limit
    const vaultImage = { base64: vb.source.data };
    if (vaultImage.base64 && vaultImage.base64.length > MAX_VAULT_B64_SIZE) {
      console.warn(`Vault image skipped — too large: ${vaultImage.base64.length} chars`);
      continue;
    }
    contentParts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: vb.source.media_type,
        data: vb.source.data,
      },
    } as VaultBlock);
  }

  // 2. Live URL screenshots (captured from URLs detected in this message)
  for (const ub of urlBlocks) {
    contentParts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: ub.source.media_type,
        data: ub.source.data,
      },
    } as VaultBlock);
  }

  // 3. User-attached images (attachments array — supports multiple)
  for (const att of allAttachments) {
    if (att.base64.length > MAX_VAULT_B64_SIZE) {
      logger.warn({ size: att.base64.length }, "User attachment too large — skipped");
      continue;
    }
    contentParts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: att.base64,
      },
    } as VaultBlock);
  }

  // 3. User text
  contentParts.push({ type: "text", text: message });

  const userContent: Anthropic.MessageParam["content"] =
    contentParts.length === 1 ? message : contentParts;

  const anthropicMessages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: "user", content: userContent },
  ];

  modelStartedAt = performance.now();
  const claudeModeDetail = mode === "audit" ? "Auditing for gaps and risks"
    : mode === "deep_dive" ? "Deep strategic analysis"
    : focusProjectId ? `Strategizing ${focusLabel}`
    : "Cross-portfolio strategy";
  writeStep({ verb: "Thinking", target: claudeModeDetail });

  let fullText = "";
  let pendingNavProjectId: number | null = null;

  const appendClaudeUsage = (finalMessage: Anthropic.Message, startedAt: number) => {
    const inputTokens = nullableNumber((finalMessage as any)?.usage?.input_tokens);
    const outputTokens = nullableNumber((finalMessage as any)?.usage?.output_tokens);
    modelUsage = mergeModelUsage(modelUsage, {
      executionTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
      inputTokens,
      outputTokens,
      costUsd: calculateModelCostUsd("claude-sonnet-4-6", inputTokens, outputTokens),
    });
  };

  const findCreateProjectToolUse = (finalMessage: Anthropic.Message): Anthropic.ToolUseBlock | null => {
    for (const block of finalMessage.content) {
      if (block.type === "tool_use" && block.name === "create_project") {
        return block as Anthropic.ToolUseBlock;
      }
    }
    return null;
  };

  const runCreateProjectTool = async (toolUse: Anthropic.ToolUseBlock) => {
    const parsedInput = parseCreateProjectToolInput(toolUse.input);
    if (!parsedInput) {
      return {
        ok: false as const,
        message: "create_project requires both a non-empty name and summary.",
      };
    }

    writeStep({ verb: "Creating", target: parsedInput.name, detail: "Project workspace" });
    try {
      const project = await createProjectForUser({
        userId,
        authUser,
        name: parsedInput.name,
        description: parsedInput.summary,
        entityType: "project",
        memory: buildInitialProjectMemory(parsedInput.summary),
      });
      const projectCreated = {
        id: project.id,
        name: project.name,
        summary: project.description ?? parsedInput.summary,
        conversationId: effectiveConversationId,
      };
      writeStep({ verb: "Created", target: project.name, detail: `Project ${project.id}` });
      pendingNavProjectId = project.id;

      // Attempt GitHub repo creation — graceful degradation if no token or API error
      let githubRepo: string | null = null;
      let githubHtmlUrl: string | null = null;
      try {
        const ghToken = await getGithubTokenForUser(userId);
        if (ghToken) {
          writeStep({ verb: "Creating", target: "GitHub repo", detail: parsedInput.name });
          const bootstrapResult = await bootstrapGitHubRepo({
            token: ghToken,
            projectId: project.id,
            projectName: parsedInput.name,
          });
          if (bootstrapResult.ok) {
            githubRepo = bootstrapResult.linkedRepo;
            githubHtmlUrl = bootstrapResult.htmlUrl;
            writeStep({ verb: "Created", target: "GitHub repo", detail: bootstrapResult.linkedRepo });
          } else {
            logger.warn({ err: bootstrapResult.error, projectId: project.id }, "GitHub repo bootstrap failed — continuing without repo");
            writeStep({ verb: "Skipped", target: "GitHub repo", detail: bootstrapResult.error, status: "warn" });
          }
        }
      } catch (ghErr) {
        logger.warn({ err: String(ghErr), projectId: project.id }, "GitHub bootstrap threw unexpectedly — continuing without repo");
      }

      const repoNote = githubRepo
        ? ` GitHub repo created at https://github.com/${githubRepo}.`
        : " No GitHub account connected, so no repo was created — the user can link one from the workspace.";

      return {
        ok: true as const,
        project: projectCreated,
        githubRepo,
        githubHtmlUrl,
        instruction: `Project "${project.name}" created with id ${project.id}.${repoNote} End your response with exactly: NAVIGATE_TO:{"route":"/project/${project.id}"}`,
      };
    } catch (error) {
      const message = error instanceof ProjectLimitReachedError
        ? `${error.message} Upgrade is required before creating another project.`
        : "Project creation failed unexpectedly.";
      writeStep({ verb: "Create", target: parsedInput.name, detail: message, status: "fail" });
      logger.warn({ err: String(error), projectName: parsedInput.name }, "create_project tool failed");
      return {
        ok: false as const,
        message,
      };
    }
  };

  const streamClaude = (
    messagesForClaude: Anthropic.MessageParam[],
    options: { tools: boolean; startedAt: number },
  ): void => {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: messagesForClaude,
      ...(options.tools ? { tools: [CREATE_PROJECT_TOOL] } : {}),
    });

    stream.on("text", (text) => {
      fullText += text;
      res.write(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
    });

    stream.on("error", (err) => {
      const cancelled = /\b(abort|cancel|cancelled|canceled)\b/i.test(err.message);
      writeStep({ verb: "Stream", target: "Claude", status: cancelled ? "warn" : "fail" });
      void failStream(err.message || "Atlas ran into an issue.", cancelled ? "cancelled" : "failed");
    });

    stream.on("finalMessage", async (finalMessage) => {
      try {
        appendClaudeUsage(finalMessage, options.startedAt);
        const toolUse = options.tools ? findCreateProjectToolUse(finalMessage) : null;
        if (toolUse) {
          const toolResult = await runCreateProjectTool(toolUse);
          const continuationMessages: Anthropic.MessageParam[] = [
            ...messagesForClaude,
            { role: "assistant", content: finalMessage.content as Anthropic.MessageParam["content"] },
            {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(toolResult),
                ...(!toolResult.ok ? { is_error: true } : {}),
              } as Anthropic.ToolResultBlockParam],
            },
          ];
          streamClaude(continuationMessages, { tools: false, startedAt: performance.now() });
          return;
        }
        await finishStream(fullText);
      } catch (err) {
        req.log.error({ err }, "nexus/chat stream finalization error");
        await failStream("Atlas ran into an issue. Please try again.", "failed");
      }
    });
  };

  streamClaude(anthropicMessages, { tools: true, startedAt: modelStartedAt });

  return;

  } catch (err) {
    req.log.error({ err }, "nexus/chat error");
    if (res.headersSent && !res.writableEnded) {
      // Stream already started — send error event so the frontend shows it
      const msg = err instanceof Error ? err.message : "Atlas ran into an issue. Please try again.";
      res.write(`event: error\ndata: ${JSON.stringify(msg)}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: "Atlas ran into an issue. Please try again." });
    }
  }
});

router.post("/nexus/handoff", async (req, res): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const { messages, projectId, sessionId, ideaMode, conversationId, conversation_id: conversationIdSnake } = req.body as {
      messages: { role: string; content: string }[];
      projectId?: number;
      sessionId?: number;
      ideaMode?: boolean;
      conversationId?: string | null;
      conversation_id?: string | null;
    };
    const rawConversationId = conversationId ?? conversationIdSnake;
    const handoffConversationId = typeof rawConversationId === "string" && rawConversationId.trim().length > 0
      ? rawConversationId.trim()
      : null;

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
    let ideaModeActive = ideaMode === true || messages.some((m) => (
      m.role === "user" && (hasIdeaModeSignal(m.content) || hasExplicitIdeaModeSignal(m.content))
    ));
    if (!ideaModeActive && Number.isInteger(sessionId) && Number(sessionId) > 0) {
      const [session] = await db
        .select({ ideaMode: sessionsTable.ideaMode })
        .from(sessionsTable)
        .innerJoin(projectsTable, eq(sessionsTable.projectId, projectsTable.id))
        .where(and(eq(sessionsTable.id, Number(sessionId)), eq(projectsTable.userId, userId)))
        .limit(1);
      ideaModeActive = session?.ideaMode === true;
    }
    if (!targetProjectId) {
      const [newProject] = await db
        .insert(projectsTable)
        .values({
          name: brief.projectName,
          description: brief.description,
          entityType: ideaModeActive ? "idea" : "project",
          userId,
        })
        .returning();
      targetProjectId = newProject.id;
    }

    const [targetProject] = await db
      .select({ memory: projectsTable.memory })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, targetProjectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!targetProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const handoffTimestamp = new Date().toISOString();
    const existingMemory = parseMemoryStore(targetProject.memory ?? null);
    const nextEntries: MemoryEntry[] = [
      ...existingMemory.entries,
      {
        tier: 1,
        text: `Project brief from home conversation: ${brief.blueprint}`,
        createdAt: handoffTimestamp,
        retrievalCount: 0,
        lastRetrievedAt: null,
      },
      ...(brief.firstStep ? [{
        tier: 4 as const,
        text: `First step: ${brief.firstStep}`,
        createdAt: handoffTimestamp,
        retrievalCount: 0,
        lastRetrievedAt: null,
      }] : []),
    ];

    if (
      handoffConversationId
      && !memoryHasConversationContext(targetProject.memory ?? null, existingMemory, handoffConversationId)
    ) {
      const hasMessageType = await hasNexusMessageTypeColumn();
      const recentConversationMessages = await loadRecentNexusMessagesForConversation(
        userId,
        handoffConversationId,
        hasMessageType,
      );
      if (recentConversationMessages.length > 0) {
        nextEntries.push({
          tier: 3,
          text: buildConversationContextBlock(
            handoffConversationId,
            handoffTimestamp,
            recentConversationMessages,
          ),
          createdAt: handoffTimestamp,
          retrievalCount: 0,
          lastRetrievedAt: null,
        });
      }
    }

    const memoryEntry: MemoryStore = {
      v: 2,
      entries: nextEntries,
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
      res.json({ briefing: null, isBriefing: true });
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
    res.json({ briefing: text, isBriefing: true });
  } catch (err) {
    req.log?.error({ err }, "Briefing error");
    res.json({ briefing: null, isBriefing: true });
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

// POST /api/nexus/name — generate a short project name from a message
router.post("/nexus/name", async (req, res): Promise<void> => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.json({ name: "" }); return; }
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [{
        role: "user",
        content: `Based on this message, generate a project name.\nRules:\n- 3-5 words maximum\n- Title case\n- Descriptive of what's being built\n- No punctuation\n- No generic words like "Project" or "App" unless essential\n\nMessage: "${message.slice(0, 400)}"\n\nRespond with only the project name, nothing else.`,
      }],
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
    const name = raw.replace(/["""''`]/g, "").replace(/[.!?]$/, "").trim();
    res.json({ name: name || "" });
  } catch {
    res.json({ name: "" });
  }
});

export default router;
