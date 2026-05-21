import { Router, type IRouter, type Request, type Response } from "express";
import { type ChildProcess } from "child_process";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import {
  classifyTerminalCommand,
  evaluateTerminalRequest,
  executeTerminalCommand,
  getTerminalHistory,
  parseTerminalTier,
} from "../lib/terminalExecution";
import {
  prepareProjectRepo,
  TerminalHttpError,
  type PrepareRepoOptions,
} from "../lib/terminalSandbox";

const router: IRouter = Router();

function parseProjectId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const projectId = typeof value === "number" ? value : Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
}

// POST /api/terminal/classify — classify a command before deciding how to run it
router.post("/terminal/classify", requireAuth, (req: Request, res: Response): void => {
  const { command, projectId } = req.body as { command?: string; projectId?: unknown };
  if (!command?.trim()) {
    res.status(400).json({ error: "Missing command" });
    return;
  }
  const parsedProjectId = parseProjectId(projectId);
  if (parsedProjectId === null) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  res.json(classifyTerminalCommand(command, { sandbox: parsedProjectId !== undefined }));
});

// POST /api/terminal/exec — execute a command, stream output as SSE
router.post("/terminal/exec", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { command, tier, confirmationToken } = req.body as {
    command?: string;
    tier?: unknown;
    confirmationToken?: string;
    projectId?: unknown;
  };
  if (!command?.trim()) {
    res.status(400).json({ error: "Missing command" });
    return;
  }

  const projectId = parseProjectId(req.body?.projectId);
  if (projectId === null) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  if (command.trim().toLowerCase() === "help") {
    res.json({
      output: `COMMON COMMANDS
───────────────────────────────
git status      see what changed in your repo
git push        send changes to GitHub → triggers deploy
git pull        get latest changes from GitHub
git log         see recent commits
git diff        see exact line changes
ls              list files in this folder
pwd             show current location
cat <file>      read a file's contents

ATLAS COMMANDS
───────────────────────────────
Ask Atlas in Chat and it can suggest
commands to run here automatically.
Type any command above to get started.`,
      exitCode: 0,
    });
    return;
  }

  const requestedTier = parseTerminalTier(tier);
  const evaluation = evaluateTerminalRequest(command, requestedTier, confirmationToken, {
    sandbox: projectId !== undefined,
  });
  if (evaluation.tier === "blocked") {
    res.status(403).json({ error: evaluation.reason });
    return;
  }
  if (evaluation.requiresConfirmation) {
    res.json({
      requiresConfirmation: true,
      tier: evaluation.tier,
      command,
      reason: evaluation.reason,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let proc: ChildProcess | null = null;
  req.on("close", () => {
    try { proc?.kill("SIGTERM"); } catch {}
  });

  let preparedRepo: Awaited<ReturnType<typeof prepareProjectRepo>> | null = null;
  if (projectId !== undefined) {
    try {
      const userId = (req as any).authUser.id as number;
      const repoOptions: PrepareRepoOptions = { onStatus: (msg) => send("status", msg) };
      preparedRepo = await prepareProjectRepo(projectId, userId, repoOptions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to prepare GitHub repo";
      send("error", message);
      res.end();
      return;
    }
  }

  try {
    const result = await executeTerminalCommand(command, {
      onStart: (startedCommand) => send("start", startedCommand),
      onStdout: (text) => send("output", text),
      onStderr: (text) => send("stderr", text),
      onProcess: (child) => { proc = child; },
    }, {
      cwd: preparedRepo?.sandboxDir,
      githubToken: preparedRepo?.githubToken,
    });
    send("done", JSON.stringify({ output: result.output, exitCode: result.exitCode, durationMs: result.durationMs }));
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Terminal command failed";
    send("error", message);
    res.end();
  }
});

// GET /api/terminal/history — last N commands with their output
router.get("/terminal/history", requireAuth, (_req, res): void => {
  res.json({ history: getTerminalHistory() });
});

// POST /api/terminal/explain — scenario mode: explain what a command WOULD do without executing
router.post("/terminal/explain", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { command } = req.body as { command?: string };
  if (!command?.trim()) {
    res.status(400).json({ error: "Missing command" });
    return;
  }
  if (command.trim().length > 500) {
    res.status(400).json({ error: "Command too long (max 500 characters)" });
    return;
  }
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `You are in SCENARIO mode — a safe what-if simulation. Explain in 2–4 plain-English sentences what this shell command WOULD do if executed in a Node/pnpm monorepo project root. Do NOT execute it. Focus on: what files/processes would be affected, what the expected output would be, and any risk or side effect worth knowing. Be specific.\n\nCommand: \`${command.trim()}\``,
      }],
    });
    const text = msg.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("").trim();
    res.json({ explanation: text });
  } catch (err: unknown) {
    logger.error({ err }, "terminal/explain error");
    res.status(500).json({ error: "Could not generate explanation" });
  }
});

export default router;
