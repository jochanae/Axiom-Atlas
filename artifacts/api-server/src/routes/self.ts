import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join, normalize, resolve, relative } from "path";

const WORKSPACE_ROOT = resolve("/home/runner/workspace");

const ALLOWED_PREFIXES = [
  "artifacts/atlas/src",
  "artifacts/api-server/src",
];

function safePath(p: string): string | null {
  if (!p || p.includes("\0")) return null;
  const full = resolve(join(WORKSPACE_ROOT, normalize(p)));
  if (!full.startsWith(WORKSPACE_ROOT + "/")) return null;
  const rel = relative(WORKSPACE_ROOT, full);
  if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return full;
  return null;
}

interface FileTree {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileTree[];
}

function buildTree(dir: string, relBase: string, depth = 0): FileTree[] {
  if (depth > 4) return [];
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith(".") && name !== "node_modules" && name !== "dist")
      .map((name) => {
        const full = join(dir, name);
        const rel = join(relBase, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          return { name, path: rel, type: "dir" as const, children: buildTree(full, rel, depth + 1) };
        }
        return { name, path: rel, type: "file" as const };
      });
  } catch {
    return [];
  }
}

// Track files written via self/apply since last push (resets on push or server restart)
const recentlyWritten = new Set<string>();

const router: IRouter = Router();

// GET /api/self/tree — list Atlas's own source tree
router.get("/self/tree", (_req, res) => {
  const tree = [
    {
      name: "atlas/src",
      path: "artifacts/atlas/src",
      type: "dir" as const,
      children: buildTree(join(WORKSPACE_ROOT, "artifacts/atlas/src"), "artifacts/atlas/src"),
    },
    {
      name: "api-server/src",
      path: "artifacts/api-server/src",
      type: "dir" as const,
      children: buildTree(join(WORKSPACE_ROOT, "artifacts/api-server/src"), "artifacts/api-server/src"),
    },
  ];
  res.json({ tree });
});

// GET /api/self/read?path=... — read a source file
router.get("/self/read", (req, res) => {
  const p = req.query["path"] as string | undefined;
  if (!p) {
    res.status(400).json({ error: "path query param required" });
    return;
  }
  const full = safePath(p);
  if (!full) {
    res.status(403).json({ error: "Path not allowed — only artifacts/atlas/src and artifacts/api-server/src are readable" });
    return;
  }
  try {
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n").length;
    res.json({ path: p, content, lines });
  } catch {
    res.status(404).json({ error: `File not found: ${p}` });
  }
});

// POST /api/self/apply — write a repaired source file
router.post("/self/apply", (req, res) => {
  const { path: p, content } = req.body as { path?: string; content?: string };
  if (!p || content === undefined) {
    res.status(400).json({ error: "path and content are required" });
    return;
  }
  const full = safePath(p);
  if (!full) {
    res.status(403).json({ error: "Path not allowed — only artifacts/atlas/src and artifacts/api-server/src are writable" });
    return;
  }
  try {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
    recentlyWritten.add(p);
    const isBackend = p.startsWith("artifacts/api-server/");
    res.json({
      ok: true,
      path: p,
      kind: isBackend ? "backend" : "frontend",
      message: isBackend
        ? "File written. Restart the API Server workflow to activate."
        : "File written. Vite HMR will reload momentarily.",
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/self/modified — list files written since last push
router.get("/self/modified", (_req, res) => {
  res.json({ files: Array.from(recentlyWritten) });
});

// POST /api/self/push — commit files to GitHub via API (no local git required)
router.post("/self/push", async (req, res) => {
  const {
    files,
    message = "feat: atlas self-update",
    repo,
    branch = "main",
  } = req.body as {
    files?: string[];
    message?: string;
    repo?: string;
    branch?: string;
  };

  const targetRepo = repo ?? process.env.SELF_REPO ?? "jochanae/Axiom-Atlas";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    res.status(500).json({ error: "GITHUB_TOKEN not configured on this server." });
    return;
  }

  const filesToPush = files && files.length > 0 ? files : Array.from(recentlyWritten);

  if (filesToPush.length === 0) {
    res.status(400).json({
      error: "No files to push. Either pass a files[] array or make edits via Atlas first.",
    });
    return;
  }

  const fileContents: { path: string; content: string }[] = [];
  for (const f of filesToPush) {
    const full = safePath(f);
    if (!full) {
      res.status(403).json({ error: `Path not allowed: ${f}` });
      return;
    }
    try {
      const content = readFileSync(full, "utf-8");
      fileContents.push({ path: f, content });
    } catch {
      res.status(404).json({ error: `File not found on server: ${f}` });
      return;
    }
  }

  try {
    const ghBase = `https://api.github.com/repos/${targetRepo}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // 1. Get current HEAD SHA for branch
    const refRes = await fetch(`${ghBase}/git/refs/heads/${branch}`, { headers });
    if (!refRes.ok) {
      const text = await refRes.text();
      res.status(502).json({ error: `GitHub: could not get branch ref — ${text}` });
      return;
    }
    const refData = (await refRes.json()) as { object: { sha: string } };
    const headSha = refData.object.sha;

    // 2. Get tree SHA from that commit
    const commitRes = await fetch(`${ghBase}/git/commits/${headSha}`, { headers });
    if (!commitRes.ok) {
      const text = await commitRes.text();
      res.status(502).json({ error: `GitHub: could not get commit — ${text}` });
      return;
    }
    const commitData = (await commitRes.json()) as { tree: { sha: string } };
    const treeSha = commitData.tree.sha;

    // 3. Create blobs for each file
    const blobEntries: { path: string; sha: string }[] = [];
    for (const { path: filePath, content } of fileContents) {
      const blobRes = await fetch(`${ghBase}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      if (!blobRes.ok) {
        const text = await blobRes.text();
        res.status(502).json({ error: `GitHub: blob creation failed for ${filePath} — ${text}` });
        return;
      }
      const blobData = (await blobRes.json()) as { sha: string };
      blobEntries.push({ path: filePath, sha: blobData.sha });
    }

    // 4. Create new tree on top of existing tree
    const newTreeRes = await fetch(`${ghBase}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: treeSha,
        tree: blobEntries.map(({ path: filePath, sha }) => ({
          path: filePath,
          mode: "100644",
          type: "blob",
          sha,
        })),
      }),
    });
    if (!newTreeRes.ok) {
      const text = await newTreeRes.text();
      res.status(502).json({ error: `GitHub: tree creation failed — ${text}` });
      return;
    }
    const newTreeData = (await newTreeRes.json()) as { sha: string };

    // 5. Create the commit
    const newCommitRes = await fetch(`${ghBase}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: newTreeData.sha,
        parents: [headSha],
        author: {
          name: "Atlas",
          email: "atlas@axiomsystem.app",
          date: new Date().toISOString(),
        },
      }),
    });
    if (!newCommitRes.ok) {
      const text = await newCommitRes.text();
      res.status(502).json({ error: `GitHub: commit creation failed — ${text}` });
      return;
    }
    const newCommitData = (await newCommitRes.json()) as { sha: string };

    // 6. Update the branch ref to point to new commit
    const updateRes = await fetch(`${ghBase}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: newCommitData.sha, force: false }),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text();
      res.status(502).json({ error: `GitHub: branch update failed — ${text}` });
      return;
    }

    recentlyWritten.clear();

    res.json({
      ok: true,
      commit: newCommitData.sha,
      shortSha: newCommitData.sha.slice(0, 7),
      filesCommitted: filesToPush.length,
      files: filesToPush,
      message,
      repo: targetRepo,
      branch,
      url: `https://github.com/${targetRepo}/commit/${newCommitData.sha}`,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
