import { Router, type Request, type Response, type IRouter } from "express";
import fsNode from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { execFile, spawn } from "child_process";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import {
  projectWorkspaceDir,
  ensureProjectWorkspaceDir,
  resolveWorkspacePath,
  assertProjectOwner,
} from "../lib/projectWorkspace";
import {
  resolveGithubTokenForRequest,
  parseLinkedRepo,
  buildCloneUrl,
  redactToken,
} from "../lib/terminalSandbox";

const router: IRouter = Router();

const MAX_FILE_BYTES = 512_000; // 500 KB

function queryString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

const EXCLUDED_NAMES = new Set([
  "node_modules", ".git", "dist", ".next", "__pycache__",
  ".cache", "coverage", ".turbo", "build", ".svelte-kit",
  ".vercel", ".output", "out",
]);

function parseProjectId(value: unknown): number | null {
  const s = Array.isArray(value) ? value[0] : value;
  const id = Number(s);
  return Number.isInteger(id) && id > 0 ? id : null;
}

interface FsNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FsNode[];
}

async function buildTree(absDir: string, relBase: string, depth = 0): Promise<FsNode[]> {
  if (depth > 6) return [];
  let entries: fsNode.Dirent[];
  try {
    entries = await fsPromises.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: FsNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const nodePath = relBase ? `${relBase}/${entry.name}` : entry.name;
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: nodePath,
        type: "dir",
        children: await buildTree(absPath, nodePath, depth + 1),
      });
    } else if (entry.isFile()) {
      let size = 0;
      try {
        const stat = await fsPromises.stat(absPath);
        size = stat.size;
      } catch { /* skip */ }
      nodes.push({ name: entry.name, path: nodePath, type: "file", size });
    }
  }
  return nodes;
}

function looksLikeBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

// GET /api/fs/:projectId/tree
router.get("/fs/:projectId/tree", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = await ensureProjectWorkspaceDir(projectId);
    const children = await buildTree(workspaceDir, "", 0);
    res.json({
      name: "",
      path: "",
      type: "dir",
      workspaceDir,
      children,
    });
  } catch (err) {
    req.log?.error({ err }, "fs tree error");
    res.status(500).json({ error: "Failed to read file tree" });
  }
});

// GET /api/fs/:projectId/file?path=...
router.get("/fs/:projectId/file", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const userPath = queryString(req.query.path);
    if (!userPath) { res.status(400).json({ error: "Missing path" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);
    let absPath: string;
    try {
      absPath = resolveWorkspacePath(workspaceDir, userPath);
    } catch {
      res.status(400).json({ error: "Invalid path" }); return;
    }

    let stat: fsNode.Stats;
    try {
      stat = await fsPromises.stat(absPath);
    } catch {
      res.status(404).json({ error: "File not found" }); return;
    }

    if (!stat.isFile()) { res.status(400).json({ error: "Not a file" }); return; }
    if (stat.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: `File too large to open in editor (${Math.round(stat.size / 1024)} KB — max 500 KB)` });
      return;
    }

    const buf = await fsPromises.readFile(absPath);
    if (looksLikeBinary(buf)) {
      res.status(415).json({ error: "Binary file — cannot open in text editor" }); return;
    }

    res.json({ path: userPath, content: buf.toString("utf-8"), size: stat.size });
  } catch (err) {
    req.log?.error({ err }, "fs file read error");
    res.status(500).json({ error: "Failed to read file" });
  }
});

// POST /api/fs/:projectId/file  { path, content }
router.post("/fs/:projectId/file", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const { path: userPath, content } = req.body as { path?: string; content?: string };
    if (!userPath) { res.status(400).json({ error: "Missing path" }); return; }
    if (typeof content !== "string") { res.status(400).json({ error: "Missing content" }); return; }

    const byteLen = Buffer.byteLength(content, "utf-8");
    if (byteLen > MAX_FILE_BYTES) {
      res.status(413).json({ error: "Content too large (max 500 KB)" }); return;
    }

    const workspaceDir = await ensureProjectWorkspaceDir(projectId);
    let absPath: string;
    try {
      absPath = resolveWorkspacePath(workspaceDir, userPath);
    } catch {
      res.status(400).json({ error: "Invalid path" }); return;
    }

    await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
    await fsPromises.writeFile(absPath, content, "utf-8");
    res.json({ ok: true, path: userPath });
  } catch (err) {
    req.log?.error({ err }, "fs file write error");
    res.status(500).json({ error: "Failed to write file" });
  }
});

// DELETE /api/fs/:projectId/file?path=...
router.delete("/fs/:projectId/file", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const userPath = queryString(req.query.path);
    if (!userPath) { res.status(400).json({ error: "Missing path" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);
    let absPath: string;
    try {
      absPath = resolveWorkspacePath(workspaceDir, userPath);
    } catch {
      res.status(400).json({ error: "Invalid path" }); return;
    }

    await fsPromises.rm(absPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "fs file delete error");
    res.status(500).json({ error: "Failed to delete" });
  }
});

// POST /api/fs/:projectId/mkdir  { path }
router.post("/fs/:projectId/mkdir", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const { path: userPath } = req.body as { path?: string };
    if (!userPath) { res.status(400).json({ error: "Missing path" }); return; }

    const workspaceDir = await ensureProjectWorkspaceDir(projectId);
    let absPath: string;
    try {
      absPath = resolveWorkspacePath(workspaceDir, userPath);
    } catch {
      res.status(400).json({ error: "Invalid path" }); return;
    }

    await fsPromises.mkdir(absPath, { recursive: true });
    res.json({ ok: true, path: userPath });
  } catch (err) {
    req.log?.error({ err }, "fs mkdir error");
    res.status(500).json({ error: "Failed to create directory" });
  }
});

// POST /api/fs/:projectId/rename  { from, to }
router.post("/fs/:projectId/rename", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const { from: fromPath, to: toPath } = req.body as { from?: string; to?: string };
    if (!fromPath || !toPath) { res.status(400).json({ error: "Missing from/to" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);
    let absFrom: string, absTo: string;
    try {
      absFrom = resolveWorkspacePath(workspaceDir, fromPath);
      absTo = resolveWorkspacePath(workspaceDir, toPath);
    } catch {
      res.status(400).json({ error: "Invalid path" }); return;
    }

    await fsPromises.mkdir(path.dirname(absTo), { recursive: true });
    await fsPromises.rename(absFrom, absTo);
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "fs rename error");
    res.status(500).json({ error: "Failed to rename" });
  }
});

// GET /api/fs/:projectId/gitstatus
router.get("/fs/:projectId/gitstatus", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);

    const files = await new Promise<Record<string, string>>((resolve) => {
      execFile("git", ["status", "--porcelain", "-z"], { cwd: workspaceDir, maxBuffer: 512_000 }, (err, stdout) => {
        if (err) {
          // Not a git repo or git not available — return empty, not an error
          resolve({});
          return;
        }
        const result: Record<string, string> = {};
        // --porcelain -z: entries separated by NUL, each is "XY filename"
        const entries = stdout.split("\0").filter(Boolean);
        for (const entry of entries) {
          if (entry.length < 3) continue;
          const code = entry.slice(0, 2);
          // Handle renames: "XY from\0to" — with -z, rename uses two NUL-delimited fields
          // In -z mode each entry is "XY path" (no spaces in path, no rename second field here)
          const filePath = entry.slice(3);
          if (filePath) result[filePath] = code;
        }
        resolve(result);
      });
    });

    const hasRemote = await new Promise<boolean>((resolve) => {
      execFile("git", ["remote"], { cwd: workspaceDir, maxBuffer: 4096 }, (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(stdout.trim().length > 0);
      });
    });

    res.json({ files, hasRemote });
  } catch (err) {
    req.log?.error({ err }, "fs gitstatus error");
    res.status(500).json({ error: "Failed to get git status" });
  }
});

// POST /api/fs/:projectId/git/commit-push  { message }
router.post("/fs/:projectId/git/commit-push", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseProjectId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: "Missing commit message" }); return; }
  if (message.trim().length > 500) { res.status(400).json({ error: "Commit message too long (max 500 chars)" }); return; }

  const workspaceDir = projectWorkspaceDir(projectId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // Resolve GitHub token + push URL for authenticated push
  let githubToken: string | null = null;
  let pushUrl: string | null = null;
  try {
    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const repo = parseLinkedRepo(project?.linkedRepo ?? null);
    if (repo) {
      githubToken = await resolveGithubTokenForRequest(userId, project?.githubToken ?? null);
      pushUrl = buildCloneUrl(repo, githubToken);
    }
  } catch {
    // no linked repo or token — push will use whatever credentials git has configured
  }

  const runCmd = (args: string[], display: string): Promise<number> => {
    return new Promise((resolve) => {
      send("status", `$ git ${display}\n`);
      const proc = spawn("git", args, {
        cwd: workspaceDir,
        env: { ...process.env as Record<string, string>, GIT_TERMINAL_PROMPT: "0" },
        stdio: "pipe",
      });
      req.on("close", () => { try { proc.kill("SIGTERM"); } catch {} });
      proc.stdout.on("data", (chunk: Buffer) => {
        const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
        send("output", text);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
        send("output", text);
      });
      proc.on("error", (err) => { send("output", `error: ${err.message}\n`); resolve(1); });
      proc.on("close", (code) => resolve(code ?? 1));
    });
  };

  try {
    const addCode = await runCmd(["add", "-A"], "add -A");
    if (addCode !== 0) {
      send("done", JSON.stringify({ ok: false, error: "git add failed" }));
      res.end(); return;
    }

    const commitCode = await runCmd(["commit", "-m", message.trim()], `commit -m "${message.trim()}"`);
    if (commitCode !== 0) {
      send("done", JSON.stringify({ ok: false, error: "git commit failed — nothing to commit, or check output above" }));
      res.end(); return;
    }

    const pushArgs = pushUrl ? ["push", pushUrl] : ["push"];
    const pushDisplay = pushUrl ? `push <authenticated-url>` : "push";
    const pushCode = await runCmd(pushArgs, pushDisplay);
    const ok = pushCode === 0;
    send("done", JSON.stringify({ ok, error: ok ? null : "git push failed — check output above" }));
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Git operation failed";
    req.log?.error({ err }, "fs git commit-push error");
    send("error", msg);
    res.end();
  }
});

// POST /api/fs/:projectId/git/pull  (SSE streaming)
router.post("/fs/:projectId/git/pull", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseProjectId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

  const workspaceDir = projectWorkspaceDir(projectId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  let githubToken: string | null = null;
  let pullUrl: string | null = null;
  try {
    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const repo = parseLinkedRepo(project?.linkedRepo ?? null);
    if (repo) {
      githubToken = await resolveGithubTokenForRequest(userId, project?.githubToken ?? null);
      pullUrl = buildCloneUrl(repo, githubToken);
    }
  } catch {
    // fall through — pull without explicit URL
  }

  try {
    send("status", "$ git pull\n");
    const pullArgs = pullUrl ? ["pull", pullUrl] : ["pull"];
    const proc = spawn("git", pullArgs, {
      cwd: workspaceDir,
      env: { ...process.env as Record<string, string>, GIT_TERMINAL_PROMPT: "0" },
      stdio: "pipe",
    });
    req.on("close", () => { try { proc.kill("SIGTERM"); } catch {} });
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
      send("output", text);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
      send("output", text);
    });
    proc.on("error", (err) => {
      send("done", JSON.stringify({ ok: false, error: err.message }));
      res.end();
    });
    proc.on("close", (code) => {
      const ok = code === 0;
      send("done", JSON.stringify({ ok, error: ok ? null : "git pull failed — check output above" }));
      res.end();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pull failed";
    req.log?.error({ err }, "fs git pull error");
    send("error", msg);
    res.end();
  }
});

// GET /api/fs/:projectId/git/diff
router.get("/fs/:projectId/git/diff", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);

    const diff = await new Promise<string>((resolve) => {
      execFile("git", ["diff", "HEAD"], { cwd: workspaceDir, maxBuffer: 512_000 }, (err, stdout) => {
        if (err) { resolve(""); return; }
        resolve(stdout);
      });
    });

    res.json({ diff });
  } catch (err) {
    req.log?.error({ err }, "fs git diff error");
    res.status(500).json({ error: "Failed to get diff" });
  }
});

// GET /api/fs/:projectId/git/log
router.get("/fs/:projectId/git/log", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);

    const raw = await new Promise<string>((resolve) => {
      execFile(
        "git", ["log", "--format=%H\x1f%s\x1f%an\x1f%ai", "-20"],
        { cwd: workspaceDir, maxBuffer: 64_000 },
        (err, stdout) => { if (err) { resolve(""); return; } resolve(stdout); }
      );
    });

    interface Commit { hash: string; message: string; author: string; date: string }
    const commits: Commit[] = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash = "", message = "", author = "", date = ""] = line.split("\x1f");
        return { hash: hash.slice(0, 7), message, author, date: date.slice(0, 10) };
      });

    res.json({ commits });
  } catch (err) {
    req.log?.error({ err }, "fs git log error");
    res.status(500).json({ error: "Failed to get log" });
  }
});

// ---------------------------------------------------------------------------
// auditWorkspaceIntegrity — deterministic import-resolution check.
// Walks all .js/.jsx/.ts/.tsx files, extracts relative imports, verifies each
// target exists on disk. Returns the list of unresolved imports so callers can
// either block export or surface the list to Atlas for remediation.
// ---------------------------------------------------------------------------
const AUDIT_SCANNABLE = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const AUDIT_RESOLVE_SUFFIXES = [
  "", ".jsx", ".tsx", ".js", ".ts",
  "/index.jsx", "/index.tsx", "/index.js", "/index.ts",
];
// Matches: import X from './foo', import './foo', import type X from './foo'
const RELATIVE_IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*\bfrom\s+)?['"](\.[^'"]+)['"]/g;

interface UnresolvedImport {
  importedIn: string;
  importPath: string;
}

async function auditWorkspaceIntegrity(workspaceDir: string): Promise<{
  missing: UnresolvedImport[];
  checked: number;
}> {
  const missing: UnresolvedImport[] = [];
  let checked = 0;

  async function walkDir(absDir: string, relDir: string): Promise<void> {
    let entries: fsNode.Dirent[];
    try {
      entries = await fsPromises.readdir(absDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;

      const childAbs = path.join(absDir, entry.name);
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walkDir(childAbs, childRel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIT_SCANNABLE.has(ext)) continue;

        let content: string;
        try { content = await fsPromises.readFile(childAbs, "utf-8"); }
        catch { continue; }

        checked++;
        RELATIVE_IMPORT_RE.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = RELATIVE_IMPORT_RE.exec(content)) !== null) {
          const importPath = match[1];
          // Only check relative imports; skip bare specifiers and node_modules
          if (!importPath.startsWith(".")) continue;

          const resolvedBase = path.resolve(path.dirname(childAbs), importPath);
          let found = false;

          for (const suffix of AUDIT_RESOLVE_SUFFIXES) {
            try {
              await fsPromises.access(resolvedBase + suffix, fsNode.constants.F_OK);
              found = true;
              break;
            } catch { /* try next */ }
          }

          if (!found) {
            missing.push({ importedIn: childRel, importPath });
          }
        }
      }
    }
  }

  await walkDir(workspaceDir, "");
  return { missing, checked };
}

// GET /api/fs/:projectId/audit — standalone integrity check for the Builder lens.
// Returns { ok, checked, missing[] } so the client can surface specific missing
// filenames to Atlas after LOCAL_APPLY_SUCCESS instead of a generic "check everything" prompt.
router.get("/fs/:projectId/audit", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);
    try { await fsPromises.access(workspaceDir, fsNode.constants.F_OK); }
    catch { res.status(404).json({ error: "Workspace not found" }); return; }

    const { missing, checked } = await auditWorkspaceIntegrity(workspaceDir);
    res.json({ ok: missing.length === 0, checked, missing });
  } catch (err) {
    req.log?.error({ err }, "fs audit error");
    res.status(500).json({ error: "Audit failed" });
  }
});

// GET /api/fs/:projectId/zip — stream the workspace as a downloadable ZIP archive
router.get("/fs/:projectId/zip", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = projectWorkspaceDir(projectId);

    // Check workspace exists and has content
    let entries: string[];
    try {
      entries = await fsPromises.readdir(workspaceDir);
    } catch {
      res.status(404).json({ error: "Workspace not found" }); return;
    }
    if (entries.length === 0) {
      res.status(404).json({ error: "Workspace is empty" }); return;
    }

    // Integrity check — block export if any relative import cannot be resolved.
    // This is deterministic (filesystem-based), not LLM-based, so it cannot lie.
    const audit = await auditWorkspaceIntegrity(workspaceDir);
    if (audit.missing.length > 0) {
      const report = audit.missing
        .map((m) => `  ${m.importedIn} → ${m.importPath}`)
        .join("\n");
      res.status(422).json({
        error: "workspace_integrity_failure",
        message: `Cannot export: ${audit.missing.length} unresolved import${audit.missing.length === 1 ? "" : "s"} found. These files are referenced but missing from the workspace:\n${report}`,
        missing: audit.missing,
      });
      return;
    }

    // Fetch project name for the ZIP filename
    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const safeName = (project?.name ?? "workspace")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "workspace";

    // Dynamically import JSZip (CJS interop)
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    // Walk workspace recursively and add all non-excluded files
    async function addDir(absDir: string, zipPath: string) {
      let dirEntries: fsNode.Dirent[];
      try {
        dirEntries = await fsPromises.readdir(absDir, { withFileTypes: true });
      } catch { return; }

      for (const entry of dirEntries) {
        if (EXCLUDED_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") continue;

        const childAbs = path.join(absDir, entry.name);
        const childZip = zipPath ? `${zipPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await addDir(childAbs, childZip);
        } else if (entry.isFile()) {
          try {
            const stat = await fsPromises.stat(childAbs);
            if (stat.size > 5_000_000) continue; // skip files >5 MB
            const buf = await fsPromises.readFile(childAbs);
            zip.file(childZip, buf);
          } catch { /* skip unreadable files */ }
        }
      }
    }

    await addDir(workspaceDir, "");

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    req.log?.error({ err }, "fs zip error");
    res.status(500).json({ error: "Failed to create ZIP" });
  }
});

// POST /api/fs/:projectId/seed — write foundation files into an empty workspace
// No-ops if the workspace already has content. Never overwrites existing files.
router.post("/fs/:projectId/seed", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const workspaceDir = await ensureProjectWorkspaceDir(projectId);

    // Only seed if empty
    const existing = await fsPromises.readdir(workspaceDir);
    if (existing.length > 0) {
      res.json({ seeded: false, reason: "workspace not empty", files: [] });
      return;
    }

    // Fetch project name + description for personalised content
    const [project] = await db
      .select({ name: projectsTable.name, description: projectsTable.description })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    const projectName = project?.name ?? "Untitled Project";
    const projectDesc = project?.description ?? "";
    const today = new Date().toISOString().slice(0, 10);

    const files: Record<string, string> = {
      "README.md": [
        `# ${projectName}`,
        "",
        projectDesc ? `${projectDesc}\n` : "",
        "## Project Files",
        "",
        "- `PROJECT.md` — Product intent, users, scope, and constraints",
        "- `ATLAS.md` — What Atlas knows about this project",
        "- `MANIFEST.md` — Committed direction and system identity",
        "- `docs/decisions.md` — Decision record",
        "- `docs/roadmap.md` — Roadmap",
        "",
      ].join("\n"),

      "PROJECT.md": [
        "# Project Intent",
        "",
        "## What this is",
        projectDesc || projectName,
        "",
        "## Target users",
        "<!-- Who uses this and why. -->",
        "",
        "## Scope",
        "<!-- What is in scope. What is explicitly out of scope. -->",
        "",
        "## Constraints",
        "<!-- Technical, time, resource, or design constraints. -->",
        "",
      ].join("\n"),

      "ATLAS.md": [
        "# Atlas Knowledge",
        "",
        "_What Atlas understands about this project and how to work on it._",
        "",
        "## Context",
        `- Created: ${today}`,
        `- Project: ${projectName}`,
        "",
        "## How Atlas should work here",
        "- Prefer small, focused changes",
        "- Record decisions in `docs/decisions.md`",
        "- Keep `MANIFEST.md` updated as direction evolves",
        "",
        "## Known unknowns",
        "_Things Atlas does not yet know about this project._",
        "",
      ].join("\n"),

      "MANIFEST.md": [
        "# Manifest",
        "",
        `_The committed direction for ${projectName}._`,
        "",
        "## Identity",
        "<!-- What this project is and what it will become. -->",
        "",
        "## Committed scope",
        "<!-- The core things this project must do. -->",
        "",
        "## Non-negotiables",
        "<!-- Design, technical, or product constraints that cannot be compromised. -->",
        "",
        "## What this is not",
        "<!-- Explicit exclusions from scope. -->",
        "",
      ].join("\n"),

      "docs/decisions.md": [
        "# Decision Record",
        "",
        "_Significant decisions made during this project._",
        "",
        "| Date | Decision | Rationale | Alternatives Considered |",
        "|------|----------|-----------|------------------------|",
        "",
      ].join("\n"),

      "docs/roadmap.md": [
        "# Roadmap",
        "",
        "## Now",
        "<!-- What is being built right now. -->",
        "",
        "## Next",
        "<!-- What comes after. -->",
        "",
        "## Later",
        "<!-- Future possibilities. -->",
        "",
        "## Parked",
        "<!-- Ideas not being pursued yet. -->",
        "",
      ].join("\n"),
    };

    const seededFiles: string[] = [];
    for (const [filePath, content] of Object.entries(files)) {
      const absPath = resolveWorkspacePath(workspaceDir, filePath);
      await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
      // Skip if file already exists (safety net)
      try { await fsPromises.access(absPath); continue; } catch { /* does not exist — write it */ }
      await fsPromises.writeFile(absPath, content, "utf-8");
      seededFiles.push(filePath);
    }

    res.json({ seeded: true, files: seededFiles });
  } catch (err) {
    req.log?.error({ err }, "fs seed error");
    res.status(500).json({ error: "Failed to seed workspace" });
  }
});

// GET /api/fs/:projectId/hydration — workspace hydration status
router.get("/fs/:projectId/hydration", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).authUser.id as number;
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
    if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    const workspaceDir = projectWorkspaceDir(projectId);
    const repo = parseLinkedRepo(project?.linkedRepo ?? null);

    let isGitInitialized = false;
    let isEmpty = true;
    try {
      await fsPromises.access(path.join(workspaceDir, ".git"));
      isGitInitialized = true;
    } catch {}
    try {
      const entries = await fsPromises.readdir(workspaceDir);
      isEmpty = entries.length === 0;
    } catch {}

    res.json({
      linkedRepo: repo?.fullName ?? null,
      isEmpty,
      isGitInitialized,
    });
  } catch (err) {
    req.log?.error({ err }, "fs hydration status error");
    res.status(500).json({ error: "Failed to get hydration status" });
  }
});

// POST /api/fs/:projectId/git/clone  (SSE streaming)
// If the workspace already has a .git dir, falls back to git pull.
router.post("/fs/:projectId/git/clone", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).authUser.id as number;
  const projectId = parseProjectId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!await assertProjectOwner(projectId, userId)) { res.status(404).json({ error: "Project not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  let githubToken: string | null = null;
  let targetUrl: string | null = null;
  let repoName: string | null = null;

  try {
    const [project] = await db
      .select({ linkedRepo: projectsTable.linkedRepo, githubToken: projectsTable.githubToken })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const repo = parseLinkedRepo(project?.linkedRepo ?? null);
    if (!repo) {
      send("done", JSON.stringify({ ok: false, error: "No linked repository — link a GitHub repo first." }));
      res.end();
      return;
    }
    repoName = repo.fullName;
    githubToken = await resolveGithubTokenForRequest(userId, project?.githubToken ?? null);
    targetUrl = buildCloneUrl(repo, githubToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to resolve repo";
    send("done", JSON.stringify({ ok: false, error: msg }));
    res.end();
    return;
  }

  const workspaceDir = await ensureProjectWorkspaceDir(projectId);

  // Detect whether this is a first-time clone or a subsequent pull
  let isInitialized = false;
  try {
    await fsPromises.access(path.join(workspaceDir, ".git"));
    isInitialized = true;
  } catch {}

  try {
    let gitArgs: string[];
    let displayCmd: string;
    if (isInitialized) {
      gitArgs = ["pull", targetUrl];
      displayCmd = `git pull  # (workspace already cloned — pulling latest)\n`;
    } else {
      gitArgs = ["clone", targetUrl, "."];
      displayCmd = `git clone ${repoName}\n`;
    }

    send("status", `$ ${displayCmd}`);
    const proc = spawn("git", gitArgs, {
      cwd: workspaceDir,
      env: { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: "0" },
      stdio: "pipe",
    });

    req.on("close", () => { try { proc.kill("SIGTERM"); } catch {} });

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
      send("output", text);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = githubToken ? redactToken(chunk.toString(), githubToken) : chunk.toString();
      send("output", text);
    });
    proc.on("error", (err) => {
      send("done", JSON.stringify({ ok: false, error: err.message }));
      res.end();
    });
    proc.on("close", (code) => {
      const ok = code === 0;
      send("done", JSON.stringify({
        ok,
        error: ok ? null : `git ${isInitialized ? "pull" : "clone"} failed — check output above`,
      }));
      res.end();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Hydration failed";
    req.log?.error({ err }, "fs git clone error");
    send("error", msg);
    res.end();
  }
});

// ─── Checkpoint / Rollback ──────────────────────────────────────────────────
// POST /api/fs/:projectId/checkpoint — snapshot the current content of a set of
// files so the user can undo a subsequent apply. Stores the snapshot as a JSON
// file inside the project workspace under .atlas-checkpoints/.
// Body: { files: string[], messageId?: string }
// Returns: { checkpointId: string }

router.post("/:projectId/checkpoint", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { files, messageId } = req.body as { files?: string[]; messageId?: string };
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: "files must be a non-empty array of paths" }); return;
  }

  const isOwner = await assertProjectOwner(projectId, userId);
  if (!isOwner) { res.status(404).json({ error: "Project not found" }); return; }

  const wsDir = await ensureProjectWorkspaceDir(projectId);
  const checkpointDir = path.join(wsDir, ".atlas-checkpoints");
  await fsPromises.mkdir(checkpointDir, { recursive: true });

  const snapshotEntries: Array<{ path: string; content: string | null }> = [];
  for (const filePath of files) {
    let content: string | null = null;
    try {
      const abs = resolveWorkspacePath(wsDir, filePath);
      content = await fsPromises.readFile(abs, "utf-8");
    } catch { /* file doesn't exist yet — content null means "was absent" */ }
    snapshotEntries.push({ path: filePath, content });
  }

  const checkpointId = [Date.now(), Math.random().toString(36).slice(2, 8)].join("-");
  const cpFile = path.join(checkpointDir, `${checkpointId}.json`);
  await fsPromises.writeFile(cpFile, JSON.stringify({
    checkpointId,
    projectId,
    messageId: messageId ?? null,
    createdAt: new Date().toISOString(),
    files: snapshotEntries,
  }), "utf-8");

  res.json({ checkpointId });
});

// POST /api/fs/:projectId/rollback — restore files to a previously saved checkpoint.
// Body: { checkpointId: string }
// Returns: { restored: string[], deleted: string[] }

router.post("/:projectId/rollback", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const userId = (req as any).authUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { checkpointId } = req.body as { checkpointId?: string };
  if (!checkpointId || !/^[\d]+-[a-z0-9]+$/.test(checkpointId)) {
    res.status(400).json({ error: "Invalid checkpointId" }); return;
  }

  const isOwner = await assertProjectOwner(projectId, userId);
  if (!isOwner) { res.status(404).json({ error: "Project not found" }); return; }

  const wsDir = await ensureProjectWorkspaceDir(projectId);
  const cpFile = path.join(wsDir, ".atlas-checkpoints", `${checkpointId}.json`);

  let checkpoint: { projectId: number; files: Array<{ path: string; content: string | null }> };
  try {
    checkpoint = JSON.parse(await fsPromises.readFile(cpFile, "utf-8")) as typeof checkpoint;
  } catch {
    res.status(404).json({ error: "Checkpoint not found" }); return;
  }

  if (checkpoint.projectId !== projectId) {
    res.status(403).json({ error: "Checkpoint does not belong to this project" }); return;
  }

  const restored: string[] = [];
  const deleted: string[] = [];

  for (const entry of checkpoint.files) {
    const abs = resolveWorkspacePath(wsDir, entry.path);
    if (entry.content === null) {
      // File didn't exist before — delete the current version if it exists
      try { await fsPromises.unlink(abs); deleted.push(entry.path); } catch { /* already gone */ }
    } else {
      // Restore previous content
      await fsPromises.mkdir(path.dirname(abs), { recursive: true });
      await fsPromises.writeFile(abs, entry.content, "utf-8");
      restored.push(entry.path);
    }
  }

  res.json({ restored, deleted, checkpointId });
});

export default router;

