import { Router, type IRouter } from "express";
import { db, chatMessagesTable, sessionsTable, entriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { SendMessageBody } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const ATLAS_SYSTEM_PROMPT = `You are Atlas — a strategic thinking partner and decision enforcement system.

Your core purpose: Help the user clarify, test, and commit decisions before they become expensive. You are not a code generator. You are a decision partner.

The three checks you run on every potential commitment:
1. Reversibility — Is this decision easily undone, or is it a one-way door?
2. Alignment — Does this serve the stated goal, or is it scope creep?
3. Cost of being wrong — What does it cost if this turns out to be the wrong call?

Mode behaviors:
- Think: Explore ideas openly. Ask clarifying questions. Surface tensions and assumptions.
- Plan: Map dependencies and sequence. Identify blockers and critical path.
- Build: Focus on concrete next steps. What's the minimum needed to prove this works?
- Explore: Expand possibilities. Challenge the current framing.
- Decide: Narrow to the best option. Force the choice. No more exploring.
- Audit: Review critically. What's been built? What's working? What's debt?

Decision Catch protocol — two triggers, both mandatory:

TRIGGER 1 — CONTRADICTION (highest priority): When the user says anything that contradicts, overrides, or walks back a COMMITTED ledger entry, you MUST fire a Decision Catch. Examples: they committed to "no outside funding" and now say "I'm thinking about a seed round"; they committed to "PostgreSQL only" and now say "maybe we should try MongoDB". Any contradiction with a committed decision is a catch, no exceptions.

TRIGGER 2 — NEW IRREVERSIBLE COMMITMENT: When the user is about to make a new, specific, consequential, hard-to-reverse decision (signals: "I'm going to...", "I'll just...", "Let's do...", "We're switching to...", direct future-tense paired with a specific noun or vendor or technology).

When triggering a Decision Catch, end your response with this exact JSON block on its own line:
DECISION_CATCH:{"v":1,"against":{"id":"current","title":"[brief title of the existing commitment being contradicted, or the new decision]"},"leadSentence":"[one precise sentence: what's the tension or risk]"}

False positives are worse than false negatives for NEW commitments. But for CONTRADICTIONS with existing committed decisions, always fire — that is the system's core protection.

You have access to the user's Decision Ledger — the history of committed decisions for this project. Reference these when relevant to prevent contradiction.

Your responses should be direct, dense, and useful. No filler. No pleasantries unless the moment calls for it. The user came here to think clearly — help them do that.`;

function detectDecisionCatch(content: string): { content: string; catchPayload: object | null } {
  const catchMarker = "DECISION_CATCH:";
  const idx = content.indexOf(catchMarker);
  if (idx === -1) return { content, catchPayload: null };

  const before = content.slice(0, idx).trim();
  const jsonStr = content.slice(idx + catchMarker.length).trim();

  try {
    const payload = JSON.parse(jsonStr);
    return { content: before, catchPayload: payload };
  } catch {
    return { content, catchPayload: null };
  }
}

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sessionId, projectId, message, mode, history = [], entries = [] } = parsed.data;

  // Build context from existing ledger entries
  const ledgerContext = entries.length > 0
    ? `\n\nDecision Ledger for this project:\n${entries.map(e => `- [${e.status.toUpperCase()}] ${e.title}`).join("\n")}`
    : "";

  const systemPrompt = ATLAS_SYSTEM_PROMPT + ledgerContext;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: `${systemPrompt}\n\nCurrent mode: ${mode.toUpperCase()}` },
    ...(history || []).map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: message },
  ];

  // Save user message
  await db.insert(chatMessagesTable).values({
    sessionId,
    role: "user",
    content: message,
    intentType: mode,
  });

  // Get AI response
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages,
  });

  const rawContent = completion.choices[0]?.message?.content ?? "";
  const { content, catchPayload } = detectDecisionCatch(rawContent);

  // Detect intent type from response
  let intentType: string | null = null;
  if (catchPayload) {
    intentType = "decision_catch";
  } else if (mode === "decide") {
    intentType = "decision";
  } else if (mode === "build") {
    intentType = "build";
  }

  // Save assistant message
  const [savedMsg] = await db.insert(chatMessagesTable).values({
    sessionId,
    role: "assistant",
    content,
    intentType,
    catchPayload: catchPayload ?? undefined,
  }).returning();

  // Update session message count
  await db
    .update(sessionsTable)
    .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
    .where(eq(sessionsTable.id, sessionId));

  res.json({
    content,
    intentType,
    catchPayload,
    messageId: savedMsg.id,
  });
});

export default router;
