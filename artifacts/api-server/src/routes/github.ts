import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { atlasIncidentsTable, db, projectsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { randomBytes } from "crypto";
import * as nodePath from "path";

const router: IRouter = Router();

const GH_API = "https://api.github.com";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Atlas-Dev-Env/1.0",
  };
}

/** Resolve token: use the header value unless it's the sentinel "__server__", then fall back to env var. */
function getToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const h = (req.headers["x-github-token"] as string | undefined ?? "").trim();
  if (h && h !== "__server__") return h;
  return process.env.GITHUB_TOKEN ?? null;
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

// GET /api/github/server-token — tells the client whether a server-side token is configured
router.get("/github/server-token", (_req, res): void => {
  res.json({ available: !!process.env.GITHUB_TOKEN });
});

// GET /api/github/repos
router.get("/github/repos", async (req, res): Promise<void> => {
  const token = getToken(req);
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

  const { repo, branch = "main", path: filePath, content, message, forceDirect = false, projectId, project_id } = req.body as {
    repo: string; branch?: string; path?: string; content?: string; message: string; forceDirect?: boolean; projectId?: string; project_id?: string;
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

export default router;
