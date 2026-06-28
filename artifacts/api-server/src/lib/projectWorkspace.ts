import { mkdir } from "fs/promises";
import path from "path";
import { db, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const PROJECT_WORKSPACE_ROOT =
  process.env.PROJECT_WORKSPACE_ROOT ?? "/home/runner/workspace/.project-workspaces";

/** Absolute path to a project's workspace directory. Never touches disk. */
export function projectWorkspaceDir(projectId: number): string {
  return path.join(PROJECT_WORKSPACE_ROOT, String(projectId));
}

/** Ensure the workspace directory exists and return its path. */
export async function ensureProjectWorkspaceDir(projectId: number): Promise<string> {
  const dir = projectWorkspaceDir(projectId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a user-supplied relative path against the workspace root.
 * Throws if the resolved path escapes the workspace directory (traversal guard).
 */
export function resolveWorkspacePath(workspaceDir: string, userPath: string): string {
  const cleaned = userPath.replace(/^\/+/, "");
  const resolved = path.resolve(workspaceDir, cleaned);
  if (resolved !== workspaceDir && !resolved.startsWith(workspaceDir + path.sep)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/** Verify the project belongs to the user. Returns true if owner, false if not found/not owner. */
export async function assertProjectOwner(projectId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return !!row;
}
