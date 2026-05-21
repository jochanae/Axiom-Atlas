import { Router, type IRouter, type Request, type Response } from "express";
import { spawn, spawnSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const WORK_DIR = process.env.GIT_WORK_DIR ?? process.env.HOME ?? "/home/runner/workspace";
const MAX_HISTORY = 60;
const MAX_CMD_LENGTH = 2000;

type HistoryEntry = {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  timestamp: string;
  durationMs: number;
};

const history: HistoryEntry[] = [];

function addHistory(entry: HistoryEntry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
}

// Commands that could destroy the server environment
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/i,        // rm -rf /
  /rm\s+-[a-z]*f[a-z]*r?\s+\/(?:\s|$)/i,        // rm -fr /
  /:\s*\(\s*\)\s*\{.*\|.*&.*\}/,                 // fork bomb
  /\|\s*bash\b/i,                                // curl | bash, wget | bash
  /\|\s*sh\b/i,                                  // pipe into sh
  /mkfs\b/i,                                     // format filesystem
  /dd\s+.*of=\/dev\//i,                          // dd to device
  />\s*\/dev\/sd/i,                              // redirect to block device
  /chmod\s+-[a-z]*R[a-z]*\s+777\s+\//i,         // chmod -R 777 /
  /shutdown\b/i,                                  // shutdown
  /reboot\b/i,                                    // reboot
  /halt\b/i,                                      // halt
  /kill\s+-9\s+1\b/,                             // kill init
  /pkill\s+-9\s+node/i,                          // kill all node processes
];

function isDangerous(cmd: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return `Command blocked: matches dangerous pattern (${pattern.source.slice(0, 40)})`;
  }
  if (cmd.length > MAX_CMD_LENGTH) return `Command too long (max ${MAX_CMD_LENGTH} chars)`;
  return null;
}

// POST /api/terminal/exec — execute a command, stream output as SSE
router.post("/terminal/exec", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { command, projectId } = req.body as { command?: string; projectId?: number };
  if (!command?.trim()) {
    res.status(400).json({ error: "Missing command" });
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

  const danger = isDangerous(command);
  if (danger) {
    res.status(403).json({ error: danger });
    return;
  }

  // Resolve working directory — clone repo into sandbox if projectId provided
  let cwd = WORK_DIR;
  if (projectId) {
    try {
      const rows = await db
        .select({ linkedRepo: projectsTable.linkedRepo })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);

      const raw = rows[0]?.linkedRepo;
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) as { fullName?: string } : raw as { fullName?: string };
        const fullName = parsed.fullName;
        if (fullName) {
          const sandboxDir = `/tmp/axiom-sandbox/${projectId}`;
          if (!existsSync(sandboxDir)) {
            mkdirSync(sandboxDir, { recursive: true });
            const gitToken = process.env.GITHUB_TOKEN ?? "";
            const cloneUrl = `https://${gitToken ? gitToken + "@" : ""}github.com/${fullName}.git`;
            const clone = spawnSync("git", ["clone", "--depth", "1", cloneUrl, sandboxDir], {
              encoding: "utf8",
              timeout: 30000,
            });
            if (clone.status !== 0) {
              logger.warn({ fullName, stderr: clone.stderr }, "Repo clone failed — falling back to WORK_DIR");
            } else {
              cwd = sandboxDir;
            }
          } else {
            cwd = sandboxDir;
          }
        }
      }
    } catch (err) {
      logger.warn({ err, projectId }, "Could not resolve sandbox dir — falling back to WORK_DIR");
    }
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const start = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("start", command);

  const outputChunks: string[] = [];

  const gitToken = process.env.GITHUB_TOKEN ?? "";
  const gitUser = process.env.GIT_USER_NAME ?? "jochanae";
  const gitEmail = process.env.GIT_USER_EMAIL ?? "jochanae@gmail.com";

  const proc = spawn("bash", ["-c", command], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "dumb",
      GIT_AUTHOR_NAME: gitUser,
      GIT_AUTHOR_EMAIL: gitEmail,
      GIT_COMMITTER_NAME: gitUser,
      GIT_COMMITTER_EMAIL: gitEmail,
      GIT_ASKPASS: "echo",
      GIT_TERMINAL_PROMPT: "0",
      GITHUB_TOKEN: gitToken,
    },
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    outputChunks.push(text);
    send("output", text);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    outputChunks.push(text);
    send("stderr", text);
  });

  proc.on("close", (code) => {
    const durationMs = Date.now() - start;
    const fullOutput = outputChunks.join("");
    send("done", JSON.stringify({ exitCode: code, durationMs }));
    res.end();
    addHistory({
      id, command,
      output: fullOutput.slice(0, 8000),
      exitCode: code,
      timestamp: new Date().toISOString(),
      durationMs,
    });
    logger.info({ command, exitCode: code, durationMs }, "Terminal command executed");
  });

  proc.on("error", (err) => {
    send("error", err.message);
    res.end();
  });

  req.on("close", () => {
    try { proc.kill("SIGTERM"); } catch {}
  });
});

// GET /api/terminal/history — last N commands with their output
router.get("/terminal/history", requireAuth, (_req, res): void => {
  res.json({ history: [...history].reverse() });
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
