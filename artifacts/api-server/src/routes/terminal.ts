import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const WORK_DIR = "/home/runner/workspace";
const MAX_HISTORY = 60;

type HistoryEntry = {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  timestamp: string;
  durationMs: number;
};

const history: HistoryEntry[] = [];

function addHistory(entry: HistoryEntry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
}

// POST /api/terminal/exec — execute a command, stream output as SSE
router.post("/terminal/exec", (req: Request, res: Response): void => {
  const { command } = req.body as { command?: string };
  if (!command?.trim()) {
    res.status(400).json({ error: "Missing command" });
    return;
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const start = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("start", command);

  const outputChunks: string[] = [];

  const proc = spawn("bash", ["-c", command], {
    cwd: WORK_DIR,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    outputChunks.push(text);
    send("output", text);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    outputChunks.push(text);
    send("stderr", text);
  });

  proc.on("close", (code) => {
    const durationMs = Date.now() - start;
    const fullOutput = outputChunks.join("");
    send("done", JSON.stringify({ exitCode: code, durationMs }));
    res.end();
    addHistory({
      id, command,
      output: fullOutput.slice(0, 8000),
      exitCode: code,
      timestamp: new Date().toISOString(),
      durationMs,
    });
    logger.info({ command, exitCode: code, durationMs }, "Terminal command executed");
  });

  proc.on("error", (err) => {
    send("error", err.message);
    res.end();
  });

  req.on("close", () => {
    try { proc.kill("SIGTERM"); } catch {}
  });
});

// GET /api/terminal/history — last N commands with their output
router.get("/terminal/history", (_req, res): void => {
  res.json({ history: [...history].reverse() });
});

export default router;
