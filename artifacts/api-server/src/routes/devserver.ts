import { Router } from "express";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import { mkdirSync, existsSync, readFileSync, rmSync } from "fs";
import path from "path";
import { logger } from "../lib/logger";

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

function detectDevCommand(repoDir: string): { cmd: string; args: string[]; useMgr: string } {
  const useMgr = detectPackageManager(repoDir);
  try {
    const pkgRaw = readFileSync(path.join(repoDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const isVite = !!allDeps["vite"] || (scripts["dev"] ?? "").includes("vite");
    const isNext = !!allDeps["next"] || (scripts["dev"] ?? "").includes("next");

    if (scripts["dev"]) {
      // For Vite (non-Next): append --host 0.0.0.0 so it accepts proxied requests
      if (isVite && !isNext) return { cmd: useMgr, args: ["run", "dev", "--", "--host", "0.0.0.0"], useMgr };
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
  const token = (rawToken && rawToken !== "__server__") ? rawToken : (process.env.GITHUB_TOKEN ?? undefined);

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
        // Install failed — surface reason clearly
        const msg = installErr instanceof Error ? installErr.message : "Install failed";
        state.status = "error";
        state.errorMsg = buildErrorSummary(`Dependency install failed: ${msg}. If the app needs env vars (DATABASE_URL, API keys), add them in the LOCAL tab env section and relaunch.`);
        addLog(`✗ Install failed: ${msg}`);
        logger.error({ err: installErr, repo: repoFullName }, "Dev server install failed");
        return;
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

router.post("/devserver/stop", (_req, res): void => {
  killProc();
  state.status = "idle";
  state.port = null;
  state.logs = [];
  state.errorMsg = null;
  res.json({ status: "idle" });
});

const PROXY_BASE = "/api/devserver/proxy";

// Rewrite absolute-path asset references so they route through this proxy
function rewriteHtml(html: string): string {
  // Inject a <base> tag so relative URLs also resolve through the proxy
  let out = html.replace(/(<head[^>]*>)/i, `$1<base href="${PROXY_BASE}/">`);
  // Rewrite absolute src / href / action / srcset that start with / (not //)
  out = out.replace(/((?:src|href|action|srcset)=["'])\/(?!\/)/g, `$1${PROXY_BASE}/`);
  // Rewrite url() in inline styles
  out = out.replace(/url\((['"]?)\/(?!\/)/g, `url($1${PROXY_BASE}/`);
  return out;
}

function rewriteCss(css: string): string {
  return css.replace(/url\((['"]?)\/(?!\/)/g, `url($1${PROXY_BASE}/`);
}

router.use("/devserver/proxy", (req, res): void => {
  if (!state.port) {
    res.status(503).json({ error: "Dev server not running" });
    return;
  }

  const targetPath = req.url || "/";
  const options: http.RequestOptions = {
    hostname: "localhost",
    port: state.port,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${state.port}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const contentType = (proxyRes.headers["content-type"] ?? "").toLowerCase();
    const isHtml = contentType.includes("text/html");
    const isCss = contentType.includes("text/css");
    const needsRewrite = isHtml || isCss;

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
        if (loc.startsWith("/") && !loc.startsWith(PROXY_BASE)) {
          loc = `${PROXY_BASE}${loc}`;
        }
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
        const rewritten = isHtml ? rewriteHtml(raw) : rewriteCss(raw);
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
    logger.warn({ err: e }, "Dev server proxy error");
    if (!res.headersSent) res.status(502).json({ error: "Proxy error" });
  });
});

export default router;
