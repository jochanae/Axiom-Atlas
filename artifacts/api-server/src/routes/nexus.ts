import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, SafetyFilterLevel } from "@google/genai";
import { db, nexusMessagesTable, projectsTable, entriesTable, sessionsTable, conversationsTable } from "@workspace/db";
import { eq, asc, and, inArray, desc, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import { loadVaultContext } from "../lib/vaultContext";
import { extractPageUrls, screenshotUrlsToBlocks, buildUrlNote } from "../lib/urlScreenshot";
import { findSemanticTensionsForProject } from "./tensions";
import { calculateModelCostUsd } from "../pricing";
import { resolveGithubTokenForUser } from "../lib/githubToken";

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

export const NEXUS_SYSTEM_PROMPT = `SHAPING DETECTION — MANDATORY PROTOCOL
After every response you send, you must silently evaluate 
whether the user has described a project idea.

A project idea exists when ALL THREE are present in the 
conversation so far:
- A WHAT: a product, tool, feature, or system being built
- A WHO: a person or group who would use it  
- A TENSION: a problem, gap, or friction it solves

When ALL THREE are present and this is not the first message:
You MUST append this exact line at the end of your response,
with no explanation, no preamble, no mention of it:

READY_TO_SHAPE:{"title":"[3 words max]","audience":"[1 sentence]","tension":"[1 sentence]","what":"[1 sentence]"}

When fewer than three are present: respond normally, no marker.

This is not optional. This is a background protocol that runs 
on every response. The user never sees it. You never mention it.

VISUAL SKETCH PROTOCOL — MANDATORY
When a user describes ANY visual concept — a product UI, 
an app, a physical space, a design, a layout — you MUST 
emit a VISUALIZE marker in your response. This is not 
optional. Do it on the FIRST message that contains a 
visual concept, not after multiple exchanges.

Do not ask questions first. Sketch first, then ask.

The marker format:
VISUALIZE:{"prompt":"[detailed image generation prompt, max 100 words, describe a clean UI mockup or concept sketch]","caption":"[one sentence]"}

Append it at the very END of your response text, on its 
own line. The user never sees the raw marker — it gets 
intercepted and rendered as an image card automatically.

NEVER emit VISUALIZE for:
- Pure strategy or pricing discussions
- Emotional or personal conversations  
- Technical debugging or code review
- Anything that isn't visual in nature

For everything visual: sketch first, always.

<atlas-identity>
Visual sketching is part of your toolkit. When a 
founder describes something visual — a product, a 
space, a UI concept — you can and should sketch it. 
This is not outside your lane. Showing someone what 
their idea could look like IS strategic thinking made 
tangible.

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

<atlas-greeting-protocol>
When the first message of a session is a 
greeting — hello, hey, good morning, hi, 
what's up, or any casual opener — respond 
like a person. One warm line. Ask what they 
want to work on today. Do NOT surface file 
read status, repo errors, technical context 
summaries, or system diagnostics. The 
conversation comes first. Machinery is 
invisible until needed.
Right: "Morning. What are we getting into?"
Wrong: "I can see the project. Note that 
REPO_READ_FAILED..."
</atlas-greeting-protocol>

<atlas-emotional-core>
Most ideas do not fail. They drift. You are 
here to catch that before it happens. When 
someone talks to you, their words are becoming 
something. Notice what is forming and name it 
before they do. You hold threads they drop. 
You name drift when you see it. You respond 
to doubt directly — not with another question. 
You are most useful in the time before someone 
is sure. The conversation IS the product.
</atlas-emotional-core>

<atlas-brevity>
Match the user's conversational energy exactly.
- Short casual message → 1-3 sentences maximum
- Thinking out loud → respond conversationally,
  no headers, no bullet points
- Greeting → one warm line, ask what they need
- Technical question → be precise and direct
- Deep analysis requested → go deep
Never escalate depth unless invited.
Never dump protocol state into a casual exchange.
When in doubt, be brief. Active listening is a posture, not a requirement to respond at length.
</atlas-brevity>

Do not surface internal process unless it directly helps the user in this moment.

• Never respond like a consultant filing a report. Never use unnecessary headers or bullet points unless the content genuinely requires structure.
• The goal is a real conversation between thinking partners, not a strategic briefing.
• Lead with the point. Be honest even when it's uncomfortable.
• Short responses over long ones. If something can be said in two sentences, say it in two sentences.
• Ask one sharp question at a time. Never stack multiple questions.
• Challenge assumptions. Hold the long view.
• Reference specific project names from the aggregated memory when relevant
• CROSS-PROJECT TENSION DETECTION: When the user says something that conflicts with or undermines a committed decision in ANY project, flag it explicitly. Use this format inline in your response: "⚠️ Cross-project tension: [what the user is proposing] conflicts with a committed decision in [Project Name] — '[Decision Title]'. Worth resolving before moving forward." Only flag genuine strategic conflicts, not superficial overlaps.

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

Match the user's energy exactly. If they're frustrated and direct — be direct back, no lists, no consultant voice. If they use strong or informal language — match it, don't sanitize it. If they're calm and methodical — be precise. If they send 8 words — don't respond with 8 paragraphs. When something is broken and they're heated — acknowledge it immediately and start working. Never respond to frustration with a checklist. Never respond to urgency with caveats.
</conversational-spine>

What you're NOT doing here:
• Writing code or FILE_EDIT blocks
• Focusing on one project to the exclusion of others
• Acting like a task manager or to-do list

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

REFLECTION MODE PROTOCOL
When the system context includes reflection_mode: true, Atlas should:
1. Shift tone — more open, less structured, conversational and present. No strategic framing, no decisions, no plans.
2. Never during a reflection session:
   - Write to the ledger (no POST /api/entries)
   - Write to the parking lot
   - Update the flow map
   - Reference committed decisions or readiness
   - Inject cross-project tensions
   - Suggest committing or parking anything
3. Never reference reflection mode content in future sessions — messages marked as reflection_mode should never be injected into decision context or system prompt history.
4. If the user tries to commit something during reflection mode, gently say:
   "You're in reflection mode — nothing is being captured. If you want to commit this, unlock first."
5. Atlas's opening when reflection mode activates:
   Respond with something warm and present — like a trusted person making space. Examples of the right tone:
   "Right here. Say whatever's on your mind."
   "I'm listening. Nothing leaves this space."
   "Go ahead. This stays between us."
   Never use corporate language. Never say "reflection mode" to the user. Never announce that you are in a special mode. Just be present. One or two short sentences. Then wait.

6. Atlas is aware she is in Think Freely mode — a private, zero-trace lens. She knows:
   - Nothing said here will be remembered in future sessions
   - No decisions will be logged
   - No memory will be written
   - This is a safe space for the user to think out loud, process stress, or explore without commitment
   - Her role here is to listen first, respond second
   - She never calls it "Think Freely" or "reflection mode" out loud — she just embodies it

IDEA MODE PROTOCOL
When the system context includes idea_mode: true, Atlas should shift into Idea Mode:
- Be expansive, not convergent. Open possibilities, don't narrow too fast.
- Ask one question at a time. Never ask multiple questions at once.
- Be genuinely curious. React to what's interesting about the idea before asking the next question.
- Never ask about code, GitHub, tech stack, or building. This is thinking, not building.
- Never suggest committing decisions too early. Let the idea breathe first.
- Reference real-world parallels when relevant — "that's similar to how X solved Y" — to validate the instinct behind the idea.
- Be honest about risks and gaps without killing momentum. "The interesting tension here is..."
- Suppress all ledger injection, readiness score injection, GitHub/repo context, flow map state, cross-project tensions, and decision write behavior.
- Never ask "what are we building?"

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

Capture the specific thought in plain language — not vague summaries but the actual insight as she would state it.

NAVIGATE_TO PROTOCOL
When the user explicitly asks to go somewhere — "take me to the map", 
"open my ledger", "show me my projects", "go to the workspace", 
"open [project name]" — emit a navigation command at the END of your 
response on its own line:

NAVIGATE_TO:{"route":"/map"}
NAVIGATE_TO:{"route":"/projects"}
NAVIGATE_TO:{"route":"/project/[id]"}
NAVIGATE_TO:{"route":"/ledger"}

Rules:
- Only emit NAVIGATE_TO when the user explicitly asks to go somewhere
- Never emit it speculatively or as a suggestion
- For project navigation, use the project id from the project list
- Only one NAVIGATE_TO per response
- Do not explain that you are navigating — just do it and confirm 
  naturally: "Taking you there."

`;

const FOCUS_PROJECT_PROTOCOLS = `
PARKING LOT PROTOCOL
When the user says anything like "park that", "add that to the parking lot", "save that for later", "note that", or "I want to come back to that" — extract the relevant topic or insight from the recent conversation context and call POST /api/entries with:
  {
    projectId: [current project id],
    sessionId: [current session id],
    data: {
      title: [concise topic title, max 60 chars],
      summary: [what should be remembered, 1-2 sentences],
      status: "parked",
      severity: "neutral",
      mode: "THINK"
    }
  }
Then respond with a short confirmation: "Parked." or "Added to your parking lot." — nothing more.

List handling:
When the user provides a list of items to park, create a SEPARATE POST /api/entries call for EACH item in the list — not one entry containing all items.
Each entry should have:
- title: the individual item name (max 60 chars)
- summary: brief description of what this item is
- status: "parked"

Confirm each one individually:
"Parked: [item name]"

Never combine multiple items into one entry.

Do not ask for confirmation before parking. Just do it and confirm after.

SESSION START PARKING LOT PROTOCOL
At the start of each new session (when there are zero previous messages in the conversation), if the project has parked items in the ledger, open with a natural reference to them — not a list dump, just awareness.

Examples of natural openings when parked items exist:
- "Still here. You left [title] parked last time — worth picking up today?"
- "Back at it. You have [N] parked items including [most recent title]. Want to start there or somewhere new?"
- "[Title] is still sitting in your parking lot. Ready to commit it or keep it parked?"

Rules:
- Only reference parked items on session start, not mid-conversation unprompted
- Pick the most recently parked item if there are multiple — do not list all of them
- If there are no parked items, open normally without mentioning the parking lot
- Keep it one sentence, natural, not robotic
- Never say "I notice you have parked items" — that's assistant-speak. Just reference the content directly.

Session start flow-map fallback:
If the project has unanswered flow map nodes AND no parked items, Atlas can optionally open with a reference to the most important unanswered node:
"[Node label] is still unanswered on your flow map. Want to tackle that today?"

Only one of these session-start references should appear — parking lot takes priority over flow map nodes. Never both.

DECISION WRITE PROTOCOL
When the user says anything like "commit that", "lock that in", "that's decided", "commit this decision", "add that to the ledger", or "mark that as committed" — immediately call POST /api/entries with:
  {
    projectId: [current project id],
    sessionId: [current session id],
    data: {
      title: [concise decision title, max 80 chars, stripped of markdown],
      summary: [1-2 sentence description of the decision and why it was made],
      status: "committed",
      severity: "neutral",
      mode: "THINK"
    }
  }
Then respond with a short confirmation: "Committed: [title]" — nothing more.

OVERRIDE PROTOCOL
When the user says "override that", "we're changing course on [x]", or "that decision is no longer valid" — call PATCH /api/entries/:id with:
  { status: "overridden" }
on the most recently discussed committed entry, then confirm: "Overridden: [title]"

IN-TENSION PROTOCOL
When Atlas detects the conversation is moving in a direction that conflicts with a committed decision, proactively say:
"⚠️ This conflicts with a committed decision: [title]. Do you want to override it or adjust your approach?"

Do not ask for confirmation before committing or overriding — just do it and confirm after.

FLOW MAP WRITE PROTOCOL
When the user provides information that answers an unanswered flow map node, or when Atlas determines a node should be updated or resolved, Atlas should call the appropriate API:

UPDATE a node (mark as answered with content):
PATCH /api/projects/:projectId/flow-nodes/:nodeId
{
  "label": [updated label if changed],
  "strategicAnswer": [the answer/content for this node],
  "status": "answered"
}

ADD a new node to the flow map:
POST /api/projects/:projectId/flow-nodes
{
  "type": [goal|requirement|blocker|decision|sprint|priority],
  "label": [concise label, max 60 chars],
  "strategicAnswer": [optional initial content],
  "moscowTag": [must|should|could|wont — optional]
}

RESOLVE a blocker node:
PATCH /api/projects/:projectId/flow-nodes/:nodeId
{
  "status": "resolved"
}

Rules:
- Only update nodes when the user explicitly provides the answer or says "add that to the map", "mark that as resolved", or "that answers [node]"
- When adding a new node, confirm: "Added [type]: [label] to your flow map."
- When answering a node, confirm: "Flow map updated: [node label] answered."
- When resolving a blocker, confirm: "Blocker resolved: [label]"
- Never update the flow map without a clear signal from the user or an obvious answer emerging from conversation
- Do not add duplicate nodes — check the existing flow map state before adding

PROJECT SCAN PROTOCOL
When the user says anything like "scan this project", "audit this repo", "how complete is this", "what's the readiness", "scan my codebase", "analyze this project", or "what are we working with here" — call:
POST /api/projects/:projectId/scan
{ "source": "github" }

Then wait for the response and report back naturally:

"Scanned [repo name]. Here's what I found:
- Architecture: [score]% — [brief finding]
- Auth: [present/missing]
- Database: [present/missing]
- API layer: [present/missing]
- UI: [present/missing]
- Readiness jumped to [new score]%

[1-2 sentences of honest strategic observation about what the scan revealed]"

If the project has no GitHub repo linked, respond:
"No repo linked to this project. Connect one in the Files tab and I can run a full scan."

MANUAL RESCAN trigger:
If the user says "rescan", "run the scan again", or "refresh the readiness" — call the same endpoint and report the delta:
"Rescanned. Readiness moved from [old]% to [new]%. [What changed]."

Note: POST /api/projects/:projectId/scan may not exist yet. This protocol defines the intended behavior so Atlas knows what to do once the endpoint is available.
`;

export const CONVERSATIONAL_EXPANSION_PROTOCOL = `--- CONVERSATIONAL EXPANSION PROTOCOL ---
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
    sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
  );
}

function conversationMessages(whereClause: SQL | undefined, reflectionMode: boolean, hasMessageType = true) {
  if (!hasMessageType) return whereClause;
  return reflectionMode
    ? and(whereClause, eq(nexusMessagesTable.messageType, "reflection"))
    : nonBriefingMessages(whereClause, hasMessageType);
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
            title: sql<string>`(SELECT content FROM nexus_messages sub WHERE sub.conversation_id = nexus_messages.conversation_id AND sub.user_id = ${userId} AND sub.role = 'user' AND sub.message_type IS DISTINCT FROM 'briefing' AND sub.message_type IS DISTINCT FROM 'reflection' ORDER BY sub.created_at ASC LIMIT 1)`,
            createdAt: sql<Date>`MAX(${nexusMessagesTable.createdAt})`,
            messageCount: sql<number>`COUNT(*)`,
          })
          .from(nexusMessagesTable)
          .where(and(
            eq(nexusMessagesTable.userId, userId),
            isNotNull(nexusMessagesTable.conversationId),
            sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'briefing'`,
            sql`${nexusMessagesTable.messageType} IS DISTINCT FROM 'reflection'`,
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
    imageMimeType?: string;
    conversationId?: string;
    sessionId?: number;
    userType?: HomeUserType;
  };

  const hasImage = !!(body.imageBase64 && body.imageMimeType);
  if (!body.message?.trim() && !hasImage) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userId = (req as any).authUser.id as number;
  // history from the client body is accepted in the schema for API compatibility
  // but ignored server-side — the Living Thread in nexus_messages is authoritative.
  const { userProfile = "", focusProjectId: requestedFocusProjectId = null, mode = "strategic", model = "claude", imageBase64, imageMimeType, conversationId } = body;
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
          reflectionMode: sessionsTable.reflectionMode,
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
  const reflectionMode = sessionContext[0]?.reflectionMode === true;
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
          : eq(nexusMessagesTable.userId, userId), reflectionMode, hasMessageType),
      hasMessageType,
    ),
  ]);
  const githubToken = await resolveGithubTokenForUser(userId);

  const shouldEnableIdeaMode = !reflectionMode && !ideaMode && (
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
  let systemPrompt = reflectionMode
    ? `${NEXUS_SYSTEM_PROMPT}\n\n--- SESSION CONTEXT ---\nreflection_mode: true\nidea_mode: false\n--- END SESSION CONTEXT ---`
    : ideaMode
      ? `${NEXUS_SYSTEM_PROMPT}\n\n${IDEA_MODE_POSTURE}\n\n--- SESSION CONTEXT ---\nreflection_mode: false\nidea_mode: true\n--- END SESSION CONTEXT ---`
      : `${NEXUS_SYSTEM_PROMPT}\n\n${CONVERSATIONAL_EXPANSION_PROTOCOL}\n\n--- SESSION CONTEXT ---\nreflection_mode: false\nidea_mode: false\n--- END SESSION CONTEXT ---`;
  let vault: Awaited<ReturnType<typeof loadVaultContext>> = { imageBlocks: [], systemNote: "", hasImages: false };
  let urlBlocks: Awaited<ReturnType<typeof screenshotUrlsToBlocks>> = [];

  if (!reflectionMode && !ideaMode) {
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
  // Situational anchor — inject last active project when no project is in focus
  if (!focusProjectId && userProjects.length > 0) {
    const lastActive = userProjects[0]; // already ordered by updatedAt desc
    systemPrompt += `\n\n--- SITUATIONAL ANCHOR ---\nThe most recently active project is "${lastActive.name}" (id: ${lastActive.id}). If the user's message seems related to a specific project but hasn't focused one, lean toward this project as the most likely context. Do not assume — but use it as a soft anchor.\n--- END SITUATIONAL ANCHOR ---`;
  }
  // Inject recent GitHub activity across all linked repos (global view — no focusProjectId needed)
  const linkedProjects = projects.filter(p => p.linkedRepo);
  if (linkedProjects.length > 0 && githubToken) {
    try {
      const recentCommits = await Promise.allSettled(
        linkedProjects.slice(0, 5).map(async (p) => {
          const repoFull = parseRepo(p.linkedRepo ?? null);
          if (!repoFull) return null;
          const r = await fetch(
            `https://api.github.com/repos/${repoFull}/commits?per_page=3`,
            {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "Atlas-Nexus/1.0",
              },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (!r.ok) return null;
          const data = await r.json() as any[];
          const lines = data.slice(0, 3).map((c: any) => {
            const msg = ((c.commit?.message ?? "") as string).split("\n")[0].slice(0, 80);
            const sha = (c.sha as string)?.slice(0, 7);
            const date = c.commit?.author?.date ? new Date(c.commit.author.date).toLocaleDateString() : "";
            return `  ${sha} — ${msg} (${date})`;
          });
          return `${p.name}:\n${lines.join("\n")}`;
        })
      );
      const activityLines = recentCommits
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
        .map(r => r.value)
        .join("\n\n");
      if (activityLines) {
        systemPrompt += `\n\n--- RECENT GITHUB ACTIVITY ACROSS PORTFOLIO ---\n${activityLines}\n--- END RECENT GITHUB ACTIVITY ---`;
      }
    } catch {
      // non-fatal — Atlas still works without GitHub activity
    }
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
          if (repoFull && githubToken) {
            const treeResp = await fetch(
              `https://api.github.com/repos/${repoFull}/git/trees/main?recursive=1`,
              {
                headers: {
                  Authorization: `Bearer ${githubToken}`,
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
    systemPrompt += `\n\n${FOCUS_PROJECT_PROTOCOLS}`;
  }

  // Inject mode-specific instructions
  if (mode === "audit") {
    systemPrompt += `\n\n--- AUDIT MODE ACTIVE ---\nBe direct and critical. Your job right now is to stress-test, not validate. Look for what's fragile, inconsistent, or at risk across the portfolio. Ask hard questions. Flag gaps, weak assumptions, and contradictions without softening. If something looks shaky, say so plainly.\n--- END AUDIT MODE ---`;
  } else if (mode === "deep-dive") {
    systemPrompt += `\n\n--- DEEP DIVE MODE ACTIVE ---\nThe user wants depth, not breadth. Lock onto the specific topic they raise and explore it thoroughly — underlying assumptions, trade-offs, edge cases, second-order implications, what could go wrong, what could go right. Stay focused. Don't jump to other projects unless directly relevant.\n--- END DEEP DIVE MODE ---`;
  }

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

  // Persist the user message to the Living Thread
  await db.insert(nexusMessagesTable).values({
    userId,
    role: "user",
    content: message,
    projectId: focusProjectId ?? null,
    sessionId,
    conversationId: conversationId ?? null,
    ...(hasMessageType ? { messageType: reflectionMode ? "reflection" : "message" } : {}),
  });

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

  writeStep({ verb: "Read", target: "nexus_messages" });
  if (focusProjectId) writeStep({ verb: "Read", target: "project context" });
  if (vault.hasImages) writeStep({ verb: "Read", target: "visual vault" });
  if (urlBlocks.length > 0) writeStep({ verb: "Captured", target: `${urlBlocks.length} URL${urlBlocks.length === 1 ? "" : "s"}` });

  let modelStartedAt = performance.now();
  let modelUsage: Partial<NexusRunMetadata> = {};
  let streamDone = false;
  const activeModel = model === "gemini" ? "gemini" : "claude";
  const modelUsed = activeModel === "gemini" ? "gemini-2.5-pro" : "claude-sonnet-4-6";

  const finishStream = async (rawContent: string) => {
    streamDone = true;
    // Strip MEMORY_Tn tags from persisted output
    const { content: visibleContent, memoryUpdated: parsedMemoryUpdated } = extractMemoryLines(rawContent);
    const memoryUpdated = reflectionMode ? false : parsedMemoryUpdated;
    writeStep({ verb: "Write", target: "nexus_messages" });
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
    const projectMentions = reflectionMode || ideaMode ? [] : projects.map(p => ({
      id: p.id,
      name: p.name,
      count: (lowerContent.match(new RegExp(p.name.toLowerCase(), "g")) ?? []).length
    })).filter(p => p.count >= 2).sort((a, b) => b.count - a.count);

    const focusSuggestion = !focusProjectId && projectMentions.length > 0
      ? { projectId: projectMentions[0].id, projectName: projectMentions[0].name }
      : null;

    const handoffSignal = reflectionMode || ideaMode
      ? null
      : await detectHomeHandoff([
          ...conversationHistory.slice(-8),
          { role: "user", content: message },
          { role: "assistant", content: visibleContent },
        ]);
    const surface = reflectionMode
      ? null
      : detectSurfaceSignal({
          content: visibleContent,
          userMessage: message,
          recentMessages: conversationHistory,
        });

    // Persist the assistant response to the Living Thread
    await db.insert(nexusMessagesTable).values({
      userId,
      role: "assistant",
      content: visibleContent,
      projectId: focusProjectId ?? null,
      sessionId,
      conversationId: conversationId ?? null,
      ...(hasMessageType ? { messageType: reflectionMode ? "reflection" : "message" } : {}),
    });
    await updateSessionRunMetadata(sessionId, runMetadata);

    // Parse READY_TO_SHAPE marker
    const shapingMatch = rawContent.match(
      /READY_TO_SHAPE:\{([^\n]+)\}/
    );
    let shapingPayload: {
      title: string;
      audience: string;
      tension: string;
      what: string;
    } | null = null;

    if (shapingMatch) {
      try {
        shapingPayload = JSON.parse(
          `{${shapingMatch[1]}}`
        );
      } catch { /* non-fatal */ }
    }

    // Strip marker from displayed content
    const nexusCleanContent = rawContent
      .replace(/\nREADY_TO_SHAPE:\{[^\n]+\}/g, "")
      .trim();

    res.write(`event: done\ndata: ${JSON.stringify({ content: nexusCleanContent, shapingPayload: shapingPayload ?? null, modelUsed, surface, memoryUpdated, detectedMode, focusSuggestion, ...(handoffSignal ? { handoffSignal } : {}), ...runMetadata })}\n\n`);
    res.end();
  };

  const failStream = async (summary: string, status: RunStatus = "failed") => {
    if (streamDone || res.writableEnded || res.destroyed) return;
    streamDone = true;
    writeStep({ verb: status === "cancelled" ? "Cancelled" : "Failed", target: "Atlas response", status: status === "cancelled" ? "warn" : "fail" });
    const metadata = failedRunMetadata(summary, status);
    res.write(`event: done\ndata: ${JSON.stringify({
      content: "",
      surface: null,
      memoryUpdated: false,
      detectedMode: "strategic",
      ...metadata,
    })}\n\n`);
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
    writeStep({ verb: "Call", target: "Gemini" });
    modelStartedAt = performance.now();
    if (imageBase64 && imageMimeType) {
      const result = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{ role: "user", parts: [{ text: combinedText }, { inlineData: { mimeType: imageMimeType, data: imageBase64 } }] }],
        config: { systemInstruction: systemPrompt },
      });
      rawContent = result.text ?? "";
      const usageMetadata = (result as any).usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
      const inputTokens = nullableNumber(usageMetadata?.promptTokenCount);
      const outputTokens = nullableNumber(usageMetadata?.candidatesTokenCount)
        ?? (usageMetadata?.totalTokenCount != null && inputTokens != null ? Math.max(usageMetadata.totalTokenCount - inputTokens, 0) : null);
      modelUsage = {
        executionTimeMs: Math.max(1, Math.round(performance.now() - modelStartedAt)),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd("gemini-2.5-pro", inputTokens, outputTokens),
      };
    } else {
      const result = await genai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: combinedText,
        config: { systemInstruction: systemPrompt },
      });
      rawContent = result.text ?? "";
      const usageMetadata = (result as any).usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
      const inputTokens = nullableNumber(usageMetadata?.promptTokenCount);
      const outputTokens = nullableNumber(usageMetadata?.candidatesTokenCount)
        ?? (usageMetadata?.totalTokenCount != null && inputTokens != null ? Math.max(usageMetadata.totalTokenCount - inputTokens, 0) : null);
      modelUsage = {
        executionTimeMs: Math.max(1, Math.round(performance.now() - modelStartedAt)),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd("gemini-2.5-pro", inputTokens, outputTokens),
      };
    }
    res.write(`event: token\ndata: ${JSON.stringify(rawContent)}\n\n`);
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

  // 2. Live URL screenshots (image blocks only — text fallback blocks go via urlNote)
  for (const ub of urlBlocks) {
    if (ub.type === "image") {
      contentParts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: ub.source.media_type,
          data: ub.source.data,
        },
      } as VaultBlock);
    }
  }

  // 3. User-attached image (if any)
  if (imageBase64 && imageMimeType) {
    contentParts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: imageBase64,
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
  writeStep({ verb: "Call", target: "Claude" });
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: anthropicMessages,
  });

  let fullText = "";

  stream.on("text", (text) => {
    fullText += text;
    res.write(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
  });

  stream.on("error", (err) => {
    const cancelled = /\b(abort|cancel|cancelled|canceled)\b/i.test(err.message);
    writeStep({ verb: "Stream", target: "Claude", status: cancelled ? "warn" : "fail" });
    void failStream(err.message || "Atlas ran into an issue.", cancelled ? "cancelled" : "failed");
  });

  stream.on("finalMessage", async (message) => {
    try {
      const inputTokens = nullableNumber((message as any)?.usage?.input_tokens);
      const outputTokens = nullableNumber((message as any)?.usage?.output_tokens);
      modelUsage = {
        executionTimeMs: Math.max(1, Math.round(performance.now() - modelStartedAt)),
        inputTokens,
        outputTokens,
        costUsd: calculateModelCostUsd("claude-sonnet-4-6", inputTokens, outputTokens),
      };
      await finishStream(fullText);
    } catch (err) {
      req.log.error({ err }, "nexus/chat stream finalization error");
      await failStream("Atlas ran into an issue. Please try again.", "failed");
    }
  });

  return;

  } catch (err) {
    req.log.error({ err }, "nexus/chat error");
    if (res.headersSent && !res.writableEnded) {
      const metadata = failedRunMetadata("Atlas ran into an issue. Please try again.", "failed");
      res.write(`event: done\ndata: ${JSON.stringify({
        content: "",
        surface: null,
        memoryUpdated: false,
        detectedMode: "strategic",
        ...metadata,
      })}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: "Atlas ran into an issue. Please try again." });
    }
  }
});

router.post("/shaping/hold", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { title, audience, tension, what } = req.body as {
    title?: string;
    audience?: string;
    tension?: string;
    what?: string;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    // Create a shaping project
    const rows = await db.execute(sql`
      INSERT INTO projects (
        user_id,
        name,
        description,
        entity_type,
        created_at,
        updated_at
      )
      VALUES (
        ${userId},
        ${title.trim()},
        ${JSON.stringify({
          audience: audience ?? null,
          tension: tension ?? null,
          what: what ?? null,
          shapedAt: new Date().toISOString(),
        })},
        'idea',
        now(),
        now()
      )
      RETURNING id, name, entity_type, created_at
    `);

    const project = rows.rows[0];
    res.status(201).json({ project });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "Failed to hold shaping";
    res.status(500).json({ error: message });
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
      // Return the brief for frontend to confirm — never silently auto-create a project.
      res.json({ ok: false, requiresProject: true, brief });
      return;
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
  const ghToken = await resolveGithubTokenForUser(userId);
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

router.post("/nexus/visualize", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { prompt } = req.body as { prompt?: string };
  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  try {
    const result = await genai.models.generateImages({
      model: "imagen-3.0-generate-002",
      prompt: `Product UI mockup sketch, clean minimal design, dark theme: ${prompt}`,
      config: {
        numberOfImages: 1,
        aspectRatio: "16:9",
        safetyFilterLevel: SafetyFilterLevel.BLOCK_ONLY_HIGH,
      },
    });

    const imageBytes = result.generatedImages?.[0]
      ?.image?.imageBytes;
    
    if (!imageBytes) {
      res.status(500).json({ error: "No image generated" });
      return;
    }

    res.json({ 
      imageBase64: imageBytes,
      mimeType: "image/png",
    });
  } catch (err) {
    const message = err instanceof Error 
      ? err.message 
      : "Image generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
