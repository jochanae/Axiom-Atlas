import { Router, type IRouter, type Request, type Response } from "express";
import { spawn, type ChildProcess } from "child_process";
import { access, mkdir } from "fs/promises";
import path from "path";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { connectionsTable, db, projectsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import {
  classifyTerminalCommand,
  evaluateTerminalRequest,
  executeTerminalCommand,
  getTerminalHistory,
  parseTerminalTier,
} from "../lib/terminalExecution";
import { decryptToken } from "../lib/tokenCrypto";

const router: IRouter = Router();
const SANDBOX_ROOT = "/tmp/axiom-sandbox";
const NO_LINKED_REPO_MESSAGE = "No GitHub repo linked to this project. Link one in project settings to run commands.";

type ParsedLinkedRepo = { owner: string; repo: string; fullName: string };
type PreparedProjectRepo = { cwd: string; githubToken: string | null };

class TerminalHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function resolveStoredGithubToken(storedToken: string | null | undefined): string | null {
  const plain = storedToken ? decryptToken(storedToken) : null;
  return plain && plain !== "__server__" ? plain : null;
}

async function getAccountGithubToken(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;

  const [connection] = await db
    .select({ token: connectionsTable.token })
    .from(connectionsTable)
    .where(and(
      eq(connectionsTable.userId, userId),
      eq(connectionsTable.type, "github"),
      isNotNull(connectionsTable.token)
    ))
    .orderBy(desc(connectionsTable.createdAt))
    .limit(1);

  return resolveStoredGithubToken(connection?.token);
}

async function resolveGithubTokenForRequest(
  userId: number | undefined,
  projectGithubToken: string | null | undefined
): Promise<string | null> {
  const accountToken = await getAccountGithubToken(userId);
  if (accountToken) return accountToken;

  return resolveStoredGithubToken(projectGithubToken) ?? process.env.GITHUB_TOKEN ?? null;
}

function parseOwnerRepoCandidate(value: string): ParsedLinkedRepo | null {
  const cleaned = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!cleaned) return null;

  const urlMatch = cleaned.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
  const pathMatch = cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  const match = urlMatch ?? pathMatch;
  if (!match) return null;

  const owner = decodeURIComponent(match[1]).trim();
  const repo = decodeURIComponent(match[2]).trim().replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function parseLinkedRepo(raw: string | null): ParsedLinkedRepo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      owner?: unknown;
      repo?: unknown;
      name?: unknown;
      fullName?: unknown;
      full_name?: unknown;
      url?: unknown;
      html_url?: unknown;
    };
    if (typeof parsed.owner === "string" && typeof parsed.repo === "string") {
      return parseOwnerRepoCandidate(`${parsed.owner}/${parsed.repo}`);
    }
    const fullName = typeof parsed.fullName === "string"
      ? parsed.fullName
      : typeof parsed.full_name === "string"
        ? parsed.full_name
        : null;
    if (fullName) return parseOwnerRepoCandidate(fullName);
    const url = typeof parsed.url === "string"
      ? parsed.url
      : typeof parsed.html_url === "string"
        ? parsed.html_url
        : null;
    if (url) return parseOwnerRepoCandidate(url);
    if (typeof parsed.owner === "string" && typeof parsed.name === "string") {
      return parseOwnerRepoCandidate(`${parsed.owner}/${parsed.name}`);
    }
    return null;
  } catch {
    return parseOwnerRepoCandidate(raw);
  }
}

function parseProjectId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const projectId = typeof value === "number" ? value : Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactToken(text: string, token: string | null): string {
  if (!token) return text;
  return [token, encodeURIComponent(token)].reduce((redacted, secret) => (
    secret ? redacted.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]") : redacted
  ), text);
}

function buildCloneUrl(repo: ParsedLinkedRepo, token: string | null): string {
  const repoPath = `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  return token
    ? `https://${encodeURIComponent(token)}@github.com/${repoPath}.git`
    : `https://github.com/${repoPath}.git`;
}

function runGit(args: string[], token: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const chunks: string[] = [];

    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const output = redactToken(chunks.join("").trim(), token);
      reject(new Error(output || `git ${args[0] ?? "command"} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function prepareProjectRepo(projectId: number, userId: number): Promise<PreparedProjectRepo> {
  const [project] = await db
    .select({
      id: projectsTable.id,
      linkedRepo: projectsTable.linkedRepo,
      githubToken: projectsTable.githubToken,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) throw new TerminalHttpError(404, "Project not found");

  const repo = parseLinkedRepo(project.linkedRepo ?? null);
  if (!repo) throw new TerminalHttpError(400, NO_LINKED_REPO_MESSAGE);

  const githubToken = await resolveGithubTokenForRequest(userId, project.githubToken ?? null);
  const cwd = path.join(SANDBOX_ROOT, String(projectId));
  const cloneUrl = buildCloneUrl(repo, githubToken);

  try {
    await mkdir(SANDBOX_ROOT, { recursive: true });
    if (await pathExists(cwd)) {
      await runGit(["-C", cwd, "remote", "set-url", "origin", cloneUrl], githubToken);
      await runGit(["-C", cwd, "pull"], githubToken);
    } else {
      await runGit(["clone", "--depth", "1", cloneUrl, cwd], githubToken);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown git error";
    logger.error({ err, projectId, repo: repo.fullName }, "Failed to prepare terminal project repo");
    throw new TerminalHttpError(500, `Failed to prepare GitHub repo: ${redactToken(message, githubToken)}`);
  }

  return { cwd, githubToken };
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

  let preparedRepo: PreparedProjectRepo | null = null;
  if (projectId !== undefined) {
    try {
      const userId = (req as any).authUser.id as number;
      preparedRepo = await prepareProjectRepo(projectId, userId);
    } catch (err: unknown) {
      const status = err instanceof TerminalHttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Failed to prepare GitHub repo";
      res.status(status).json({ error: message });
      return;
    }
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

  try {
    const result = await executeTerminalCommand(command, {
      onStart: (startedCommand) => send("start", startedCommand),
      onStdout: (text) => send("output", text),
      onStderr: (text) => send("stderr", text),
      onProcess: (child) => { proc = child; },
    }, {
      cwd: preparedRepo?.cwd,
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
