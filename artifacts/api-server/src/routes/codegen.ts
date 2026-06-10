import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post("/codegen", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const { prompt, projectId, sessionId, context, model = "claude-sonnet-4-6" } = req.body as {
    prompt?: string;
    projectId?: number;
    sessionId?: number;
    context?: string | null;
    model?: string;
  };

  if (!prompt?.trim()) { res.status(400).json({ error: "prompt is required" }); return; }

  if (projectId) {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) { res.status(403).json({ error: "Project not found" }); return; }
  }

  try {
    const systemPrompt = `You are a code generation engine. When given a prompt, respond with a single code file.

Your response must follow this exact format:
FILENAME: <filename with extension>
LANGUAGE: <language name>
---
<complete file content here>

Rules:
- Always include FILENAME and LANGUAGE headers
- Always include the --- separator
- Write complete, working code — no placeholders or ellipsis
- Never include explanation outside the file content`;

    const fullPrompt = context
      ? `Context:\n${context}\n\nTask:\n${prompt}`
      : prompt;

    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: fullPrompt }],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";

    // Parse FILENAME / LANGUAGE / content
    const filenameMatch = raw.match(/^FILENAME:\s*(.+)$/m);
    const languageMatch = raw.match(/^LANGUAGE:\s*(.+)$/m);
    const separatorIndex = raw.indexOf("\n---\n");
    const content = separatorIndex >= 0 ? raw.slice(separatorIndex + 5).trim() : raw.trim();
    const filename = filenameMatch?.[1]?.trim() ?? "generated.ts";
    const language = languageMatch?.[1]?.trim() ?? "typescript";

    res.json({
      file: { filename, language, content },
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "codegen route error");
    res.status(500).json({ error: err?.message ?? "Codegen failed" });
  }
});

export default router;
