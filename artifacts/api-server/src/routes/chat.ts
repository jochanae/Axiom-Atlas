import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, chatMessagesTable, sessionsTable, projectsTable } from "@workspace/db";
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

You may also generate UI sketches or product concept images when asked — the user uses this to think visually about their product ideas.

Memory protocol:
When you learn something durable about this project — a bug pattern, a component relationship, a decision, a tech fact specific to their setup — write it on its own line at the END of your response in this exact format:
PROJECT_MEMORY: [one plain-English sentence]

Only use PROJECT_MEMORY when you've confirmed something that will still be true next session. Skip it for observations, questions, or things already in the project memory above. Maximum one PROJECT_MEMORY line per response.`;

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

function extractProjectMemoryLines(content: string): { content: string; newFacts: string[] } {
  const lines = content.split("\n");
  const newFacts: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("PROJECT_MEMORY:")) {
      const fact = trimmed.slice("PROJECT_MEMORY:".length).trim();
      if (fact) newFacts.push(fact);
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n").trim(), newFacts };
}

function appendToMemory(existing: string | null, newFacts: string[]): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = newFacts.map((f) => `[${now}] ${f}`);
  if (!existing || !existing.trim()) return lines.join("\n");
  return existing.trim() + "\n" + lines.join("\n");
}

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sessionId, projectId, message, mode, history = [], entries = [] } = parsed.data;

  const fileContext = (req.body.fileContext as string | undefined) ?? "";
  const userProfile = (req.body.userProfile as string | undefined) ?? "";

  // Load project memory from DB
  const [project] = await db.select({ memory: projectsTable.memory }).from(projectsTable).where(eq(projectsTable.id, projectId));
  const projectMemory = project?.memory ?? "";

  // Build layered system prompt
  let systemPrompt = DEV_SYSTEM_PROMPT;
  if (userProfile) {
    systemPrompt += `\n\n--- WHO YOU'RE WORKING WITH ---\n${userProfile}`;
  }
  if (projectMemory) {
    systemPrompt += `\n\n--- PROJECT MEMORY (what you already know about this project) ---\n${projectMemory}\n--- END PROJECT MEMORY ---`;
  }
  if (fileContext) {
    systemPrompt += `\n\n--- CODE CONTEXT ---\n${fileContext}\n--- END CODE CONTEXT ---`;
  }

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

  // Parse PROJECT_MEMORY: lines first, then memory chips
  const { content: afterMemory, newFacts } = extractProjectMemoryLines(rawContent);
  const { content: afterChips, memoryChips } = detectMemoryChips(afterMemory);

  // Persist new memory facts to DB
  if (newFacts.length > 0) {
    const updatedMemory = appendToMemory(project?.memory ?? null, newFacts);
    await db.update(projectsTable).set({ memory: updatedMemory }).where(eq(projectsTable.id, projectId));
  }

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
    memoryUpdated: newFacts.length > 0,
  });
});

export default router;
