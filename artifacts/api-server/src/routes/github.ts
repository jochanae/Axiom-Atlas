import { Router, type IRouter } from "express";

const router: IRouter = Router();

const GH_API = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Atlas-Dev-Env/1.0",
  };
}

// GET /api/github/repos — list authenticated user's repos
router.get("/github/repos", async (req, res): Promise<void> => {
  const token = req.headers["x-github-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing x-github-token header" });
    return;
  }

  const resp = await fetch(`${GH_API}/user/repos?per_page=100&sort=pushed&type=owner`, {
    headers: ghHeaders(token),
  });

  if (!resp.ok) {
    res.status(resp.status).json({ error: "GitHub API error", detail: await resp.text() });
    return;
  }

  const repos = await resp.json() as any[];
  res.json(repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    language: r.language,
    defaultBranch: r.default_branch,
    updatedAt: r.pushed_at,
    url: r.html_url,
  })));
});

// GET /api/github/tree?repo=owner/name&branch=main — file tree
router.get("/github/tree", async (req, res): Promise<void> => {
  const token = req.headers["x-github-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing x-github-token header" });
    return;
  }

  const { repo, branch = "main" } = req.query as { repo?: string; branch?: string };
  if (!repo) {
    res.status(400).json({ error: "Missing repo param (format: owner/name)" });
    return;
  }

  const resp = await fetch(
    `${GH_API}/repos/${repo}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders(token) }
  );

  if (!resp.ok) {
    // try master branch as fallback
    if (branch === "main") {
      const fallback = await fetch(
        `${GH_API}/repos/${repo}/git/trees/master?recursive=1`,
        { headers: ghHeaders(token) }
      );
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

// GET /api/github/file?repo=owner/name&path=src/App.tsx&branch=main — file contents
router.get("/github/file", async (req, res): Promise<void> => {
  const token = req.headers["x-github-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing x-github-token header" });
    return;
  }

  const { repo, path: filePath, branch = "main" } = req.query as {
    repo?: string;
    path?: string;
    branch?: string;
  };

  if (!repo || !filePath) {
    res.status(400).json({ error: "Missing repo or path param" });
    return;
  }

  const resp = await fetch(
    `${GH_API}/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: ghHeaders(token) }
  );

  if (!resp.ok) {
    res.status(resp.status).json({ error: "GitHub API error", detail: await resp.text() });
    return;
  }

  const data = await resp.json() as any;

  if (data.encoding === "base64") {
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    const lines = content.split("\n").length;
    // Limit to 800 lines for AI context
    const truncated = lines > 800;
    const sliced = truncated ? content.split("\n").slice(0, 800).join("\n") : content;
    res.json({
      path: data.path,
      content: sliced,
      size: data.size,
      sha: data.sha,
      truncated,
      lines,
    });
  } else {
    res.status(422).json({ error: "File encoding not supported", encoding: data.encoding });
  }
});

export default router;
