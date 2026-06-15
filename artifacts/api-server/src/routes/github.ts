import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { atlasIncidentsTable, connectionsTable, db, entriesTable, projectsTable } from "@workspace/db";
import { eq, and, desc, isNotNull, sql } from "drizzle-orm";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { randomBytes } from "crypto";
import * as nodePath from "path";
import { decryptToken } from "../lib/tokenCrypto";

const router: IRouter = Router();

const GH_API = "https://api.github.com";

// In-memory CSRF state store for GitHub OAuth (10-minute TTL)
export const oauthStateStore = new Map<string, { userId: number; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStateStore.entries()) {
    if (v.expiresAt < now) oauthStateStore.delete(k);
  }
}, 5 * 60 * 1000).unref();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const COMMIT_CACHE_TTL_MS = 60_000;

type CommitFileSummary = {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
};

type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
  files: CommitFileSummary[];
};

const commitsCache = new Map<string, { expiresAt: number; payload: { commits: CommitSummary[] } }>();

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Atlas-Dev-Env/1.0",
  };
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

type GithubTokenRequest = {
  headers: Record<string, string | string[] | undefined>;
  authUser?: { id?: number } | null;
};

/** Resolve token: use the header value unless it's the sentinel "__server__", then fall back to account/env token. */
async function getToken(req: GithubTokenRequest): Promise<string | null> {
  const h = (req.headers["x-github-token"] as string | undefined ?? "").trim();
  if (h && h !== "__server__") return h;
  const accountToken = await getAccountGithubToken(req.authUser?.id);
  return accountToken ?? process.env.GITHUB_TOKEN ?? null;
}

type ParsedLinkedRepo = { owner: string; repo: string; fullName: string };

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

class GitHubApiError extends Error {
  constructor(public status: number, public detail: string) {
    super("GitHub API error");
  }
}

async function getBranchSha(token: string, repo: string, branch: string): Promise<string> {
  const refResp = await fetch(`${GH_API}/repos/${repo}/git/ref/heads/${branch}`, { headers: ghHeaders(token) });
  if (!refResp.ok) throw new GitHubApiError(refResp.status, await refResp.text());

  const refData = await refResp.json() as any;
  return refData.object.sha as string;
}

async function createBranch(token: string, repo: string, branch: string, sha: string): Promise<void> {
  const createResp = await fetch(`${GH_API}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });

  if (!createResp.ok) throw new GitHubApiError(createResp.status, await createResp.text());
}

async function commitFile(token: string, repo: string, branch: string, filePath: string, content: string, message: string) {
  let currentSha: string | undefined;
  const existingResp = await fetch(`${GH_API}/repos/${repo}/contents/${filePath}?ref=${branch}`, { headers: ghHeaders(token) });
  if (existingResp.ok) { const d = await existingResp.json() as any; currentSha = d.sha; }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
  };
  if (currentSha) body.sha = currentSha;

  const putResp = await fetch(`${GH_API}/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!putResp.ok) throw new GitHubApiError(putResp.status, await putResp.text());

  const putData = await putResp.json() as any;
  return {
    sha: putData.content?.sha,
    commitSha: putData.commit?.sha,
    commitUrl: putData.commit?.html_url,
  };
}

async function openPullRequest(token: string, repo: string, head: string, base: string, title: string, body: string) {
  const prResp = await fetch(`${GH_API}/repos/${repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!prResp.ok) throw new GitHubApiError(prResp.status, await prResp.text());

  const pr = await prResp.json() as any;
  return { prUrl: pr.html_url, prNumber: pr.number, title: pr.title };
}

async function runWorkspaceTypecheck(): Promise<{ ok: true } | { ok: false; message: string }> {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? "/home/runner/workspace";
  const tscPath = nodePath.join(workspaceRoot, "node_modules/.bin/tsc");

  return await new Promise((resolve) => {
    const proc = spawn(tscPath, ["--noEmit"], { cwd: workspaceRoot, env: process.env });
    let output = "";
    proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("error", (e) => resolve({ ok: false, message: e.message }));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, message: output.trim() || `tsc --noEmit failed with exit code ${code ?? "unknown"}` });
    });
  });
}

// GET /api/github/server-token — tells the client whether a server-side token is configured
router.get("/github/server-token", (_req, res): void => {
  res.json({ available: !!process.env.GITHUB_TOKEN });
});

// POST /api/github/token — save (or update) the user-level GitHub personal access token.
// Validates the token against GitHub, then upserts a github connection row with it.
// This is what the Account settings "Save GitHub Token" button calls.
router.post("/github/token", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const token = typeof req.body?.token === "string" ? req.body.token.trim() : null;
  if (!token) { res.status(400).json({ error: "token is required" }); return; }

  // Validate against GitHub
  const ghRes = await fetch(`${GH_API}/user`, { headers: ghHeaders(token), signal: AbortSignal.timeout(8000) });
  if (!ghRes.ok) {
    res.status(422).json({ error: "Invalid GitHub token — make sure it is a classic PAT with repo scope" });
    return;
  }
  const ghUser = await ghRes.json() as { login?: string; avatar_url?: string };
  const username = ghUser.login ?? "GitHub";

  const { encryptToken } = await import("../lib/tokenCrypto");
  const encrypted = encryptToken(token);

  // Upsert: find the newest existing github connection for this user, update its token.
  // Delete all other github connections to clean up duplicates.
  const existing = await db
    .select({ id: connectionsTable.id })
    .from(connectionsTable)
    .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "github")))
    .orderBy(desc(connectionsTable.createdAt));

  if (existing.length > 0) {
    // Keep the first (newest), delete the rest
    const [keep, ...dupes] = existing;
    if (dupes.length > 0) {
      const dupeIds = dupes.map((d) => d.id);
      for (const dupeId of dupeIds) {
        await db.delete(connectionsTable).where(and(eq(connectionsTable.id, dupeId), eq(connectionsTable.userId, userId)));
      }
    }
    await db
      .update(connectionsTable)
      .set({ token: encrypted, label: username, url: `https://github.com/${username}`, status: "linked", lastCheckedAt: new Date() })
      .where(and(eq(connectionsTable.id, keep.id), eq(connectionsTable.userId, userId)));
  } else {
    await db.insert(connectionsTable).values({
      userId,
      type: "github",
      label: username,
      url: `https://github.com/${username}`,
      token: encrypted,
      status: "linked",
    });
  }

  res.json({ connected: true, username });
});

// DELETE /api/github/token — disconnect the user-level GitHub token
router.delete("/github/token", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  await db
    .delete(connectionsTable)
    .where(and(eq(connectionsTable.userId, userId), eq(connectionsTable.type, "github")));

  res.json({ connected: false });
});

// GET /api/github/oauth/start — begins the GitHub OAuth flow
// User must be logged in. Redirects to GitHub for authorization.
router.get("/github/oauth/start", async (req, res): Promise<void> => {
  // Try session cookie first, then fall back to Bearer token
  const { getUserFromCookie } = await import("./auth");
  const user = await getUserFromCookie(req);
  const userId = user?.id ?? (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) { res.status(503).json({ error: "GitHub OAuth is not configured on this server" }); return; }

  const state = randomBytes(20).toString("hex");
  oauthStateStore.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });

  const appDomain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "axiomsystem.app";
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "repo",
    state,
    redirect_uri: `https://${appDomain}/api/github/oauth/callback`,
  });
  const redirectUrl = `https://github.com/login/oauth/authorize?${params}`;

  // If the frontend asks for JSON (fetch with Accept: application/json),
  // return the URL so the frontend can redirect via JS. This is more reliable
  // on mobile because fetch with credentials: "include" sends the cookie.
  const wantsJson = req.headers.accept?.includes("application/json") || req.query.json === "1";
  if (wantsJson) {
    res.json({ url: redirectUrl });
    return;
  }

  res.redirect(redirectUrl);
});


// GET /api/github/status?projectId=N — unified GitHub connection status
// Returns one clear answer covering account-level, project-level, and server tokens.
// hasUserToken = true means writes/commits are possible.
// hasServerToken = true means reads work (but NOT private repos the user owns).
router.get("/github/status", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const projectId = req.query.projectId ? Number(req.query.projectId) : null;

  const accountToken = await getAccountGithubToken(userId);

  let projectToken: string | null = null;
  let linkedRepoRaw: string | null = null;
  if (projectId && Number.isFinite(projectId)) {
    const [project] = await db
      .select({ githubToken: projectsTable.githubToken, linkedRepo: projectsTable.linkedRepo })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (project) {
      projectToken = resolveStoredGithubToken(project.githubToken);
      linkedRepoRaw = project.linkedRepo ?? null;
    }
  }

  const userToken = accountToken ?? projectToken;
  const hasServerToken = !!process.env.GITHUB_TOKEN;
  const linkedRepo = parseLinkedRepo(linkedRepoRaw)?.fullName ?? null;

  res.json({
    hasUserToken: !!userToken,
    hasProjectToken: !!projectToken,
    hasAccountToken: !!accountToken,
    hasServerToken,
    canRead: !!(userToken ?? hasServerToken),
    canWrite: !!userToken,
    source: userToken ? (accountToken ? "account" : "project") : (hasServerToken ? "server" : null),
    linkedRepo,
  });
});

// GET /api/github/repos
router.get("/github/repos", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const resp = await fetch(`${GH_API}/user/repos?per_page=100&sort=pushed&type=owner`, { headers: ghHeaders(token) });
  if (!resp.ok) { res.status(resp.status).json({ error: "GitHub API error", detail: await resp.text() }); return; }

  const repos = await resp.json() as any[];
  res.json(repos.map(r => ({
    id: r.id, name: r.name, fullName: r.full_name, private: r.private,
    description: r.description, language: r.language,
    defaultBranch: r.default_branch, updatedAt: r.pushed_at, url: r.html_url,
  })));
});

// GET /api/github/tree
router.get("/github/tree", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, branch = "main" } = req.query as { repo?: string; branch?: string };
  if (!repo) { res.status(400).json({ error: "Missing repo param" }); return; }

  const resp = await fetch(`${GH_API}/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: ghHeaders(token) });
  if (!resp.ok) {
    if (branch === "main") {
      const fallback = await fetch(`${GH_API}/repos/${repo}/git/trees/master?recursive=1`, { headers: ghHeaders(token) });
      if (fallback.ok) {
        const data = await fallback.json() as any;
        res.json({ tree: data.tree, branch: "master", truncated: data.truncated });
        return;
      }
    }
    res.status(resp.status).json({ error: "GitHub API error", detail: await resp.text() });
    return;
  }

  const data = await resp.json() as any;
  res.json({ tree: data.tree, branch, truncated: data.truncated });
});

// GET /api/github/file
router.get("/github/file", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, path: filePath, branch = "main" } = req.query as { repo?: string; path?: string; branch?: string };
  if (!repo || !filePath) { res.status(400).json({ error: "Missing repo or path param" }); return; }

  const resp = await fetch(`${GH_API}/repos/${repo}/contents/${filePath}?ref=${branch}`, { headers: ghHeaders(token) });
  if (!resp.ok) { res.status(resp.status).json({ error: "GitHub API error", detail: await resp.text() }); return; }

  const data = await resp.json() as any;
  if (data.encoding === "base64") {
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    const lines = content.split("\n").length;
    const truncated = lines > 800;
    res.json({ path: data.path, content: truncated ? content.split("\n").slice(0, 800).join("\n") : content, size: data.size, sha: data.sha, truncated, lines });
  } else {
    res.status(422).json({ error: "File encoding not supported", encoding: data.encoding });
  }
});

// GET /api/projects/:projectId/commits — recent commit history for the linked repo
router.get("/projects/:projectId/commits", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const repo = parseLinkedRepo(project.linkedRepo ?? null);
  const token = await resolveGithubTokenForRequest(userId, project.githubToken ?? null);
  if (!repo) { res.json({ commits: [], reason: "parse_error", raw: project.linkedRepo ?? null }); return; }
  if (!token) { res.json({ commits: [], reason: "no_token" }); return; }
  console.log("[github commits] parsed repo", { owner: repo.owner, repo: repo.repo });

  const cacheKey = `${project.id}:${repo.fullName}`;
  const cached = commitsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.payload);
    return;
  }

  try {
    const repoPath = `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const listResp = await fetch(`${GH_API}/repos/${repoPath}/commits?per_page=20`, { headers: ghHeaders(token) });
    if (!listResp.ok) {
      res.status(listResp.status).json({ error: "GitHub API error", detail: await listResp.text() });
      return;
    }

    const list = await listResp.json() as any[];
    const commits = await Promise.all(list.map(async (item): Promise<CommitSummary> => {
      const sha = String(item.sha ?? "");
      const detailResp = await fetch(`${GH_API}/repos/${repoPath}/commits/${sha}`, { headers: ghHeaders(token) });
      const detail = detailResp.ok ? await detailResp.json() as any : item;
      const files = Array.isArray(detail.files)
        ? detail.files.map((file: any): CommitFileSummary => ({
            filename: String(file.filename ?? ""),
            additions: Number(file.additions ?? 0),
            deletions: Number(file.deletions ?? 0),
            status: String(file.status ?? ""),
          }))
        : [];

      return {
        sha,
        message: String(detail.commit?.message ?? item.commit?.message ?? ""),
        author: String(detail.commit?.author?.name ?? item.commit?.author?.name ?? detail.author?.login ?? item.author?.login ?? "Unknown"),
        timestamp: String(detail.commit?.author?.date ?? item.commit?.author?.date ?? new Date().toISOString()),
        url: String(detail.html_url ?? item.html_url ?? `https://github.com/${repo.fullName}/commit/${sha}`),
        files,
      };
    }));

    const payload = { commits };
    commitsCache.set(cacheKey, { expiresAt: Date.now() + COMMIT_CACHE_TTL_MS, payload });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: "GitHub API error", detail: String(e) });
  }
});

// POST /api/github/branch
router.post("/github/branch", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, branch, baseBranch = "main" } = req.body as { repo: string; branch: string; baseBranch?: string };
  if (!repo || !branch) { res.status(400).json({ error: "Missing repo or branch" }); return; }

  let sha: string | undefined;
  for (const base of [baseBranch, baseBranch === "main" ? "master" : "main"]) {
    const r = await fetch(`${GH_API}/repos/${repo}/git/ref/heads/${base}`, { headers: ghHeaders(token) });
    if (r.ok) { const d = await r.json() as any; sha = d.object.sha; break; }
  }
  if (!sha) { res.status(404).json({ error: "Base branch not found" }); return; }

  const createResp = await fetch(`${GH_API}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });

  if (!createResp.ok) {
    const errText = await createResp.text();
    if (errText.includes("already exists")) { res.json({ branch, sha, alreadyExists: true }); return; }
    res.status(createResp.status).json({ error: "GitHub API error", detail: errText });
    return;
  }
  res.json({ branch, sha, alreadyExists: false });
});

// PUT /api/github/commit
router.put("/github/commit", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, branch = "main", path: filePath, content, message, forceDirect = false, projectId, project_id, confidence, blast_radius, blastRadius, reasoning } = req.body as {
    repo: string; branch?: string; path?: string; content?: string; message: string; forceDirect?: boolean; projectId?: string; project_id?: string; confidence?: string; blast_radius?: string; blastRadius?: string; reasoning?: string;
  };
  if (!repo || !filePath || content === undefined || !message) {
    res.status(400).json({ error: "Missing required fields: repo, path, content, message" }); return;
  }

  try {
    if (branch !== "main" || forceDirect) {
      const commit = await commitFile(token, repo, branch, filePath, content, message);
      res.json({ ...commit, path: filePath, branch, direct: true });
      return;
    }

    const pullBranch = `atlas/fix-${Date.now()}`;
    const validation = await runWorkspaceTypecheck();
    if (!validation.ok) {
      res.status(400).json({ error: "TypeScript validation failed", message: validation.message });
      return;
    }

    const baseSha = await getBranchSha(token, repo, "main");
    await createBranch(token, repo, pullBranch, baseSha);
    const commit = await commitFile(token, repo, pullBranch, filePath, content, message);
    const prBody = [
      "This was an Atlas-proposed change awaiting review.",
      "",
      "**Files changed:**",
      `- \`${filePath}\``,
    ].join("\n");
    const pr = await openPullRequest(token, repo, pullBranch, "main", message, prBody);
    await db.insert(atlasIncidentsTable).values({
      projectId: String(projectId ?? project_id ?? repo),
      filesChanged: [filePath],
      commitMessage: message,
      branchName: pullBranch,
      prUrl: pr.prUrl,
      validationPassed: true,
      confidence: confidence ?? null,
      blastRadius: blastRadius ?? blast_radius ?? null,
      reasoning: reasoning ?? null,
      outcome: null,
      notes: null,
    });

    res.json({ ...commit, ...pr, path: filePath, branch: pullBranch, base: "main", direct: false });
  } catch (e: unknown) {
    if (e instanceof GitHubApiError) {
      res.status(e.status).json({ error: "GitHub API error", detail: e.detail });
      return;
    }
    res.status(500).json({ error: "GitHub API error", detail: String(e) });
  }
});

// POST /api/github/pr
router.post("/github/pr", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, head, base, title, body = "" } = req.body as {
    repo: string; head: string; base: string; title: string; body?: string;
  };
  if (!repo || !head || !base || !title) {
    res.status(400).json({ error: "Missing required fields: repo, head, base, title" }); return;
  }

  const prResp = await fetch(`${GH_API}/repos/${repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!prResp.ok) {
    const detail = await prResp.text();
    res.status(prResp.status).json({ error: "GitHub API error", detail }); return;
  }

  const pr = await prResp.json() as any;
  res.json({ prUrl: pr.html_url, prNumber: pr.number, title: pr.title });
});

// POST /api/github/analyze — AI-powered project structure analysis
router.post("/github/analyze", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo, branch = "main" } = req.body as { repo: string; branch?: string };
  if (!repo) { res.status(400).json({ error: "Missing repo" }); return; }

  // 1. Get file tree (main → master fallback)
  let blobPaths: string[] = [];
  let actualBranch = branch;
  for (const b of [branch, branch === "main" ? "master" : "main"]) {
    const r = await fetch(`${GH_API}/repos/${repo}/git/trees/${b}?recursive=1`, { headers: ghHeaders(token) });
    if (r.ok) {
      const data = await r.json() as any;
      blobPaths = (data.tree as any[]).filter(n => n.type === "blob").map(n => n.path as string);
      actualBranch = b;
      break;
    }
  }
  if (blobPaths.length === 0) { res.status(404).json({ error: "Could not read repo tree" }); return; }

  // 2. Identify key files in priority order
  const candidates = [
    "package.json",
    "src/App.tsx", "src/App.jsx", "src/app.tsx", "src/app.jsx",
    "App.tsx", "App.jsx",
    "src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx",
    "src/router.tsx", "src/router.jsx", "src/routes.tsx", "src/routes.jsx",
    "src/routes/index.tsx",
    "README.md", "readme.md",
    "supabase/schema.sql",
  ];

  // Add first migration file if any
  const migFile = blobPaths.find(p => p.startsWith("supabase/migrations/") && p.endsWith(".sql"));
  if (migFile) candidates.push(migFile);

  // Add first hooks/context/store file
  const storeFile = blobPaths.find(p =>
    /^src\/(hooks|context|store|lib)\//i.test(p) && /\.(tsx|ts)$/.test(p)
  );
  if (storeFile) candidates.push(storeFile);

  const toFetch = candidates.filter(p => blobPaths.includes(p)).slice(0, 7);

  // Fallback: if no App found, try any capitalized tsx in src root
  if (!toFetch.some(p => /app/i.test(p))) {
    const fallback = blobPaths.find(p => /^src\/[A-Z][^/]+\.(tsx|jsx)$/.test(p));
    if (fallback && !toFetch.includes(fallback)) toFetch.splice(1, 0, fallback);
  }

  // 3. Fetch all key files in parallel (250 lines max each)
  const fileResults = await Promise.all(
    toFetch.map(async (path) => {
      try {
        const r = await fetch(`${GH_API}/repos/${repo}/contents/${path}?ref=${actualBranch}`, { headers: ghHeaders(token) });
        if (!r.ok) return null;
        const data = await r.json() as any;
        if (data.encoding !== "base64") return null;
        const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
        const lines = content.split("\n");
        return { path, content: lines.slice(0, 250).join("\n"), truncated: lines.length > 250 };
      } catch { return null; }
    })
  );
  const validFiles = fileResults.filter(Boolean) as { path: string; content: string; truncated: boolean }[];

  // 4. Build directory summary for context
  const dirCounts: Record<string, number> = {};
  for (const p of blobPaths) {
    const parts = p.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, Math.min(2, parts.length - 1)).join("/");
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
    }
  }
  const treeSummary = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([d, c]) => `${d}/ (${c} files)`)
    .join("\n");

  const fileBlock = validFiles
    .map(f => `=== ${f.path}${f.truncated ? " [truncated at 250 lines]" : ""} ===\n${f.content}`)
    .join("\n\n");

  // 5. Ask Claude to extract structure as JSON
  const prompt = `You are analyzing a React web application codebase. Based on the directory tree and key file contents below, extract the project structure.

Return ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON — with exactly this shape:
{
  "projectName": "string from package.json name field",
  "description": "one plain English sentence — what this app does for users",
  "stack": ["array of specific tech stack items found, e.g. React, Tailwind CSS, Supabase, TypeScript, Vite, React Router, TanStack Query"],
  "routes": ["array of URL path strings found in router config, e.g. /, /dashboard, /auth/login — max 20, omit duplicates"],
  "pages": ["array of page component file names without extension, e.g. Dashboard, Login, Settings — max 20"],
  "components": ["array of reusable component names without extension — max 15, only clearly reusable ones"],
  "tables": ["array of Supabase table names found in .from() calls or SQL CREATE TABLE statements — max 20"],
  "authEnabled": true or false based on whether auth code exists,
  "summary": "2-3 plain English sentences: what the app does, who it's for, what stage it seems to be at and what the main features are"
}

If information is not found in the files, use an empty array or reasonable default.

DIRECTORY TREE (${blobPaths.length} total files):
${treeSummary}

KEY FILE CONTENTS:
${fileBlock}`;

  let raw = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  } catch (e: any) {
    res.status(500).json({ error: "AI analysis failed", detail: e.message });
    return;
  }

  try {
    const cleaned = raw.replace(/^```json\s*/m, "").replace(/\s*```$/m, "").trim();
    const analysis = JSON.parse(cleaned) as {
      projectName?: string;
      description?: string;
      stack?: string[];
      routes?: string[];
      pages?: string[];
      components?: string[];
      tables?: string[];
      authEnabled?: boolean;
      summary?: string;
    };

    const response = {
      ...analysis,
      scannedAt: new Date().toISOString(),
      repo,
      branch: actualBranch,
      totalFiles: blobPaths.length,
    };

    // Write analysis to project memory so Atlas has permanent context.
    // Find the project by userId + linkedRepo containing this repo name.
    const userId = (req as any).authUser?.id as number | undefined;
    if (userId) {
      try {
        const userProjects = await db
          .select({ id: projectsTable.id, linkedRepo: projectsTable.linkedRepo, memory: projectsTable.memory })
          .from(projectsTable)
          .where(eq(projectsTable.userId, userId));

        const matchedProject = userProjects.find(p => {
          try {
            const lr = typeof p.linkedRepo === "string" ? JSON.parse(p.linkedRepo) as { fullName?: string } : p.linkedRepo as { fullName?: string } | null;
            return lr?.fullName === repo;
          } catch { return false; }
        });

        if (matchedProject) {
          const stackStr = analysis.stack?.join(", ") ?? "unknown";
          const memoryEntry = [
            `[REPO SCAN — ${new Date().toISOString().split("T")[0]}]`,
            analysis.summary ? `Summary: ${analysis.summary}` : null,
            analysis.description ? `Description: ${analysis.description}` : null,
            stackStr ? `Stack: ${stackStr}` : null,
            analysis.routes?.length ? `Routes: ${analysis.routes.slice(0, 10).join(", ")}` : null,
            analysis.tables?.length ? `DB tables: ${analysis.tables.join(", ")}` : null,
            analysis.authEnabled != null ? `Auth: ${analysis.authEnabled ? "enabled" : "not found"}` : null,
            `Total files: ${blobPaths.length}`,
          ].filter(Boolean).join("\n");

          // Prepend scan to existing memory (keep the most recent scan at top)
          const existing = matchedProject.memory ?? "";
          const stripped = existing.replace(/\[REPO SCAN[^\]]*\][\s\S]*?(?=\[REPO SCAN|\[PROJECT_MEMORY|$)/g, "").trim();
          const newMemory = [memoryEntry, stripped].filter(Boolean).join("\n\n");

          await db
            .update(projectsTable)
            .set({ memory: newMemory })
            .where(eq(projectsTable.id, matchedProject.id));

          // Seed one ledger entry if no entries exist for this project yet
          const [existing_entry] = await db
            .select({ id: entriesTable.id })
            .from(entriesTable)
            .where(eq(entriesTable.projectId, matchedProject.id))
            .limit(1);

          if (!existing_entry && analysis.summary) {
            await db.insert(entriesTable).values({
              projectId: matchedProject.id,
              title: `Repo scan: ${analysis.projectName ?? repo}`,
              summary: analysis.summary,
              status: "committed",
              severity: "general",
              mode: "think",
            }).catch(() => { /* non-blocking */ });
          }
        }
      } catch (memErr) {
        // Non-blocking — never fail the analyze response because of memory write
        console.warn("github/analyze: failed to write project memory", memErr);
      }
    }

    res.json(response);
  } catch {
    res.status(500).json({ error: "Failed to parse AI response", raw });
  }
});

// POST /api/github/full-import — deep analysis: seeds project memory (v2 tiers) + ledger decisions
router.post("/github/full-import", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { projectId, repo: bodyRepo, branch: bodyBranch } = req.body as {
    projectId: number;
    repo?: string;
    branch?: string;
  };
  if (!projectId || !Number.isFinite(projectId)) {
    res.status(400).json({ error: "Missing projectId" }); return;
  }

  // 1. Load project + verify ownership
  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      linkedRepo: projectsTable.linkedRepo,
      memory: projectsTable.memory,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // 2. Resolve repo + branch
  let repo = bodyRepo;
  let branch = bodyBranch ?? "main";
  if (!repo && project.linkedRepo) {
    try {
      const lr = typeof project.linkedRepo === "string"
        ? JSON.parse(project.linkedRepo) as { fullName?: string; defaultBranch?: string }
        : project.linkedRepo as { fullName?: string; defaultBranch?: string };
      repo = lr.fullName;
      branch = bodyBranch ?? lr.defaultBranch ?? "main";
    } catch { /* fall through — repo stays undefined */ }
  }
  if (!repo) { res.status(400).json({ error: "No GitHub repo linked to this project" }); return; }

  // 3. Resolve token
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  // 4. Fetch file tree
  let blobPaths: string[] = [];
  let actualBranch = branch;
  for (const b of [branch, branch === "main" ? "master" : "main"]) {
    const r = await fetch(`${GH_API}/repos/${repo}/git/trees/${b}?recursive=1`, { headers: ghHeaders(token) });
    if (r.ok) {
      const data = await r.json() as any;
      blobPaths = (data.tree as any[]).filter(n => n.type === "blob").map(n => n.path as string);
      actualBranch = b;
      break;
    }
  }
  if (blobPaths.length === 0) { res.status(404).json({ error: "Could not read repo tree — check token and repo name" }); return; }

  // 5. Select up to 15 key files — broader than the quick analyze scan
  const deepCandidates = [
    "README.md", "readme.md", "README.mdx",
    "ARCHITECTURE.md", "CONTRIBUTING.md",
    "package.json",
    "src/App.tsx", "src/App.jsx", "App.tsx",
    "src/main.tsx", "src/index.tsx",
    "src/router.tsx", "src/routes.tsx", "src/routes/index.tsx",
    "supabase/schema.sql",
  ];

  // Add docs directory files
  const docFiles = blobPaths.filter(p => /^docs?\//i.test(p) && /\.(md|txt)$/.test(p)).slice(0, 3);
  deepCandidates.push(...docFiles);

  // Add migration / schema files
  const migFiles = blobPaths.filter(p =>
    (p.startsWith("supabase/migrations/") || p.startsWith("prisma/migrations/") || p === "prisma/schema.prisma" || p === "drizzle/schema.ts")
    && (p.endsWith(".sql") || p.endsWith(".ts"))
  ).slice(0, 2);
  deepCandidates.push(...migFiles);

  // Add main backend entry point
  const backendEntry = blobPaths.find(p =>
    /^(src\/|server\/|api\/)?(index|server|app)\.(ts|js)$/.test(p)
  );
  if (backendEntry) deepCandidates.push(backendEntry);

  // Add a routes index or main routes file
  const routesFile = blobPaths.find(p =>
    /routes?\/(index\.(ts|js)|_index\.(ts|js)|routes\.(ts|js))$/.test(p)
    || p === "src/routes.ts"
  );
  if (routesFile) deepCandidates.push(routesFile);

  const toFetch = deepCandidates.filter(p => blobPaths.includes(p)).slice(0, 15);

  // 6. Fetch file contents in parallel (300 lines max each)
  const fileResults = await Promise.all(
    toFetch.map(async (path) => {
      try {
        const r = await fetch(`${GH_API}/repos/${repo}/contents/${path}?ref=${actualBranch}`, { headers: ghHeaders(token) });
        if (!r.ok) return null;
        const data = await r.json() as any;
        if (data.encoding !== "base64") return null;
        const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
        const lines = content.split("\n");
        return { path, content: lines.slice(0, 300).join("\n"), truncated: lines.length > 300 };
      } catch { return null; }
    })
  );
  const validFiles = fileResults.filter(Boolean) as { path: string; content: string; truncated: boolean }[];

  // 7. Build directory summary
  const dirCounts: Record<string, number> = {};
  for (const p of blobPaths) {
    const parts = p.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, Math.min(2, parts.length - 1)).join("/");
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
    }
  }
  const treeSummary = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([d, c]) => `${d}/ (${c} files)`).join("\n");

  const fileBlock = validFiles
    .map(f => `=== ${f.path}${f.truncated ? " [truncated at 300 lines]" : ""} ===\n${f.content}`)
    .join("\n\n");

  // 8. Deep Claude prompt — extract identity, decisions, open questions
  const importPrompt = `You are doing a deep architectural import of a software project from its GitHub repository.
Your goal is to extract durable facts that a strategic AI partner (Atlas) needs to know permanently — especially locked architectural decisions already made.

Return ONLY a valid JSON object — no markdown fences, no explanation — with exactly this shape:
{
  "identity": {
    "name": "project name from package.json or README",
    "description": "one clear sentence: what this product does for users",
    "stage": "idea | shaping | in-progress | live — based on code completeness",
    "targetUser": "who this is built for (one phrase, or null if unclear)",
    "coreProblem": "what problem it solves (one sentence, or null if unclear)"
  },
  "decisions": [
    {
      "title": "Short verb-noun title, e.g. 'Use Supabase for auth and database'",
      "rationale": "Why this was chosen or what evidence in the code confirms this is locked in",
      "severity": "structure | logic | aesthetic | general"
    }
  ],
  "stack": ["specific technologies found, e.g. React, TypeScript, Tailwind CSS, Supabase, Vite, Express"],
  "openQuestions": ["unresolved things visible in the code — TODOs, placeholder text, commented-out features — max 5"],
  "routes": ["URL paths found in router config — max 20"],
  "tables": ["database table names from schema or .from() calls — max 20"],
  "relatedProjects": ["names of other products mentioned in README or config — max 5"],
  "summary": "3-4 sentences: what this is, what stage it is at, what the main decisions already made are, and what remains open"
}

Rules:
- decisions array: extract 4–10 real decisions. Each must be something genuinely locked in (chosen tech, architecture pattern, data model choice). Skip obvious/trivial ones.
- severity: "structure" = core architecture; "logic" = business logic / data flow; "aesthetic" = UI/UX; "general" = everything else
- If info is not found, use [] or null. Never invent.
- Be specific. "Use Supabase for postgres + auth" is better than "Use a database".

PROJECT: ${project.name}
REPO: ${repo} (${blobPaths.length} total files)

DIRECTORY TREE:
${treeSummary}

KEY FILE CONTENTS (${validFiles.length} files read):
${fileBlock}`;

  let raw = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: importPrompt }],
    });
    raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  } catch (e: any) {
    res.status(500).json({ error: "AI extraction failed", detail: e.message }); return;
  }

  // 9. Parse AI response
  let importData: {
    identity?: { name?: string; description?: string; stage?: string; targetUser?: string; coreProblem?: string };
    decisions?: Array<{ title: string; rationale: string; severity: string }>;
    stack?: string[];
    openQuestions?: string[];
    routes?: string[];
    tables?: string[];
    relatedProjects?: string[];
    summary?: string;
  };
  try {
    const cleaned = raw.replace(/^```json\s*/m, "").replace(/\s*```$/m, "").trim();
    importData = JSON.parse(cleaned);
  } catch {
    res.status(500).json({ error: "Failed to parse AI response", raw }); return;
  }

  const now = new Date().toISOString();
  const identity = importData.identity ?? {};
  const decisions = Array.isArray(importData.decisions) ? importData.decisions : [];
  const stack = Array.isArray(importData.stack) ? importData.stack : [];
  const routes = Array.isArray(importData.routes) ? importData.routes : [];
  const tables = Array.isArray(importData.tables) ? importData.tables : [];
  const openQuestions = Array.isArray(importData.openQuestions) ? importData.openQuestions : [];

  // 10. Build v2 memory store — write with proper tiers so Atlas scores them correctly
  type MemEntry = { tier: 1|2|3|4|5; text: string; createdAt: string; retrievalCount: number; lastRetrievedAt: string | null };

  const newEntries: MemEntry[] = [];

  // Tier 2 — project identity (180-day lifetime)
  if (identity.description) {
    newEntries.push({ tier: 2, text: `Project: ${identity.description}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (identity.targetUser) {
    newEntries.push({ tier: 2, text: `Target user: ${identity.targetUser}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (identity.coreProblem) {
    newEntries.push({ tier: 2, text: `Core problem: ${identity.coreProblem}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (identity.stage) {
    newEntries.push({ tier: 2, text: `Project stage: ${identity.stage}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }

  // Tier 1 — locked architectural decisions (no decay, protected, max score)
  for (const d of decisions) {
    newEntries.push({
      tier: 1,
      text: `Decision: ${d.title}. ${d.rationale}`,
      createdAt: now,
      retrievalCount: 0,
      lastRetrievedAt: null,
    });
  }

  // Tier 4 — contextual: stack, routes, tables (30-day lifetime)
  if (stack.length > 0) {
    newEntries.push({ tier: 4, text: `Tech stack: ${stack.join(", ")}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (routes.length > 0) {
    newEntries.push({ tier: 4, text: `Routes: ${routes.slice(0, 15).join(", ")}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (tables.length > 0) {
    newEntries.push({ tier: 4, text: `DB tables: ${tables.join(", ")}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }
  if (openQuestions.length > 0) {
    newEntries.push({ tier: 4, text: `Open questions: ${openQuestions.join(" | ")}`, createdAt: now, retrievalCount: 0, lastRetrievedAt: null });
  }

  // Tier 3 — episodic: record the import event itself
  newEntries.push({
    tier: 3,
    text: `Full repo import completed ${now.split("T")[0]}: ${validFiles.length} files read from ${repo}, ${decisions.length} decisions extracted, ${tables.length} tables identified.`,
    createdAt: now,
    retrievalCount: 0,
    lastRetrievedAt: null,
  });

  // Merge with existing memory — strip old scan/import entries, keep user-written memories
  let existingEntries: MemEntry[] = [];
  try {
    const parsed = project.memory ? JSON.parse(project.memory) as { v?: number; entries?: MemEntry[] } : null;
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) {
      // Keep entries that look user-authored (not auto-imports)
      existingEntries = parsed.entries.filter(e =>
        !e.text.startsWith("Decision: ") &&
        !e.text.startsWith("Project: ") &&
        !e.text.startsWith("Target user: ") &&
        !e.text.startsWith("Core problem: ") &&
        !e.text.startsWith("Project stage: ") &&
        !e.text.startsWith("Tech stack: ") &&
        !e.text.startsWith("Routes: ") &&
        !e.text.startsWith("DB tables: ") &&
        !e.text.startsWith("Open questions: ") &&
        !e.text.startsWith("Full repo import completed")
      );
    }
  } catch { /* start fresh */ }

  const newMemory = JSON.stringify({ v: 2, entries: [...newEntries, ...existingEntries] });

  // 11. Write memory + optionally update description in a single update
  const descriptionUpdate = (!project.description && identity.description)
    ? { memory: newMemory, description: identity.description }
    : { memory: newMemory };

  await db.update(projectsTable).set(descriptionUpdate).where(eq(projectsTable.id, projectId));

  // 12. Seed ledger entries for each extracted decision
  //     Only insert if we don't already have import-seeded entries (idempotent on re-import: replace them)
  const validSeverities = new Set(["structure", "logic", "aesthetic", "general"]);
  let ledgerEntriesCreated = 0;

  if (decisions.length > 0) {
    // Delete old auto-import ledger entries first (prevent duplicates on re-import)
    await db
      .delete(entriesTable)
      .where(and(
        eq(entriesTable.projectId, projectId),
        sql`${entriesTable.verb} = 'auto-import'`
      ));

    const ledgerRows = decisions.map(d => ({
      projectId,
      title: d.title,
      summary: d.rationale,
      status: "committed" as const,
      severity: validSeverities.has(d.severity) ? d.severity : "general",
      mode: "think" as const,
      verb: "auto-import",
    }));

    await db.insert(entriesTable).values(ledgerRows);
    ledgerEntriesCreated = ledgerRows.length;
  }

  res.json({
    ok: true,
    projectId,
    repo,
    filesRead: validFiles.length,
    totalFiles: blobPaths.length,
    identity,
    stack,
    decisions: decisions.map(d => d.title),
    openQuestions,
    tables,
    routes,
    ledgerEntriesCreated,
    summary: importData.summary ?? null,
  });
});

// GET /api/github/deployment — auto-detect live deployment URL from repo
router.get("/github/deployment", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const { repo } = req.query as { repo?: string };
  if (!repo) { res.status(400).json({ error: "Missing repo param" }); return; }

  const headers = ghHeaders(token);
  const results: Array<{ url: string; platform: string; confidence: "high" | "medium" }> = [];

  // 1. Check GitHub Pages
  try {
    const pagesResp = await fetch(`${GH_API}/repos/${repo}/pages`, { headers });
    if (pagesResp.ok) {
      const pages = await pagesResp.json() as any;
      if (pages.html_url) {
        results.push({ url: pages.html_url, platform: "GitHub Pages", confidence: "high" });
      }
    }
  } catch {}

  // 2. Fetch repo tree (shallow) to scan for config files
  let treePaths: string[] = [];
  try {
    const repoResp = await fetch(`${GH_API}/repos/${repo}`, { headers });
    if (repoResp.ok) {
      const repoData = await repoResp.json() as any;
      const branch = repoData.default_branch || "main";
      const treeResp = await fetch(`${GH_API}/repos/${repo}/git/trees/${branch}?recursive=1`, { headers });
      if (treeResp.ok) {
        const treeData = await treeResp.json() as any;
        treePaths = (treeData.tree || []).map((f: any) => f.path as string);
      }
    }
  } catch {}

  // 3. Check for Vercel config — try to read vercel.json or .vercel/project.json
  if (treePaths.includes("vercel.json") || treePaths.includes(".vercel/project.json")) {
    // Derive Vercel URL from repo name
    const repoName = repo.split("/")[1] || repo;
    const owner = repo.split("/")[0] || "";
    results.push({
      url: `https://${repoName}.vercel.app`,
      platform: "Vercel",
      confidence: "medium",
    });
    // Also try owner-prefixed
    results.push({
      url: `https://${repoName}-${owner.toLowerCase()}.vercel.app`,
      platform: "Vercel",
      confidence: "medium",
    });
  }

  // 4. Check for Netlify
  if (treePaths.includes("netlify.toml") || treePaths.some(p => p.includes(".netlify"))) {
    const repoName = repo.split("/")[1] || repo;
    results.push({
      url: `https://${repoName}.netlify.app`,
      platform: "Netlify",
      confidence: "medium",
    });
  }

  // 5. Check for Replit deployment (replit.nix or .replit)
  if (treePaths.includes(".replit") || treePaths.includes("replit.nix")) {
    results.push({
      url: `https://${(repo.split("/")[1] || repo).toLowerCase()}.replit.app`,
      platform: "Replit",
      confidence: "medium",
    });
  }

  // 6. Always provide common patterns as fallback suggestions
  const repoName = repo.split("/")[1] || repo;
  const suggestions = results.length === 0 ? [
    { url: `https://${repoName}.vercel.app`, platform: "Vercel", confidence: "medium" as const },
    { url: `https://${repoName}.netlify.app`, platform: "Netlify", confidence: "medium" as const },
  ] : results;

  res.json({ detected: results, suggestions });
});

// POST /api/github/auto-link — match all unlinked projects to GitHub repos by name
router.post("/github/auto-link", async (req, res): Promise<void> => {
  const token = await getToken(req);
  if (!token) { res.status(401).json({ error: "Missing x-github-token header" }); return; }

  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  // 1. Fetch all user's GitHub repos
  const reposResp = await fetch(`${GH_API}/user/repos?per_page=100&sort=pushed&type=owner`, { headers: ghHeaders(token) });
  if (!reposResp.ok) {
    res.status(reposResp.status).json({ error: "GitHub API error", detail: await reposResp.text() });
    return;
  }
  const repos = await reposResp.json() as any[];

  // 2. Get all user's projects
  const allProjects = await db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  // Ensure every project has the token (backfill missing ones)
  const tokenUpdates = allProjects
    .filter(p => !p.githubToken)
    .map(p => db.update(projectsTable).set({ githubToken: token }).where(eq(projectsTable.id, p.id)));
  await Promise.all(tokenUpdates);

  // 3. Match each unlinked project to a GitHub repo by name
  const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]/g, "");
  const unlinked = allProjects.filter(p => !p.linkedRepo);

  const linked: Array<{ projectId: number; projectName: string; repoFullName: string }> = [];
  const skipped: string[] = [];

  for (const project of unlinked) {
    const projectNorm = normalize(project.name);
    const match = repos.find((r: any) =>
      normalize(r.name) === projectNorm ||
      normalize(r.full_name.split("/")[1] ?? "") === projectNorm
    );

    if (match) {
      const linkedRepo = JSON.stringify({
        id: match.id, name: match.name, fullName: match.full_name,
        private: match.private, description: match.description,
        language: match.language, defaultBranch: match.default_branch,
        updatedAt: match.pushed_at, url: match.html_url,
      });
      await db.update(projectsTable)
        .set({ linkedRepo, githubToken: token })
        .where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, userId)));
      linked.push({ projectId: project.id, projectName: project.name, repoFullName: match.full_name });
    } else {
      skipped.push(project.name);
    }
  }

  res.json({ linked, skipped, tokenBackfilled: tokenUpdates.length });
});

// POST /api/github/bootstrap-repo — create a new repo + push React/Vite/Tailwind scaffold + link to project
router.post("/github/bootstrap-repo", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { projectId, projectName } = req.body as { projectId?: number; projectName?: string };
  if (!projectId || !projectName) { res.status(400).json({ error: "projectId and projectName are required" }); return; }

  const { getGithubTokenForUser, bootstrapGitHubRepo } = await import("../lib/githubBootstrap");
  const token = await getGithubTokenForUser(userId);
  if (!token) { res.status(401).json({ error: "No GitHub token found. Connect GitHub in your account settings." }); return; }

  const result = await bootstrapGitHubRepo({ token, projectId, projectName });
  if (!result.ok) { res.status(500).json({ error: result.error }); return; }

  res.json({ linkedRepo: result.linkedRepo, htmlUrl: result.htmlUrl, repoName: result.repoName });
});

// POST /api/github/apply-local — write proposed file(s) directly to workspace filesystem (triggers Vite HMR)
router.post("/github/apply-local", async (req, res): Promise<void> => {
  const { files } = req.body as { files?: Array<{ path: string; content: string }> };
  if (!files?.length) { res.status(400).json({ error: "Missing files" }); return; }

  const WORKSPACE_ROOT = "/home/runner/workspace";
  const applied: string[] = [];
  const needsBuild: boolean[] = [];

  for (const { path: filePath, content } of files) {
    const resolved = nodePath.resolve(WORKSPACE_ROOT, filePath);
    if (!resolved.startsWith(WORKSPACE_ROOT + "/")) {
      res.status(400).json({ error: `Disallowed path: ${filePath}` }); return;
    }
    await mkdir(nodePath.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    applied.push(filePath);
    needsBuild.push(filePath.startsWith("artifacts/api-server/"));
  }

  const requiresServerBuild = needsBuild.some(Boolean);
  res.json({ applied, requiresServerBuild });
});

// POST /api/github/typecheck — syntax-check a proposed file before pushing
router.post("/github/typecheck", async (req, res): Promise<void> => {
  const { content, path: filePath } = req.body as { content?: string; path?: string };
  if (!content || !filePath) { res.status(400).json({ error: "Missing content or path" }); return; }

  const ext = filePath.split(".").pop() ?? "tsx";
  const validExts = new Set(["ts", "tsx", "js", "jsx"]);
  if (!validExts.has(ext)) { res.json({ errors: [], clean: true, skipped: true }); return; }

  const tmpId = randomBytes(8).toString("hex");
  const tmpDir = `/tmp/atlas-tc-${tmpId}`;
  const tmpFile = `${tmpDir}/check.${ext}`;
  const tscPath = "/home/runner/workspace/node_modules/.bin/tsc";

  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tmpFile, content, "utf-8");

    const output = await new Promise<string>((resolve) => {
      const proc = spawn(tscPath, [
        tmpFile,
        "--noEmit",
        "--allowJs",
        "--skipLibCheck",
        "--noResolve",
        "--target", "ES2020",
        "--lib", "ES2020,DOM",
        "--jsx", "react-jsx",
        "--strict",
      ], { env: process.env });
      let buf = "";
      proc.stdout.on("data", (d: Buffer) => { buf += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { buf += d.toString(); });
      proc.on("close", () => resolve(buf));
    });

    const errors = output.split("\n")
      .filter(line => line.includes("): error TS"))
      .map(line => {
        const m = line.match(/\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)/);
        if (m) return { line: parseInt(m[1] ?? "0"), col: parseInt(m[2] ?? "0"), message: (m[3] ?? line).trim() };
        return null;
      })
      .filter((e): e is { line: number; col: number; message: string } => e !== null);

    res.json({ errors, clean: errors.length === 0 });
  } catch (e) {
    res.status(500).json({ error: "Typecheck failed", detail: String(e) });
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

export default router;
