import { spawn } from "child_process";
import fsPromises from "fs/promises";
import path from "path";
import { db, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { projectWorkspaceDir, ensureProjectWorkspaceDir } from "./projectWorkspace";
import { resolveGithubTokenForRequest, parseLinkedRepo, buildCloneUrl, redactToken } from "./terminalSandbox";
import type { Logger } from "pino";

/** Returns true if the workspace directory already has a `.git` folder. */
export async function isWorkspaceInitialized(workspaceDir: string): Promise<boolean> {
  try {
    await fsPromises.access(path.join(workspaceDir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget: clone the linked GitHub repo into the project workspace.
 * Called at activation time. Swallows all errors — hydration failure is non-fatal;
 * the user can retry from the Workspace panel.
 */
export async function cloneRepoBackground(
  projectId: number,
  userId: number,
  log?: Logger
): Promise<void> {
  try {
    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    const repo = parseLinkedRepo(project?.linkedRepo ?? null);
    if (!repo) return;

    const workspaceDir = await ensureProjectWorkspaceDir(projectId);

    const initialized = await isWorkspaceInitialized(workspaceDir);
    if (initialized) return;

    const token = await resolveGithubTokenForRequest(userId, project?.githubToken ?? null);
    const cloneUrl = buildCloneUrl(repo, token);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["clone", cloneUrl, "."], {
        cwd: workspaceDir,
        env: { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: "0" },
        stdio: "pipe",
      });
      const errChunks: string[] = [];
      proc.stderr.on("data", (chunk: Buffer) => {
        errChunks.push(token ? redactToken(chunk.toString(), token) : chunk.toString());
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git clone exited ${code}: ${errChunks.join("").trim().slice(0, 200)}`));
      });
    });

    log?.info({ projectId, repo: repo.fullName }, "workspace hydration: clone complete");
  } catch (err) {
    log?.warn({ err, projectId }, "workspace hydration failed (non-fatal)");
  }
}
