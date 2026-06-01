import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { connectionsTable, db, projectsTable } from "@workspace/db";
import { decryptToken, encryptToken } from "../lib/tokenCrypto";
import { resolveGithubTokenDetailsForUser, resolveGithubTokenForUser } from "../lib/githubToken";

const router: IRouter = Router();

const ConnectionBody = z.object({
  type: z.enum(["github", "railway", "lovable", "cursor"]),
  label: z.string().min(1).optional(),
  url: z.string().url().optional(),
  token: z.string().min(1).optional(),
});

type ParsedLinkedRepo = { owner: string; repo: string; fullName: string };

function parseOwnerRepoCandidate(value: string): ParsedLinkedRepo | null {
  const cleaned = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");
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
  } catch {
    return parseOwnerRepoCandidate(raw);
  }
  return null;
}

function serializeConnection(row: typeof connectionsTable.$inferSelect) {
  const { token: _token, ...rest } = row;
  return {
    ...rest,
    hasToken: !!_token,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function githubConnectionAuth(userId: number) {
  const resolution = await resolveGithubTokenDetailsForUser(userId);
  if (!resolution.token) {
    return {
      hasToken: false,
      hasResolvedToken: false,
      tokenSource: resolution.source,
      githubStatus: "missing",
      githubUser: null,
    };
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${resolution.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Atlas-Connections/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        hasToken: true,
        hasResolvedToken: true,
        tokenSource: resolution.source,
        githubStatus: "failed",
        githubStatusCode: response.status,
        githubUser: null,
      };
    }

    const user = await response.json() as { login?: unknown; id?: unknown; html_url?: unknown };
    return {
      hasToken: true,
      hasResolvedToken: true,
      tokenSource: resolution.source,
      githubStatus: "active",
      githubUser: {
        login: typeof user.login === "string" ? user.login : null,
        id: typeof user.id === "number" ? user.id : null,
        url: typeof user.html_url === "string" ? user.html_url : null,
      },
    };
  } catch {
    return {
      hasToken: true,
      hasResolvedToken: true,
      tokenSource: resolution.source,
      githubStatus: "failed",
      githubUser: null,
    };
  }
}

async function getLatestGithubProject(userId: number) {
  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      linkedRepo: projectsTable.linkedRepo,
      updatedAt: projectsTable.updatedAt,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.userId, userId), isNotNull(projectsTable.linkedRepo)))
    .orderBy(desc(projectsTable.updatedAt))
    .limit(1);
  return project ?? null;
}

router.get("/connections", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const connections = await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.userId, userId))
    .orderBy(desc(connectionsTable.createdAt));

  const serialized = await Promise.all(connections.map(async (connection) => {
    const base = serializeConnection(connection);
    if (connection.type !== "github") return base;
    return {
      ...base,
      ...(await githubConnectionAuth(userId)),
      hasStoredToken: base.hasToken,
    };
  }));

  res.json(serialized);
});

router.post("/connections", async (req, res): Promise<void> => {
  const parsed = ConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).authUser.id as number;
  const body = parsed.data;
  let url = body.url ?? null;
  let token: string | null = null;
  let metadata: Record<string, unknown> | null = null;

  if (body.type === "github") {
    // If a PAT is provided, store it encrypted so the authoritative resolver can use it.
    if (body.token) {
      token = encryptToken(body.token);
    }
    // Try to associate with the latest linked repo for metadata — non-fatal if missing
    const project = await getLatestGithubProject(userId);
    const repo = parseLinkedRepo(project?.linkedRepo ?? null);
    if (repo) {
      url = url ?? `https://github.com/${repo.fullName}`;
      metadata = { projectId: project!.id, repo: repo.fullName, projectName: project!.name };
    } else if (!url && !body.token) {
      res.status(400).json({ error: "Provide either a GitHub repo URL or a personal access token" });
      return;
    }
  } else if (body.type === "railway") {
    if (!body.token) {
      res.status(400).json({ error: "Railway token is required" });
      return;
    }
    token = encryptToken(body.token);
  } else {
    if (!body.url) {
      res.status(400).json({ error: `${body.type} url is required` });
      return;
    }
  }

  const [connection] = await db
    .insert(connectionsTable)
    .values({
      userId,
      type: body.type,
      label: (body.label ?? (body.type === "github" ? "GitHub" : body.type)).trim(),
      url,
      token,
      metadata,
    })
    .returning();

  res.status(201).json(serializeConnection(connection));
});

router.delete("/connections/:id", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid connection id" });
    return;
  }

  await db
    .delete(connectionsTable)
    .where(and(eq(connectionsTable.id, id), eq(connectionsTable.userId, userId)));
  res.sendStatus(204);
});

async function githubStatus(userId: number) {
  const project = await getLatestGithubProject(userId);
  const repo = parseLinkedRepo(project?.linkedRepo ?? null);
  const token = await resolveGithubTokenForUser(userId);
  if (!project || !repo || !token) return { type: "github", status: "missing" };

  const response = await fetch(`https://api.github.com/repos/${repo.fullName}/commits?per_page=1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Atlas-Connections/1.0",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { type: "github", status: "failed", repo: repo.fullName };

  const commits = await response.json() as Array<{
    commit?: {
      message?: string;
      author?: { name?: string; date?: string };
    };
  }>;
  const commit = commits[0]?.commit;
  return {
    type: "github",
    status: "active",
    repo: repo.fullName,
    lastCommit: commit ? {
      message: commit.message ?? "",
      timestamp: commit.author?.date ?? null,
      author: commit.author?.name ?? null,
    } : null,
  };
}

async function railwayStatus(connection: typeof connectionsTable.$inferSelect) {
  if (!connection.token) return { type: "railway", status: "missing" };
  const token = decryptToken(connection.token);
  const query = `query {
    me {
      projects {
        edges {
          node {
            id
            name
            deployments(first: 1) {
              edges {
                node {
                  status
                  createdAt
                }
              }
            }
          }
        }
      }
    }
  }`;

  const response = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { type: "railway", status: "failed" };

  const data = await response.json() as {
    data?: {
      me?: {
        projects?: {
          edges?: Array<{
            node?: {
              deployments?: {
                edges?: Array<{ node?: { status?: string; createdAt?: string } }>;
              };
            };
          }>;
        };
      };
    };
  };
  const latestDeploy = data.data?.me?.projects?.edges
    ?.flatMap((edge) => edge.node?.deployments?.edges ?? [])
    ?.map((edge) => edge.node)
    ?.filter((node): node is { status?: string; createdAt?: string } => !!node)
    ?.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
  const rawStatus = latestDeploy?.status?.toLowerCase() ?? "active";
  const status = rawStatus.includes("fail") || rawStatus.includes("crash")
    ? "failed"
    : rawStatus.includes("build") || rawStatus.includes("deploy") || rawStatus.includes("initial")
      ? "building"
      : "active";

  return {
    type: "railway",
    status,
    lastDeploy: latestDeploy ? {
      status: latestDeploy.status ?? null,
      timestamp: latestDeploy.createdAt ?? null,
    } : null,
  };
}

router.get("/connections/status", async (req, res): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const connections = await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.userId, userId))
    .orderBy(desc(connectionsTable.createdAt));

  const statuses = await Promise.all(connections.map(async (connection) => {
    try {
      if (connection.type === "github") return githubStatus(userId);
      if (connection.type === "railway") return railwayStatus(connection);
      if (connection.type === "lovable") return { type: "lovable", status: "linked", url: connection.url };
      if (connection.type === "cursor") return { type: "cursor", status: "linked", url: connection.url };
      return { type: connection.type, status: "linked" };
    } catch {
      return { type: connection.type, status: "failed" };
    }
  }));

  res.json({ connections: statuses });
});

export default router;
