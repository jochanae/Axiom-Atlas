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

// POST /api/github/branch — create a new branch from a base branch
router.post("/github/branch", async (req, res): Promise<void> => {
  const token = req.headers["x-github-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing x-github-token header" });
    return;
  }

  const { repo, branch, baseBranch = "main" } = req.body as {
    repo: string;
    branch: string;
    baseBranch?: string;
  };

  if (!repo || !branch) {
    res.status(400).json({ error: "Missing repo or branch" });
    return;
  }

  // Try to get SHA of base branch (main → master fallback)
  let sha: string | undefined;
  for (const base of [baseBranch, baseBranch === "main" ? "master" : "main"]) {
    const refResp = await fetch(`${GH_API}/repos/${repo}/git/ref/heads/${base}`, {
      headers: ghHeaders(token),
    });
    if (refResp.ok) {
      const refData = await refResp.json() as any;
      sha = refData.object.sha;
      break;
    }
  }

  if (!sha) {
    res.status(404).json({ error: "Base branch not found" });
    return;
  }

  const createResp = await fetch(`${GH_API}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });

  if (!createResp.ok) {
    const errText = await createResp.text();
    if (errText.includes("already exists")) {
      res.json({ branch, sha, alreadyExists: true });
      return;
    }
    res.status(createResp.status).json({ error: "GitHub API error", detail: errText });
    return;
  }

  res.json({ branch, sha, alreadyExists: false });
});

// PUT /api/github/commit — create or update a file on a branch
router.put("/github/commit", async (req, res): Promise<void> => {
  const token = req.headers["x-github-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing x-github-token header" });
    return;
  }

  const { repo, branch, path: filePath, content, message } = req.body as {
    repo: string;
    branch: string;
    path: string;
    content: string;
    message: string;
  };

  if (!repo || !branch || !filePath || content === undefined || !message) {
    res.status(400).json({ error: "Missing required fields: repo, branch, path, content, message" });
    return;
  }

  // Get current file SHA (needed for updates, not required for new files)
  let currentSha: string | undefined;
  const existingResp = await fetch(
    `${GH_API}/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: ghHeaders(token) }
  );
  if (existingResp.ok) {
    const existingData = await existingResp.json() as any;
    currentSha = existingData.sha;
  }

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

  if (!putResp.ok) {
    res.status(putResp.status).json({ error: "GitHub API error", detail: await putResp.text() });
    return;
  }

  const putData = await putResp.json() as any;
  res.json({
    sha: putData.content?.sha,
    commitSha: putData.commit?.sha,
    commitUrl: putData.commit?.html_url,
    path: filePath,
    branch,
  });
});

export default router;
