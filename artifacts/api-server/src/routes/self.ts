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

export default router;
