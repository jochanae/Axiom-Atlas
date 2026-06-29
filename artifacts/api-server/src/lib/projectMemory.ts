import { eq, desc } from "drizzle-orm";
import { db, projectsTable, sessionsTable, entriesTable } from "@workspace/db";
import { getGithubTokenForUser, generateAtlasMd, type ProjectMemory } from "./githubBootstrap";
import { getProjectDNA } from "./projectDNA";

const GH_API = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Axiom-Atlas/1.0",
    "Content-Type": "application/json",
  };
}

function parseLinkedRepo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { fullName?: string };
    return parsed.fullName ?? null;
  } catch {
    return typeof raw === "string" ? raw : null;
  }
}

export async function synthesizeProjectMemory(projectId: number, projectName: string): Promise<ProjectMemory> {
  const [dna, recentSessions, recentEntries] = await Promise.all([
    getProjectDNA(projectId),
    db.select({ title: sessionsTable.title, status: sessionsTable.status })
      .from(sessionsTable)
      .where(eq(sessionsTable.projectId, projectId))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(5),
    db.select({ title: entriesTable.title, mode: entriesTable.mode })
      .from(entriesTable)
      .where(eq(entriesTable.projectId, projectId))
      .orderBy(desc(entriesTable.createdAt))
      .limit(15),
  ]);

  return {
    projectName,
    genome: {
      purpose: dna?.purpose,
      audience: dna?.audience,
      wedge: dna?.wedge,
      stage: dna?.stage ?? null,
      stack: dna?.stack ?? [],
      protectedAreas: dna?.protectedAreas ?? [],
      constraints: dna?.constraints ?? [],
      openQuestions: dna?.openQuestions ?? [],
    },
    recentSessions,
    recentEntries,
  };
}

export async function pushAtlasMdToRepo(
  projectId: number,
  userId: number,
  logger?: { error: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    const [project] = await db
      .select({ name: projectsTable.name, linkedRepo: projectsTable.linkedRepo })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project?.linkedRepo) return;

    const repoFullName = parseLinkedRepo(project.linkedRepo);
    if (!repoFullName) return;

    const token = await getGithubTokenForUser(userId);
    if (!token) return;

    const memory = await synthesizeProjectMemory(projectId, project.name);
    const content = generateAtlasMd(memory);

    const shaResp = await fetch(`${GH_API}/repos/${repoFullName}/contents/ATLAS.md`, {
      headers: ghHeaders(token),
    });
    const sha = shaResp.ok ? ((await shaResp.json()) as { sha?: string }).sha : undefined;

    await fetch(`${GH_API}/repos/${repoFullName}/contents/ATLAS.md`, {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: "Refresh Atlas Memory",
        content: Buffer.from(content).toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
  } catch (err) {
    logger?.error({ err }, "pushAtlasMdToRepo failed");
  }
}
