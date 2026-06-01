import { and, desc, eq, isNotNull } from "drizzle-orm";
import { connectionsTable, db, projectsTable } from "@workspace/db";
import { decryptToken } from "./tokenCrypto";

export type GithubTokenSource = "connection" | "project" | "env" | "none";

export type GithubTokenResolution = {
  token: string | null;
  source: GithubTokenSource;
};

const SENTINEL_TOKENS = new Set(["__server__", "__account__"]);

export function resolveStoredGithubToken(storedToken: string | null | undefined): string | null {
  const plain = storedToken ? decryptToken(storedToken).trim() : "";
  if (!plain || SENTINEL_TOKENS.has(plain)) return null;
  if (plain.startsWith("enc:")) return null;
  return plain;
}

export async function resolveGithubTokenDetailsForUser(
  userId: number | null | undefined
): Promise<GithubTokenResolution> {
  if (userId) {
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

    const connectionToken = resolveStoredGithubToken(connection?.token);
    if (connectionToken) return { token: connectionToken, source: "connection" };

    const [project] = await db
      .select({ githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(and(
        eq(projectsTable.userId, userId),
        isNotNull(projectsTable.githubToken)
      ))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(1);

    const projectToken = resolveStoredGithubToken(project?.githubToken);
    if (projectToken) return { token: projectToken, source: "project" };
  }

  const envToken = resolveStoredGithubToken(process.env.GITHUB_TOKEN);
  if (envToken) return { token: envToken, source: "env" };

  return { token: null, source: "none" };
}

export async function resolveGithubTokenForUser(userId: number | null | undefined): Promise<string | null> {
  const { token } = await resolveGithubTokenDetailsForUser(userId);
  return token;
}
