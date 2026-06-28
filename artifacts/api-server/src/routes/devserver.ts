import { Router } from "express";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, unlinkSync, readdirSync, createReadStream, statSync } from "fs";
import path from "path";
import { logger } from "../lib/logger";
import { projectWorkspaceDir } from "../lib/projectWorkspace";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logProjectArtifact } from "../lib/artifactLog";

// ── Build-check work dir (separate from live devserver) ───────────────────
const BUILD_CHECK_DIR = "/tmp/atlas-build-check";

export interface BuildCheckResult {
  clean: boolean;
  errors: string[];
  duration: number;
}

function parseErrors(output: string): string[] {
  const lines = output.split("\n");
  const errors: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/\x1B\[[0-9;]*m/g, "").trim();
    if (!clean) continue;
    // TypeScript errors
    if (/error TS\d+:/.test(clean)) { errors.push(clean); continue; }
    // Vite build errors
    if (/^\s*✗/.test(clean) || /^(ERROR|error)(\s|:)/.test(clean)) { errors.push(clean); continue; }
    // Rollup / esbuild module-not-found
    if (/Module not found|Failed to resolve import|Cannot find module/.test(clean)) { errors.push(clean); continue; }
    // React JSX transform errors
    if (/React is not defined|JSX/.test(clean) && /error/i.test(clean)) { errors.push(clean); continue; }
  }
  // Deduplicate, cap at 20
  return [...new Set(errors)].slice(0, 20);
}

// Extensions tried when resolving a bare relative import path (no extension given).
const RESOLVE_EXTENSIONS = [
  "", ".jsx", ".tsx", ".js", ".ts",
  "/index.jsx", "/index.tsx", "/index.js", "/index.ts",
];

// Directories we always skip when walking source files.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".cache", "coverage", ".vite"]);

/**
 * Walk all JS/JSX/TS/TSX source files in wsDir and check every relative
 * `import … from './…'` statement.  Returns a list of human-readable error
 * strings for any import that cannot be resolved to an existing file.
 *
 * This runs before `npm run build` so Atlas gets actionable errors immediately
 * rather than after a slow full compile.
 */
function auditMissingImports(wsDir: string): string[] {
  const missing: string[] = [];
  const SOURCE_RE = /\.(jsx?|tsx?)$/;
  const IMPORT_RE = /(?:^|\n)\s*import\s[^'"]*['"](\.[^'"]+)['"]/g;
  const DYN_IMPORT_RE = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;

  function walkFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(full));
        else if (SOURCE_RE.test(entry.name)) files.push(full);
      }
    } catch {}
    return files;
  }

  function tryResolve(fromDir: string, importPath: string): boolean {
    const base = path.resolve(fromDir, importPath);
    // If path already has an extension that matches a source file, check directly
    if (SOURCE_RE.test(importPath)) {
      return existsSync(base);
    }
    // Try all candidate extensions
    return RESOLVE_EXTENSIONS.some((ext) => existsSync(base + ext));
  }

  const files = walkFiles(wsDir);
  const seenErrors = new Set<string>();

  for (const file of files) {
    let src: string;
    try { src = readFileSync(file, "utf8"); } catch { continue; }

    const fromDir = path.dirname(file);
    const relFile = path.relative(wsDir, file);

    const allMatches = [
      ...[...src.matchAll(IMPORT_RE)].map((m) => m[1]),
      ...[...src.matchAll(DYN_IMPORT_RE)].map((m) => m[1]),
    ];

    for (const importPath of allMatches) {
      if (!importPath.startsWith(".")) continue; // skip bare module specifiers
      if (tryResolve(fromDir, importPath)) continue;

      const key = `${relFile}:${importPath}`;
      if (seenErrors.has(key)) continue;
      seenErrors.add(key);
      missing.push(`Could not resolve "${importPath}" from "${relFile}"`);
    }
  }

  return missing;
}

/**
 * Run `npm run build` directly inside an already-populated workspace directory.
 * No cloning or installing — the workspace already has source files and
 * node_modules from the initial scaffold.  Installs only if node_modules is
 * absent (first run after a fresh scaffold).
 * Safe to call from the chat route — non-mutating except for a possible install.
 */
export async function runWorkspaceBuildCheck(wsDir: string): Promise<BuildCheckResult> {
  const t0 = Date.now();
  const logs: string[] = [];

  function capture(cmd: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const out: string[] = [];
      const proc = spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "true" },
      });
      proc.stdout?.on("data", (d: Buffer) => { const s = d.toString(); out.push(s); logs.push(s); });
      proc.stderr?.on("data", (d: Buffer) => { const s = d.toString(); out.push(s); logs.push(s); });
      proc.on("exit", (code) => {
        const combined = out.join("");
        if (code === 0) resolve(combined);
        else reject(Object.assign(new Error(`${cmd} exited ${code}`), { output: combined }));
      });
      proc.on("error", reject);
    });
  }

  try {
    if (!existsSync(wsDir)) {
      return { clean: false, errors: ["Workspace directory not found"], duration: Date.now() - t0 };
    }
    const pkgPath = path.join(wsDir, "package.json");
    if (!existsSync(pkgPath)) {
      return { clean: false, errors: ["No package.json in workspace"], duration: Date.now() - t0 };
    }

    // ── Phase 1: static import audit (fast, no build needed) ──────────────────
    // Catch missing files before spending time on a full compile.
    const missingImports = auditMissingImports(wsDir);
    if (missingImports.length > 0) {
      return {
        clean: false,
        errors: missingImports.map((e) => `[MISSING FILE] ${e}`),
        duration: Date.now() - t0,
      };
    }

    // ── Phase 2: full build ────────────────────────────────────────────────────
    // Install deps if missing (first run)
    if (!existsSync(path.join(wsDir, "node_modules"))) {
      const mgr = detectPackageManager(wsDir);
      const installArgs = mgr === "pnpm"
        ? ["install", "--no-frozen-lockfile", "--ignore-workspace"]
        : ["install", "--legacy-peer-deps"];
      await capture(mgr, installArgs, wsDir).catch(() => {});
    }

    await capture("npm", ["run", "build"], wsDir);
    return { clean: true, errors: [], duration: Date.now() - t0 };
  } catch (err: unknown) {
    const output = (err as { output?: string }).output ?? logs.join("");
    const errors = parseErrors(output);
    return {
      clean: false,
      errors: errors.length ? errors : ["Build failed — no parseable errors captured"],
      duration: Date.now() - t0,
    };
  }
}

/**
 * Clone (or fast-update) a repo, install deps once, run `npm run build`,
 * and return whether it compiled cleanly.
 * Safe to call from the chat route — uses its own work dir, no shared state.
 */
export async function runBuildCheck(
  repoFullName: string,
  token: string,
): Promise<BuildCheckResult> {
  const t0 = Date.now();
  mkdirSync(BUILD_CHECK_DIR, { recursive: true });
  const repoName = repoFullName.split("/")[1];
  const repoDir = path.join(BUILD_CHECK_DIR, repoName);
  const logs: string[] = [];

  function capture(cmd: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const out: string[] = [];
      const proc = spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "true" },
      });
      proc.stdout?.on("data", (d: Buffer) => { const s = d.toString(); out.push(s); logs.push(s); });
      proc.stderr?.on("data", (d: Buffer) => { const s = d.toString(); out.push(s); logs.push(s); });
      proc.on("exit", (code) => {
        const combined = out.join("");
        if (code === 0) resolve(combined);
        else reject(Object.assign(new Error(`${cmd} exited ${code}`), { output: combined }));
      });
      proc.on("error", reject);
    });
  }

  try {
    if (existsSync(path.join(repoDir, ".git"))) {
      // Fast-path: just pull latest commit
      await capture("git", [
        "-C", repoDir,
        "fetch", "--depth=1",
        `https://x-access-token:${token}@github.com/${repoFullName}.git`,
        "main",
      ]);
      await capture("git", ["-C", repoDir, "reset", "--hard", "FETCH_HEAD"]);
    } else {
      // Fresh clone
      if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
      await capture("git", [
        "clone", "--depth=1", "--branch=main",
        `https://x-access-token:${token}@github.com/${repoFullName}.git`,
        repoDir,
      ]);
    }

    // Install only when node_modules is absent (cache across checks)
    if (!existsSync(path.join(repoDir, "node_modules"))) {
      await capture("npm", ["install", "--legacy-peer-deps"], repoDir);
    }

    // Run build — Vite + tsc both emit on this command for the scaffold
    const buildOut = await capture("npm", ["run", "build"], repoDir);
    return { clean: true, errors: [], duration: Date.now() - t0 };
  } catch (err: unknown) {
    const output = (err as { output?: string }).output ?? logs.join("");
    const errors = parseErrors(output);
    logger.warn({ repo: repoFullName, errorCount: errors.length }, "build-check: errors found");
    return { clean: false, errors: errors.length ? errors : ["Build failed — no parseable errors captured"], duration: Date.now() - t0 };
  }
}

type DevStatus = "idle" | "cloning" | "installing" | "starting" | "running" | "error";

const state: {
  status: DevStatus;
  port: number | null;
  proc: ChildProcess | null;
  repoFullName: string | null;
  logs: string[];
  errorMsg: string | null;
} = {
  status: "idle",
  port: null,
  proc: null,
  repoFullName: null,
  logs: [],
  errorMsg: null,
};

const WORK_DIR = "/tmp/atlas-devserver";

// ── Per-workspace devserver state (one per projectId) ──────────────────────
interface WsDevState {
  status: DevStatus;
  port: number | null;
  proc: ChildProcess | null;
  logs: string[];
  errorMsg: string | null;
}

const wsStates = new Map<number, WsDevState>();

// Persist port so API server restarts don't lose track of running Vite servers.
// Files live at /tmp/atlas-ws-{projectId}.json  →  { port, pid? }
const WS_PERSIST_DIR = "/tmp";
function wsPersistPath(projectId: number) { return path.join(WS_PERSIST_DIR, `atlas-ws-${projectId}.json`); }

function wsSaveState(projectId: number, port: number, pid?: number) {
  try { writeFileSync(wsPersistPath(projectId), JSON.stringify({ port, pid })); } catch {}
}
function wsDeleteState(projectId: number) {
  try { unlinkSync(wsPersistPath(projectId)); } catch {}
}

// On module load: probe any persisted ports and re-adopt still-running servers.
// This runs once when the API server starts so a rebuild doesn't lose the "Running" badge.
(async () => {
  const files = readdirSync(WS_PERSIST_DIR).filter(f => /^atlas-ws-\d+\.json$/.test(f));
  for (const f of files) {
    try {
      const projectId = Number(f.replace("atlas-ws-", "").replace(".json", ""));
      const { port, pid } = JSON.parse(readFileSync(path.join(WS_PERSIST_DIR, f), "utf8")) as { port: number; pid?: number };
      // Quick TCP probe — if something is listening on that port, re-adopt it.
      const alive = await new Promise<boolean>((resolve) => {
        const req = http.request({ hostname: "localhost", port, path: "/", method: "HEAD", timeout: 800 }, () => { req.destroy(); resolve(true); });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
        req.end();
      });
      if (alive) {
        const st = getWsState(projectId);
        st.port = port; st.status = "running";
        st.logs = [`[re-adopted] Dev server already running on port ${port}${pid ? ` (pid ${pid})` : ""}`];
        logger.info({ projectId, port }, "Re-adopted workspace dev server after API restart");
      } else {
        wsDeleteState(projectId);
      }
    } catch {}
  }
})();

function getWsState(projectId: number): WsDevState {
  if (!wsStates.has(projectId)) {
    wsStates.set(projectId, { status: "idle", port: null, proc: null, logs: [], errorMsg: null });
  }
  return wsStates.get(projectId)!;
}

function addWsLog(st: WsDevState, line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;
  st.logs.push(trimmed);
  if (st.logs.length > 300) st.logs.shift();
}

// Find a free port in the workspace devserver range (5200-5299)
async function allocateFreePort(): Promise<number> {
  const usedPorts = new Set(
    [...wsStates.values()].map(s => s.port).filter((p): p is number => p !== null)
  );
  for (let p = 5200; p < 5300; p++) {
    if (usedPorts.has(p)) continue;
    const isFree = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { hostname: "localhost", port: p, path: "/", method: "HEAD", timeout: 400 },
        () => resolve(false),
      );
      req.on("error", () => resolve(true));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (isFree) return p;
  }
  throw new Error("No free ports available in range 5200–5299");
}

function addLog(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;
  state.logs.push(trimmed);
  if (state.logs.length > 300) state.logs.shift();
}

function killProc() {
  if (state.proc) {
    try { state.proc.kill("SIGTERM"); } catch {}
    state.proc = null;
  }
}

// Port we must never proxy to — that's our own API server
const OWN_PORT = parseInt(process.env.PORT ?? "8080", 10);

function detectPort(line: string): number | null {
  const clean = line.replace(/\x1B\[[0-9;]*m/g, "");

  // Only consider lines that look like actual server-ready announcements
  const isReadyLine = /\b(local|network|ready|listening|running|started|available|serving|server)\b/i.test(clean);
  if (!isReadyLine) return null;

  const patterns = [
    /localhost:(\d{4,5})/i,
    /127\.0\.0\.1:(\d{4,5})/i,
    /http:\/\/[^:]+:(\d{4,5})/i,
    /\bport[:\s]+(\d{4,5})/i,
    /:(\d{4,5})\s*$/,
  ];
  for (const p of patterns) {
    const m = clean.match(p);
    if (m) {
      const port = parseInt(m[1], 10);
      if (port > 1024 && port < 65535 && port !== OWN_PORT) return port;
    }
  }
  return null;
}

// Poll common ports to find a running server (fallback when stdout doesn't announce the port)
function pollForPort(candidates: number[]): Promise<number | null> {
  return new Promise((resolve) => {
    let checked = 0;
    if (candidates.length === 0) { resolve(null); return; }
    for (const port of candidates) {
      const req = http.request({ hostname: "localhost", port, path: "/", method: "HEAD", timeout: 1500 }, () => {
        resolve(port);
      });
      req.on("error", () => {
        checked++;
        if (checked === candidates.length) resolve(null);
      });
      req.on("timeout", () => { req.destroy(); });
      req.end();
    }
  });
}

function detectDevCommand(repoDir: string, viteBase?: string): { cmd: string; args: string[]; useMgr: string } {
  const useMgr = detectPackageManager(repoDir);
  try {
    const pkgRaw = readFileSync(path.join(repoDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const isVite = !!allDeps["vite"] || (scripts["dev"] ?? "").includes("vite");
    const isNext = !!allDeps["next"] || (scripts["dev"] ?? "").includes("next");

    if (scripts["dev"]) {
      if (isVite && !isNext) {
        // Pass --host so Vite accepts proxied requests.
        // Note: we intentionally do NOT pass --base here. Apps use HashRouter
        // which ignores the URL path, so no base path configuration is needed.
        return { cmd: useMgr, args: ["run", "dev", "--", "--host", "0.0.0.0"], useMgr };
      }
      return { cmd: useMgr, args: ["run", "dev"], useMgr };
    }
    if (scripts["start"]) return { cmd: useMgr, args: ["start"], useMgr };
    if (scripts["serve"]) return { cmd: useMgr, args: ["run", "serve"], useMgr };
  } catch {}
  return { cmd: useMgr, args: ["run", "dev"], useMgr };
}

function detectPackageManager(repoDir: string): string {
  if (existsSync(path.join(repoDir, "pnpm-lock.yaml")) || existsSync(path.join(repoDir, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(path.join(repoDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function runCommand(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    proc.stdout?.on("data", (d: Buffer) => addLog(d.toString()));
    proc.stderr?.on("data", (d: Buffer) => addLog(d.toString()));
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

// Build a human-readable error from the last N log lines
function buildErrorSummary(msg: string): string {
  const recent = state.logs.slice(-12).filter(l =>
    !l.startsWith("npm warn") && !l.startsWith("npm notice") && l.trim().length > 0
  );
  if (recent.length > 0) return `${msg}\n\nLast output:\n${recent.join("\n")}`;
  return msg;
}

const router = Router();

router.post("/devserver/start", (req, res): void => {
  const { repoFullName, branch = "main", envVars = {} } = req.body as { repoFullName: string; branch?: string; envVars?: Record<string, string> };
  const rawToken = req.headers["x-github-token"] as string | undefined;
  const token = (rawToken && rawToken !== "__server__" && rawToken !== "__account__" && rawToken !== "__oauth__") ? rawToken : (process.env.GITHUB_TOKEN ?? undefined);

  if (!repoFullName) {
    res.status(400).json({ error: "Missing repoFullName" });
    return;
  }
  if (!token) {
    res.status(400).json({ error: "No GitHub token available. Add one in the Files tab or set GITHUB_TOKEN." });
    return;
  }

  killProc();
  state.status = "cloning";
  state.port = null;
  state.repoFullName = repoFullName;
  state.logs = [`Starting: cloning ${repoFullName} (${branch})…`];
  state.errorMsg = null;

  res.json({ status: state.status });

  (async () => {
    try {
      mkdirSync(WORK_DIR, { recursive: true });
      const repoName = repoFullName.split("/")[1];
      const repoDir = path.join(WORK_DIR, repoName);

      if (existsSync(repoDir)) {
        addLog("Removing existing clone…");
        rmSync(repoDir, { recursive: true, force: true });
      }

      addLog(`Cloning ${repoFullName}…`);
      await runCommand(
        "git",
        ["clone", "--depth=1", `--branch=${branch}`,
          `https://x-access-token:${token}@github.com/${repoFullName}.git`,
          repoDir],
      );

      state.status = "installing";
      const mgr = detectPackageManager(repoDir);
      addLog(`Installing dependencies with ${mgr}…`);

      // Build install args — pnpm needs --no-frozen-lockfile when outside its workspace
      const installArgs = mgr === "pnpm"
        ? ["install", "--no-frozen-lockfile", "--ignore-workspace"]
        : mgr === "yarn"
          ? ["install", "--frozen-lockfile=false"]
          : ["install", "--legacy-peer-deps"];

      try {
        await runCommand(mgr, installArgs, repoDir);
      } catch (installErr) {
        // If pnpm fails due to a catalog resolution error, retry with npm
        const recentLogs = state.logs.slice(-20).join("\n");
        if (mgr === "pnpm" && recentLogs.includes("ERR_PNPM_CATALOG_ENTRY_NOT_FOUND")) {
          addLog("pnpm catalog error detected — retrying with npm…");
          try {
            await runCommand("npm", ["install", "--legacy-peer-deps"], repoDir);
          } catch (npmErr) {
            const msg = npmErr instanceof Error ? npmErr.message : "Install failed";
            state.status = "error";
            state.errorMsg = buildErrorSummary(`Dependency install failed: ${msg}. If the app needs env vars (DATABASE_URL, API keys), add them in the LOCAL tab env section and relaunch.`);
            addLog(`✗ Install failed: ${msg}`);
            logger.error({ err: npmErr, repo: repoFullName }, "Dev server install failed (npm fallback)");
            return;
          }
        } else {
          // Install failed — surface reason clearly
          const msg = installErr instanceof Error ? installErr.message : "Install failed";
          state.status = "error";
          state.errorMsg = buildErrorSummary(`Dependency install failed: ${msg}. If the app needs env vars (DATABASE_URL, API keys), add them in the LOCAL tab env section and relaunch.`);
          addLog(`✗ Install failed: ${msg}`);
          logger.error({ err: installErr, repo: repoFullName }, "Dev server install failed");
          return;
        }
      }

      state.status = "starting";
      const { cmd, args } = detectDevCommand(repoDir);
      addLog(`Starting dev server: ${cmd} ${args.join(" ")}…`);

      const proc = spawn(cmd, args, {
        cwd: repoDir,
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          PORT: "5173",
          HOST: "0.0.0.0",
          ...envVars,
        },
      });
      state.proc = proc;

      // Port-detection timeout: if no announcement after 45s, poll common ports
      const portFallbackTimer = setTimeout(async () => {
        if (state.status === "starting" && state.proc) {
          addLog("Port not announced — probing common ports…");
          const found = await pollForPort([5173, 3000, 4173, 8080, 8000, 4000].filter(p => p !== OWN_PORT));
          if (found && state.status === "starting") {
            state.port = found;
            state.status = "running";
            addLog(`✓ Dev server detected on port ${found} (via probe)`);
            logger.info({ port: found, repo: repoFullName }, "Dev server found via port probe");
          } else if (state.status === "starting") {
            // Still starting but nothing found — wait another 30s before giving up
            setTimeout(async () => {
              if (state.status !== "starting") return;
              const found2 = await pollForPort([5173, 3000, 4173, 8080].filter(p => p !== OWN_PORT));
              if (found2) {
                state.port = found2;
                state.status = "running";
                addLog(`✓ Dev server on port ${found2}`);
              } else {
                state.status = "error";
                state.errorMsg = buildErrorSummary("Dev server started but no port was reachable after 75s. Check if the app needs environment variables (DATABASE_URL, API keys) to start — add them in the env section and relaunch.");
                addLog("✗ No running port found after timeout.");
              }
            }, 30_000);
          }
        }
      }, 45_000);

      const onData = (d: Buffer) => {
        const line = d.toString();
        addLog(line);
        if (state.status !== "running") {
          const port = detectPort(line);
          if (port) {
            clearTimeout(portFallbackTimer);
            state.port = port;
            state.status = "running";
            addLog(`✓ Dev server running on port ${port}`);
            logger.info({ port, repo: repoFullName }, "Dev server running");
          }
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("exit", (code) => {
        clearTimeout(portFallbackTimer);
        if (state.status !== "idle") {
          if (code !== 0) {
            state.status = "error";
            state.errorMsg = buildErrorSummary(
              `Dev server exited (code ${code}). Most likely cause: missing environment variables (DATABASE_URL, auth keys, API secrets). Add them in the env section of the LOCAL tab and relaunch.`
            );
            addLog(`✗ Dev server exited with code ${code}`);
          } else {
            state.status = "idle";
          }
        }
        state.proc = null;
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      state.status = "error";
      state.errorMsg = buildErrorSummary(`Failed to start: ${msg}`);
      addLog(`Error: ${msg}`);
      logger.error({ err }, "Dev server start failed");
    }
  })();
});

router.get("/devserver/status", (_req, res): void => {
  res.json({
    status: state.status,
    port: state.port,
    repoFullName: state.repoFullName,
    logs: state.logs.slice(-50),
    errorMsg: state.errorMsg,
  });
});

router.post("/devserver/build-check", (req, res): void => {
  const { repo } = req.body as { repo?: string };
  const rawToken = req.headers["x-github-token"] as string | undefined;
  const token = (rawToken && rawToken !== "__server__" && rawToken !== "__account__" && rawToken !== "__oauth__") ? rawToken : (process.env.GITHUB_TOKEN ?? "");

  if (!repo) { res.status(400).json({ error: "Missing repo" }); return; }
  if (!token) { res.status(400).json({ error: "No GitHub token available" }); return; }

  runBuildCheck(repo, token)
    .then((result) => res.json(result))
    .catch((err) => {
      logger.error({ err }, "build-check route error");
      res.status(500).json({ error: "Build check failed", details: String(err) });
    });
});

router.post("/devserver/stop", (_req, res): void => {
  killProc();
  state.status = "idle";
  state.port = null;
  state.logs = [];
  state.errorMsg = null;
  res.json({ status: "idle" });
});

const PROXY_BASE = "/api/devserver/proxy";

// Injected into every proxied page — captures JS errors and posts them to the
// parent frame so the Local Dev panel can surface them without browser DevTools.
const ERROR_CAPTURE_SCRIPT = `<script>(function(){` +
  `var _ce=console.error.bind(console);` +
  `console.error=function(){_ce.apply(console,arguments);` +
  `try{window.parent.postMessage({__atlasConsole:'error',msg:Array.from(arguments).map(String).join(' ')},'*')}catch(e){}};` +
  `window.onerror=function(msg,src,line){` +
  `try{window.parent.postMessage({__atlasConsole:'error',msg:msg+' ('+src+':'+line+')'},'*')}catch(e){}};` +
  `window.onunhandledrejection=function(e){` +
  `try{window.parent.postMessage({__atlasConsole:'error',msg:'Unhandled: '+String(e.reason)},'*')}catch(e){}};` +
  `})()</script>`;

// Rewrite absolute-path asset references so they route through this proxy
function rewriteHtml(html: string, base = PROXY_BASE): string {
  let out = html.replace(/(<head[^>]*>)/i, `$1<base href="${base}/">${ERROR_CAPTURE_SCRIPT}`);
  out = out.replace(/((?:src|href|action|srcset)=["'])\/(?!\/)/g, `$1${base}/`);
  out = out.replace(/url\((['"]?)\/(?!\/)/g, `url($1${base}/`);
  return out;
}

function rewriteCss(css: string, base = PROXY_BASE): string {
  return css.replace(/url\((['"]?)\/(?!\/)/g, `url($1${base}/`);
}

// Rewrite root-relative ESM import/export paths so they route through the proxy.
// Only touches `from "/..."`, `import "/..."`, and dynamic `import("/...")`.
// Does NOT touch string literals, comments, or other code.
function rewriteJs(js: string, base: string): string {
  let out = js;
  // Static imports/exports: from "/path" and import "/path"
  out = out.replace(/((?:from|import)\s+["'])\/(?!\/)/g, `$1${base}/`);
  // Dynamic imports: import("/path") and import('/path')
  out = out.replace(/\bimport\((["'])\/(?!\/)/g, `import($1${base}/`);
  return out;
}

// Generic proxy handler — forwards req to targetPort, rewrites HTML/CSS/JS paths
function proxyToPort(targetPort: number, proxyBase: string, req: import("express").Request, res: import("express").Response): void {
  const targetPath = req.url || "/";

  // Stub /@vite/client — HMR WebSocket can't work through the proxy, but CSS modules
  // import updateStyle/removeStyle from this module to inject their content into the page.
  // We must export those so CSS actually loads; everything else is a no-op.
  if (targetPath === "/@vite/client" || targetPath.startsWith("/@vite/client?")) {
    res.setHeader("Content-Type", "application/javascript");
    res.end(`
// @vite/client proxy stub — no WebSocket, but CSS injection still works
export function createHotContext(_id) {
  return {
    accept() {}, dispose() {}, decline() {}, invalidate() {},
    on() {}, off() {}, send() {}, prune() {},
  };
}
export function updateStyle(id, css) {
  const safeId = 'vite-css-' + id.replace(/[^a-z0-9]/gi, '-');
  let el = document.getElementById(safeId);
  if (!el) {
    el = document.createElement('style');
    el.id = safeId;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
export function removeStyle(id) {
  const el = document.getElementById('vite-css-' + id.replace(/[^a-z0-9]/gi, '-'));
  if (el) el.parentNode && el.parentNode.removeChild(el);
}
export const injectQuery = (url) => url;
`);
    return;
  }

  const options: http.RequestOptions = {
    hostname: "localhost",
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const contentType = (proxyRes.headers["content-type"] ?? "").toLowerCase();
    const isHtml = contentType.includes("text/html");
    const isCss = contentType.includes("text/css");
    const isJs = contentType.includes("javascript") || contentType.includes("ecmascript");
    const needsRewrite = isHtml || isCss || isJs;

    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      const lk = k.toLowerCase();
      if (lk === "x-frame-options") continue;
      if (lk === "content-security-policy") continue;
      if (needsRewrite && lk === "content-encoding") continue;
      if (needsRewrite && lk === "content-length") continue;
      if (lk === "location" && typeof v === "string") {
        let loc = v;
        loc = loc.replace(/^https?:\/\/localhost:\d+/, "");
        loc = loc.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "");
        if (loc.startsWith("/") && !loc.startsWith(proxyBase)) loc = `${proxyBase}${loc}`;
        headers[k] = loc;
        continue;
      }
      headers[k] = v;
    }

    if (needsRewrite) {
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let rewritten: string;
        if (isHtml) rewritten = rewriteHtml(raw, proxyBase);
        else if (isCss) rewritten = rewriteCss(raw, proxyBase);
        else rewritten = rewriteJs(raw, proxyBase);
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        res.end(rewritten, "utf8");
      });
    } else {
      res.writeHead(proxyRes.statusCode ?? 200, headers);
      proxyRes.pipe(res, { end: true });
    }
  });

  req.pipe(proxyReq, { end: true });
  proxyReq.on("error", (e) => {
    logger.warn({ err: e }, "Proxy error");
    if (!res.headersSent) res.status(502).json({ error: "Proxy error" });
  });
}

// GitHub-repo devserver proxy (existing)
router.use("/devserver/proxy", (req, res): void => {
  if (!state.port) { res.status(503).json({ error: "Dev server not running" }); return; }
  proxyToPort(state.port, PROXY_BASE, req, res);
});

// ── Workspace devserver routes ─────────────────────────────────────────────

router.post("/devserver/workspace/:projectId/start", (req, res): void => {
  const projectId = Number(req.params["projectId"]);
  if (!projectId) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const wsDir = projectWorkspaceDir(projectId);
  const pkgPath = path.join(wsDir, "package.json");
  if (!existsSync(pkgPath)) {
    res.status(400).json({ error: `No package.json in workspace ${projectId} (${wsDir})` });
    return;
  }

  const st = getWsState(projectId);
  if (st.proc) { try { st.proc.kill("SIGTERM"); } catch {} st.proc = null; }
  st.status = "installing";
  st.port = null;
  st.logs = [`Starting workspace ${projectId}…`];
  st.errorMsg = null;

  res.json({ status: st.status });

  (async () => {
    try {
      // Install only if node_modules absent
      if (!existsSync(path.join(wsDir, "node_modules"))) {
        const mgr = detectPackageManager(wsDir);
        addWsLog(st, `Installing with ${mgr}…`);
        const installArgs = mgr === "pnpm"
          ? ["install", "--no-frozen-lockfile", "--ignore-workspace"]
          : mgr === "yarn"
            ? ["install", "--frozen-lockfile=false"]
            : ["install", "--legacy-peer-deps"];

        // Run install, capturing all output so we can detect 403-blocked packages
        const runInstall = () => new Promise<{ ok: boolean; output: string }>((resolve) => {
          const chunks: string[] = [];
          const proc = spawn(mgr, installArgs, {
            cwd: wsDir, shell: true,
            env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
          });
          const onData = (d: Buffer) => { const s = d.toString(); chunks.push(s); addWsLog(st, s); };
          proc.stdout?.on("data", onData);
          proc.stderr?.on("data", onData);
          proc.on("exit", (code) => resolve({ ok: code === 0, output: chunks.join("") }));
          proc.on("error", (e) => resolve({ ok: false, output: e.message }));
        });

        let result = await runInstall();

        // If install failed with 403 (Replit security policy blocks some packages like vitest),
        // strip the blocked packages from package.json and retry once.
        if (!result.ok && result.output.includes("E403")) {
          const blocked = new Set<string>();
          for (const m of result.output.matchAll(/403.*?\/([^/\s]+)\/-\//g)) blocked.add(m[1]);
          if (blocked.size > 0) {
            const pkgPath = path.join(wsDir, "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            const stripped: string[] = [];
            for (const name of blocked) {
              if (pkg.dependencies?.[name]) { delete pkg.dependencies[name]; stripped.push(name); }
              if (pkg.devDependencies?.[name]) { delete pkg.devDependencies[name]; stripped.push(name); }
            }
            if (stripped.length > 0) {
              addWsLog(st, `⚠ Blocked by Replit security policy: ${stripped.join(", ")} — removing and retrying…`);
              writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
              result = await runInstall();
              if (result.ok) addWsLog(st, `✓ Installed (${stripped.join(", ")} skipped — not available in this environment)`);
            }
          }
        }

        if (!result.ok) throw new Error(`Dependency install failed: ${mgr} exited with code 1. If the app needs env vars (DATABASE_URL, API keys), add them in the LOCAL tab env section and relaunch.\nLast output: ${result.output.slice(-800)}`);
      }

      // Build the project and serve via the static /api/preview/workspace/:id/ route.
      // This avoids the Vite dev-mode proxy complexity entirely.
      st.status = "starting";
      addWsLog(st, "Building project…");
      const mgr2 = detectPackageManager(wsDir);
      const buildArgs = ["run", "build"];
      const buildResult = await new Promise<{ ok: boolean; output: string }>((resolve) => {
        const chunks: string[] = [];
        const proc = spawn(mgr2, buildArgs, {
          cwd: wsDir, shell: true,
          env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        });
        st.proc = proc;
        const onData = (d: Buffer) => { const s = d.toString(); chunks.push(s); addWsLog(st, s); };
        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("exit", (code) => resolve({ ok: code === 0, output: chunks.join("") }));
        proc.on("error", (e) => resolve({ ok: false, output: e.message }));
      });
      st.proc = null;

      if (!buildResult.ok) {
        // Record build failure — project is still typed as "app" (files exist)
        db.update(projectsTable)
          .set({ projectType: "app", appBuildSucceeded: false })
          .where(eq(projectsTable.id, projectId))
          .catch((e) => logger.warn({ err: e, projectId }, "Failed to update appBuildSucceeded=false"));
        throw new Error(`Build failed.\nLast output:\n${buildResult.output.slice(-800)}`);
      }

      // Count source files written to the workspace (exclude hidden dirs, node_modules, dist)
      const SKIP = new Set(["node_modules", ".git", "dist", ".next", "build", "out", ".cache", "coverage"]);
      function countWsFiles(dir: string): number {
        let n = 0;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
            n += entry.isDirectory() ? countWsFiles(path.join(dir, entry.name)) : 1;
          }
        } catch {}
        return n;
      }
      const fileCount = countWsFiles(wsDir);

      // Persist project type and build result to DB
      db.update(projectsTable)
        .set({ projectType: "app", appSourceFileCount: fileCount, appBuildSucceeded: true })
        .where(eq(projectsTable.id, projectId))
        .catch((e) => logger.warn({ err: e, projectId }, "Failed to update app build state"));

      // Sentinel port: non-null so the frontend shows the iframe, but the iframe
      // points to /api/preview/workspace/:id/ (served by this same API server).
      st.port = 1;
      st.status = "running";
      wsSaveState(projectId, 1, undefined);
      addWsLog(st, `✓ Build complete — ${fileCount} source files · preview ready`);

      // Log to artifact gallery — version auto-computed from existing build count
      void logProjectArtifact({
        projectId,
        type: "build_output",
        title: "Build Output",
        metadata: { fileCount, builtAt: new Date().toISOString() },
        payload: {},
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      st.status = "error";
      st.errorMsg = msg;
      addWsLog(st, `Error: ${msg}`);
      logger.error({ err, projectId }, "Workspace dev server start failed");
    }
  })();
});

router.get("/devserver/workspace/:projectId/status", (req, res): void => {
  const projectId = Number(req.params["projectId"]);
  const st = getWsState(projectId);
  const wsDir = projectWorkspaceDir(projectId);
  const hasScaffold = existsSync(path.join(wsDir, "package.json"));
  res.json({ status: st.status, port: st.port, logs: st.logs.slice(-50), errorMsg: st.errorMsg, hasScaffold });
});

router.post("/devserver/workspace/:projectId/stop", (req, res): void => {
  const projectId = Number(req.params["projectId"]);
  const st = wsStates.get(projectId);
  if (st?.proc) { try { st.proc.kill("SIGTERM"); } catch {} st.proc = null; }
  if (st) { st.status = "idle"; st.port = null; st.logs = []; st.errorMsg = null; }
  wsDeleteState(projectId);
  res.json({ status: "idle" });
});

router.use("/devserver/workspace/:projectId/proxy", (req, res): void => {
  const projectId = Number(req.params["projectId"]);
  const st = wsStates.get(projectId);
  if (!st?.port) { res.status(503).json({ error: "Dev server not running" }); return; }
  const wsProxyBase = `/api/devserver/workspace/${projectId}/proxy`;
  proxyToPort(st.port, wsProxyBase, req, res);
});

export default router;
