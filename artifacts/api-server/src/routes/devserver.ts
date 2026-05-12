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

function detectDevCommand(repoDir: string): { cmd: string; args: string[] } {
  try {
    const pkgRaw = readFileSync(path.join(repoDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    if (scripts["dev"]) return { cmd: "npm", args: ["run", "dev"] };
    if (scripts["start"]) return { cmd: "npm", args: ["start"] };
    if (scripts["serve"]) return { cmd: "npm", args: ["run", "serve"] };
  } catch {}
  return { cmd: "npm", args: ["run", "dev"] };
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

const router = Router();

router.post("/devserver/start", (req, res): void => {
  const { repoFullName, branch = "main", envVars = {} } = req.body as { repoFullName: string; branch?: string; envVars?: Record<string, string> };
  const token = (req.headers["x-github-token"] as string | undefined) || process.env.GITHUB_TOKEN;

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
      const hasPnpm = existsSync(path.join(repoDir, "pnpm-lock.yaml"));
      const hasYarn = existsSync(path.join(repoDir, "yarn.lock"));
      const mgr = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
      addLog(`Installing dependencies with ${mgr}…`);
      await runCommand(mgr, ["install"], repoDir);

      state.status = "starting";
      const { cmd, args } = detectDevCommand(repoDir);
      addLog(`Starting dev server: ${cmd} ${args.join(" ")}…`);

      const proc = spawn(cmd, args, {
        cwd: repoDir,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PORT: "5173", ...envVars },
      });
      state.proc = proc;

      const onData = (d: Buffer) => {
        const line = d.toString();
        addLog(line);
        if (state.status !== "running") {
          const port = detectPort(line);
          if (port) {
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
        if (state.status !== "idle") {
          state.status = code === 0 ? "idle" : "error";
          state.errorMsg = code !== 0 ? `Process exited with code ${code}` : null;
          if (state.errorMsg) addLog(state.errorMsg);
        }
        state.proc = null;
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      state.status = "error";
      state.errorMsg = msg;
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
    logs: state.logs.slice(-40),
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
      // Drop these when we buffer + rewrite — we'll recalculate
      if (needsRewrite && lk === "content-encoding") continue;
      if (needsRewrite && lk === "content-length") continue;
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
