import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, chatMessagesTable, sessionsTable, projectsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

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
- When you write code, explain the change before showing it.
- Format code blocks cleanly with the language and filename.
- Be direct. No filler, no pleasantries. They're busy.

Code context:
When file contents are provided in the conversation, use them directly. Reference specific line numbers and function names. Do not guess at code you haven't seen.

Stack you're optimizing for: React, React Router, Tailwind CSS, Supabase (auth + database). TanStack Start for the Atlas project specifically.

You may also generate UI sketches or product concept images when asked — the user uses this to think visually about their product ideas.

Memory protocol:
When you learn something durable about this project — a bug pattern, a component relationship, a decision, a tech fact specific to their setup — write it on its own line at the END of your response in this exact format:
PROJECT_MEMORY: [one plain-English sentence]

Only use PROJECT_MEMORY when you've confirmed something that will still be true next session. Skip it for observations, questions, or things already in the project memory above. Maximum one PROJECT_MEMORY line per response.

FILE_EDIT protocol (Phase 2 — writing code back to GitHub):
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
- The FILE_EDIT blocks are invisible to the user in chat — they see a "Code ready" button instead.`;

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

  // Everything before the first FILE_EDIT_START is the visible explanation
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

  const { sessionId, projectId, message, mode, history = [], entries = [] } = body;

  const fileContext = body.fileContext ?? "";
  const userProfile = body.userProfile ?? "";
  const imageData = body.imageData;

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

  type TextBlock = { type: "text"; text: string };
  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };

  const userContent: string | Array<TextBlock | ImageBlock> = imageData
    ? [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageData.base64 } },
        { type: "text", text: message },
      ]
    : message;

  const messages: Array<{ role: "user" | "assistant"; content: string | Array<TextBlock | ImageBlock> }> = [
    ...(history || []).map((h: { role: string; content: string }) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userContent },
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

  // Parse in order: all FILE_EDITs → PROJECT_MEMORY → MEMORY_CHIPS
  const { visibleContent, fileEdits } = extractAllFileEdits(rawContent);
  const { content: afterMemory, newFacts } = extractProjectMemoryLines(visibleContent);
  const { content: finalContent, memoryChips: aiMemoryChips } = detectMemoryChips(afterMemory);

  // Auto-match ledger entries referenced in the response
  const entryChips = matchEntryChips(finalContent, entries as Array<{ id: number; title: string; status: string }>);
  const allChips = [...new Set([...aiMemoryChips, ...entryChips])].slice(0, 6);

  // Persist new memory facts to DB
  if (newFacts.length > 0) {
    const updatedMemory = appendToMemory(project?.memory ?? null, newFacts);
    await db.update(projectsTable).set({ memory: updatedMemory }).where(eq(projectsTable.id, projectId));
  }

  const [savedMsg] = await db.insert(chatMessagesTable).values({
    sessionId,
    role: "assistant",
    content: finalContent,
    intentType: null,
    catchPayload: undefined,
  }).returning();

  await db
    .update(sessionsTable)
    .set({ messageCount: sql`${sessionsTable.messageCount} + 2` })
    .where(eq(sessionsTable.id, sessionId));

  res.json({
    content: finalContent,
    intentType: null,
    catchPayload: null,
    memoryChips: allChips.length > 0 ? allChips : undefined,
    messageId: savedMsg.id,
    memoryUpdated: newFacts.length > 0,
    fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
    // Keep backward-compat single fileEdit field
    fileEdit: fileEdits.length > 0 ? fileEdits[0] : undefined,
  });
});

export default router;
