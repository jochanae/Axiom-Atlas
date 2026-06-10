import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, projectsTable, sessionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post("/codegen", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const { prompt, projectId, sessionId, model = "claude-sonnet-4-6", maxTokens = 8192 } = req.body as {
    prompt?: string;
    projectId?: number;
    sessionId?: number;
    model?: string;
    maxTokens?: number;
  };

  if (!prompt?.trim()) { res.status(400).json({ error: "prompt is required" }); return; }

  // Verify project ownership when projectId is provided
  if (projectId) {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) { res.status(403).json({ error: "Project not found" }); return; }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    stream.on("text", (text) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "token", text })}\n\n`);
      }
    });

    stream.on("error", (err) => {
      logger.error({ err }, "codegen stream error");
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    });

    stream.on("finalMessage", async (message) => {
      const content = message.content[0]?.type === "text" ? message.content[0].text : "";
      const inputTokens = message.usage?.input_tokens ?? null;
      const outputTokens = message.usage?.output_tokens ?? null;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "done", content, inputTokens, outputTokens })}\n\n`);
        res.end();
      }
    });

  } catch (err: any) {
    logger.error({ err }, "codegen route error");
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "error", message: err?.message ?? "Codegen failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;
