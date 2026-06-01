import { and, eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { logger } from "./logger";
import { resolveGithubTokenForUser } from "./githubToken";
import { spawn } from "child_process";
import { access, mkdir } from "fs/promises";

export const SANDBOX_ROOT = "/tmp/axiom-sandbox";
export const NO_LINKED_REPO_MESSAGE = "No GitHub repo linked to this project. Link one in project settings to run commands.";

export class TerminalHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ParsedLinkedRepo = { fullName: string };
export type PreparedProjectRepo = { sandboxDir: string; githubToken: string | null };

export type PrepareRepoOptions = {
  onStatus?: (message: string) => void;
};

export function parseLinkedRepo(raw: string | null): ParsedLinkedRepo | null {
  if (!raw) return null;
  try {
    const repoData = typeof raw === "string" ? JSON.parse(raw) as { fullName?: unknown } : raw;
    const fullName = repoData?.fullName;
    return typeof fullName === "string" && fullName.trim()
      ? { fullName: fullName.trim().replace(/\.git$/, "").replace(/^\/+|\/+$/g, "") }
      : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactToken(text: string, token: string | null): string {
  if (!token) return text;
  return [token, encodeURIComponent(token)].reduce((redacted, secret) => (
    secret ? redacted.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]") : redacted
  ), text);
}

export function buildCloneUrl(repo: ParsedLinkedRepo, token: string | null): string {
  return token
    ? `https://${token}@github.com/${repo.fullName}.git`
    : `https://github.com/${repo.fullName}.git`;
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

export function runGit(args: string[], token: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const chunks: string[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) { resolve(); return; }
      const output = redactToken(chunks.join("").trim(), token);
      reject(new Error(output || `git ${args[0] ?? "command"} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

function detectPackageManager(sandboxDir: string): Promise<"pnpm" | "yarn" | "npm"> {
  return Promise.all([
    pathExists(`${sandboxDir}/pnpm-lock.yaml`),
    pathExists(`${sandboxDir}/yarn.lock`),
  ]).then(([hasPnpm, hasYarn]) => {
    if (hasPnpm) return "pnpm";
    if (hasYarn) return "yarn";
    return "npm";
  });
}

function runInstall(pm: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pm, ["install", "--prefer-offline"], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
    });
    const chunks: string[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) { resolve(); return; }
      const output = chunks.join("").trim().slice(0, 500);
      reject(new Error(output || `${pm} install failed with exit code ${code ?? "unknown"}`));
    });
  });
}

export async function prepareProjectRepo(projectId: number, userId: number, options?: PrepareRepoOptions): Promise<PreparedProjectRepo> {
  const { onStatus } = options ?? {};

  const [project] = await db
    .select({
      id: projectsTable.id,
      linkedRepo: projectsTable.linkedRepo,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) throw new TerminalHttpError(404, "Project not found");

  const repo = parseLinkedRepo(project.linkedRepo ?? null);
  if (!repo) throw new TerminalHttpError(400, NO_LINKED_REPO_MESSAGE);

  const githubToken = await resolveGithubTokenForUser(userId);
  const sandboxDir = `${SANDBOX_ROOT}/${projectId}`;
  const cloneUrl = buildCloneUrl(repo, githubToken);

  try {
    await mkdir(SANDBOX_ROOT, { recursive: true });

    if (await pathExists(sandboxDir)) {
      onStatus?.(`Updating ${repo.fullName}...`);
      await runGit(["-C", sandboxDir, "remote", "set-url", "origin", cloneUrl], githubToken);
      await runGit(["-C", sandboxDir, "pull"], githubToken);
    } else {
      onStatus?.(`Cloning ${repo.fullName}...`);
      await runGit(["clone", "--depth", "1", cloneUrl, sandboxDir], githubToken);
    }

    const hasPackageJson = await pathExists(`${sandboxDir}/package.json`);
    const hasNodeModules = await pathExists(`${sandboxDir}/node_modules`);

    if (hasPackageJson && !hasNodeModules) {
      const pm = await detectPackageManager(sandboxDir);
      onStatus?.(`Installing dependencies with ${pm}...`);
      try {
        await runInstall(pm, sandboxDir);
        onStatus?.("Dependencies installed.");
      } catch (installErr: unknown) {
        const msg = installErr instanceof Error ? installErr.message : "install failed";
        logger.warn({ projectId, pm, err: installErr }, "Dependency install failed — continuing anyway");
        onStatus?.(`Warning: ${pm} install failed (${msg.slice(0, 120)}). Some commands may not work.`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof TerminalHttpError) throw err;
    const message = err instanceof Error ? err.message : "unknown git error";
    logger.error({ err, projectId, repo: repo.fullName }, "Failed to prepare terminal project repo");
    throw new TerminalHttpError(500, `Failed to prepare GitHub repo: ${redactToken(message, githubToken)}`);
  }

  return { sandboxDir, githubToken };
}
