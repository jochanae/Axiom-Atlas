import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { atlasIncidentsTable, connectionsTable, db, projectsTable } from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { randomBytes } from "crypto";
import * as nodePath from "path";
import { decryptToken } from "../lib/tokenCrypto";

const router: IRouter = Router();

const GH_API = "https://api.github.com";
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

async function getAnyProjectGithubToken(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;
  // Fall back to any project token for this user — used when no specific project context
  const projects = await db
    .select({ githubToken: projectsTable.githubToken })
    .from(projectsTable)
    .where(and(eq(projectsTable.userId, userId), isNotNull(projectsTable.githubToken)))
    .orderBy(desc(projectsTable.updatedAt))
    .limit(1);
  return resolveStoredGithubToken(projects[0]?.githubToken);
}

async function resolveGithubTokenForRequest(
  userId: number | undefined,
  projectGithubToken: string | null | undefined
): Promise<string | null> {
  const accountToken = await getAccountGithubToken(userId);
  if (accountToken) return accountToken;

  const projectToken = resolveStoredGithubToken(projectGithubToken);
  if (projectToken) return projectToken;

  // Last resort: look up any project token stored for this user
  const anyProjectToken = await getAnyProjectGithubToken(userId);
  return anyProjectToken ?? process.env.GITHUB_TOKEN ?? null;
}

/** Resolve token: use the header value unless it's the sentinel "__server__", then fall back to env var. */
function getToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const h = (req.headers["x-github-token"] as string | undefined ?? "").trim();
  if (h && h !== "__server__" && h !== "__account__") return h;
  return process.env.GITHUB_TOKEN ?? null;
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

// GET /api/github/repos
router.get("/github/repos", async (req, res): Promise<void> => {
  const token = (() => {
    const h = (req.headers["x-github-token"] as string | undefined ?? "").trim();
    return (h && h !== "__server__" && h !== "__account__") ? h : null;
  })();

  if (!token) {
    res.status(401).json({
      error: "TOKEN_REQUIRED",
      message: "Enter your GitHub personal access token to browse your repositories.",
    });
    return;
  }

  const resp = await fetch(`${GH_API}/user/repos?per_page=100&sort=pushed&type=all`, { headers: ghHeaders(token) });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403 || resp.status === 422) {
      res.status(401).json({
        code: "TOKEN_INVALID",
        message: "GitHub token is invalid or missing required scopes.",
      });
      return;
    }

    const detail = await resp.text();
    // Return a clear code so the frontend can show a helpful message
    res.status(resp.status).json({ error: "GITHUB_ERROR", message: "GitHub rejected this token. Make sure it has repo scope.", detail });
    return;
  }

  const repos = await resp.json() as any[];
  res.json(repos.map(r => ({
    id: r.id, name: r.name, fullName: r.full_name, private: r.private,
    description: r.description, language: r.language,
    defaultBranch: r.default_branch, updatedAt: r.pushed_at, url: r.html_url,
  })));
});

// GET /api/github/tree
router.get("/github/tree", async (req, res): Promise<void> => {
  const token = getToken(req);
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
  const token = getToken(req);
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
  const token = getToken(req);
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
  const token = getToken(req);
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
  const token = getToken(req);
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
  const token = getToken(req);
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
    const analysis = JSON.parse(cleaned);
    res.json({
      ...analysis,
      scannedAt: new Date().toISOString(),
      repo,
      branch: actualBranch,
      totalFiles: blobPaths.length,
    });
  } catch {
    res.status(500).json({ error: "Failed to parse AI response", raw });
  }
});

// GET /api/github/deployment — auto-detect live deployment URL from repo
router.get("/github/deployment", async (req, res): Promise<void> => {
  const token = getToken(req);
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
  const token = getToken(req);
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

// POST /api/github/revert — create a revert commit that undoes a given SHA
router.post("/github/revert", async (req, res): Promise<void> => {
  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { projectId, sha, branch = "main", message: customMessage } = req.body as {
    projectId?: unknown;
    sha?: string;
    branch?: string;
    message?: string;
  };

  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) {
    res.status(400).json({ error: "Missing or invalid projectId" }); return;
  }
  if (!sha?.trim()) {
    res.status(400).json({ error: "Missing sha" }); return;
  }
  const shortSha = sha.slice(0, 7);

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, parsedProjectId), eq(projectsTable.userId, userId)))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const repo = parseLinkedRepo(project.linkedRepo ?? null);
  if (!repo) { res.status(400).json({ error: "No GitHub repo linked to this project" }); return; }

  const token = await resolveGithubTokenForRequest(userId, project.githubToken ?? null);
  if (!token) { res.status(400).json({ error: "No GitHub token available for this project" }); return; }

  try {
    // 1. Fetch the commit to revert — need its parent's tree
    const commitResp = await fetch(`${GH_API}/repos/${repo.fullName}/commits/${sha}`, {
      headers: ghHeaders(token),
    });
    if (!commitResp.ok) {
      res.status(commitResp.status).json({ error: "Commit not found", detail: await commitResp.text() }); return;
    }
    const commitData = await commitResp.json() as any;
    const parents: any[] = commitData.parents ?? [];
    if (parents.length === 0) {
      res.status(400).json({ error: "Cannot revert the initial commit — no parent exists" }); return;
    }
    const parentSha: string = parents[0].sha;

    // 2. Get the parent commit's tree SHA (the state we want to restore)
    const parentResp = await fetch(`${GH_API}/repos/${repo.fullName}/commits/${parentSha}`, {
      headers: ghHeaders(token),
    });
    if (!parentResp.ok) {
      res.status(parentResp.status).json({ error: "Failed to fetch parent commit", detail: await parentResp.text() }); return;
    }
    const parentData = await parentResp.json() as any;
    const parentTreeSha: string = parentData.commit.tree.sha;

    // 3. Get the current branch HEAD (becomes the parent of our new revert commit)
    const currentHead = await getBranchSha(token, repo.fullName, branch);

    // 4. Create a new git commit pointing to the parent's tree
    const revertMessage = customMessage ?? `revert: ${shortSha} via Atlas`;
    const newCommitResp = await fetch(`${GH_API}/repos/${repo.fullName}/git/commits`, {
      method: "POST",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: revertMessage,
        tree: parentTreeSha,
        parents: [currentHead],
      }),
    });
    if (!newCommitResp.ok) {
      res.status(newCommitResp.status).json({ error: "Failed to create revert commit", detail: await newCommitResp.text() }); return;
    }
    const newCommit = await newCommitResp.json() as any;
    const newCommitSha: string = newCommit.sha;

    // 5. Update the branch ref to point to the new revert commit
    const updateRefResp = await fetch(`${GH_API}/repos/${repo.fullName}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitSha, force: false }),
    });
    if (!updateRefResp.ok) {
      res.status(updateRefResp.status).json({ error: "Failed to update branch ref", detail: await updateRefResp.text() }); return;
    }

    // 6. Invalidate commits cache for this project
    commitsCache.delete(`${parsedProjectId}:${repo.fullName}`);

    res.json({
      success: true,
      revertedSha: sha,
      newSha: newCommitSha,
      message: revertMessage,
      commitUrl: `https://github.com/${repo.fullName}/commit/${newCommitSha}`,
      branch,
    });
  } catch (e: unknown) {
    if (e instanceof GitHubApiError) {
      res.status(e.status).json({ error: "GitHub API error", detail: e.detail }); return;
    }
    res.status(500).json({ error: "Revert failed", detail: String(e) });
  }
});

export default router;
