import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, chatMessagesTable, sessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { SendMessageBody } from "@workspace/api-zod";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
- When you write code, show only what changes — not the entire file.
- Format code blocks cleanly with the language and filename.
- Be direct. No filler, no pleasantries. They're busy.

Code context:
When file contents are provided in the conversation, use them directly. Reference specific line numbers and function names. Do not guess at code you haven't seen.

Stack you're optimizing for: React, React Router, Tailwind CSS, Supabase (auth + database). TanStack Start for the Atlas project specifically.

You may also generate UI sketches or product concept images when asked — the user uses this to think visually about their product ideas.`;

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

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sessionId, projectId, message, mode, history = [], entries = [] } = parsed.data;

  const fileContext = (req.body.fileContext as string | undefined) ?? "";
  const systemPrompt = fileContext
    ? `${DEV_SYSTEM_PROMPT}\n\n--- CODE CONTEXT ---\n${fileContext}\n--- END CODE CONTEXT ---`
    : DEV_SYSTEM_PROMPT;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...(history || []).map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: message },
  ];

  await db.insert(chatMessagesTable).values({
    sessionId,
    role: "user",
    content: message,
    intentType: mode,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const rawContent = response.content[0]?.type === "text" ? response.content[0].text : "";
  const { content: afterChips, memoryChips } = detectMemoryChips(rawContent);

  const [savedMsg] = await db.insert(chatMessagesTable).values({
    sessionId,
    role: "assistant",
    content: afterChips,
    intentType: null,
    catchPayload: undefined,
  }).returning();

  await db
    .update(sessionsTable)
    .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
    .where(eq(sessionsTable.id, sessionId));

  res.json({
    content: afterChips,
    intentType: null,
    catchPayload: null,
    memoryChips: memoryChips.length > 0 ? memoryChips : undefined,
    messageId: savedMsg.id,
  });
});

export default router;
