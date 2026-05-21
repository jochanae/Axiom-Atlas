import { and, desc, eq, isNotNull } from "drizzle-orm";
import { connectionsTable, db, projectsTable } from "@workspace/db";
import { logger } from "./logger";
import { decryptToken } from "./tokenCrypto";
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

export function resolveStoredGithubToken(storedToken: string | null | undefined): string | null {
  const plain = storedToken ? decryptToken(storedToken) : null;
  return plain && plain !== "__server__" ? plain : null;
}

export async function getAccountGithubToken(userId: number | undefined): Promise<string | null> {
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

export async function resolveGithubTokenForRequest(
  userId: number | undefined,
  projectGithubToken: string | null | undefined
): Promise<string | null> {
  const accountToken = await getAccountGithubToken(userId);
  if (accountToken) return accountToken;
  return resolveStoredGithubToken(projectGithubToken) ?? process.env.GITHUB_TOKEN ?? null;
}

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
    ? `https://${encodeURIComponent(token)}@github.com/${repo.fullName}.git`
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

export async function prepareProjectRepo(projectId: number, userId: number): Promise<PreparedProjectRepo> {
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
  const sandboxDir = `${SANDBOX_ROOT}/${projectId}`;
  const cloneUrl = buildCloneUrl(repo, githubToken);

  try {
    await mkdir(SANDBOX_ROOT, { recursive: true });
    if (await pathExists(sandboxDir)) {
      await runGit(["-C", sandboxDir, "remote", "set-url", "origin", cloneUrl], githubToken);
      await runGit(["-C", sandboxDir, "pull"], githubToken);
    } else {
      await runGit(["clone", "--depth", "1", cloneUrl, sandboxDir], githubToken);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown git error";
    logger.error({ err, projectId, repo: repo.fullName }, "Failed to prepare terminal project repo");
    throw new TerminalHttpError(500, `Failed to prepare GitHub repo: ${redactToken(message, githubToken)}`);
  }

  return { sandboxDir, githubToken };
}
