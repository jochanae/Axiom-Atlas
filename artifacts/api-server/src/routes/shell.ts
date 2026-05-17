import { exec, type ExecException } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter, type Request } from "express";

type ShellCommandName = "typecheck" | "lint" | "test";

type AllowlistEntry = {
  cmd: string;
  timeout: number;
};

type ShellError =
  | "NONE"
  | "UNKNOWN_COMMAND"
  | "EXECUTION_TIMEOUT"
  | "SPAWN_ERROR"
  | "PROCESS_ALREADY_RUNNING"
  | "INTERNAL_ERROR";

type ShellResponse = {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  duration_ms: number;
  error: ShellError;
  busy: boolean;
  active_command?: string;
};

const ALLOWLIST: Record<ShellCommandName, AllowlistEntry> = {
  typecheck: {
    cmd: "pnpm --filter @workspace/api-server run build",
    timeout: 120000,
  },
  lint: {
    cmd: "pnpm --filter @workspace/api-server run lint",
    timeout: 60000,
  },
  test: {
    cmd: "pnpm --filter @workspace/api-server run test",
    timeout: 90000,
  },
};

const MAX_OUTPUT = 20000;
const MAX_BUFFER = MAX_OUTPUT * 20;

let activeProcess: string | null = null;

const router: IRouter = Router();

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isCommandName(value: string): value is ShellCommandName {
  return Object.prototype.hasOwnProperty.call(ALLOWLIST, value);
}

function parseCommandBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const command = (body as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return "/home/runner/workspace";
    current = parent;
  }
}

function tailOutput(value: string): string {
  return value.slice(-MAX_OUTPUT);
}

function exitCodeFromError(error: ExecException | null): number {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : -1;
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

function runCommand(commandName: ShellCommandName, entry: AllowlistEntry): Promise<ShellResponse> {
  const startedAt = Date.now();
  const workspaceRoot = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
  const execOptions = {
    cwd: workspaceRoot,
    detached: false as const,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  };

  return new Promise<ShellResponse>((resolve) => {
    let timedOut = false;
    let settled = false;

    const child = exec(
      entry.cmd,
      execOptions,
      (error: ExecException | null, stdout: string, stderr: string) => {
        if (settled) return;
        settled = true;
        const duration = Date.now() - startedAt;

        if (timedOut) {
          resolve({
            command: commandName,
            exit_code: -1,
            stdout: tailOutput(stdout),
            stderr: tailOutput(stderr || "Command timed out"),
            passed: false,
            duration_ms: duration,
            error: "EXECUTION_TIMEOUT",
            busy: false,
          });
          return;
        }

        const exitCode = exitCodeFromError(error);
        resolve({
          command: commandName,
          exit_code: exitCode,
          stdout: tailOutput(stdout),
          stderr: tailOutput(stderr),
          passed: exitCode === 0,
          duration_ms: duration,
          error: "NONE",
          busy: false,
        });
      }
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessGroup(child.pid);
    }, entry.timeout);

    child.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        command: commandName,
        exit_code: -1,
        stdout: "",
        stderr: tailOutput(error.message),
        passed: false,
        duration_ms: Date.now() - startedAt,
        error: "SPAWN_ERROR",
        busy: false,
      });
    });

    child.once("close", () => {
      clearTimeout(timeout);
    });
  });
}

router.post("/run", async (req, res): Promise<void> => {
  const expectedToken = process.env.RAILWAY_API_TOKEN;
  const token = getBearerToken(req);
  if (!expectedToken || token !== expectedToken) {
    res.status(401).json({ error: "Invalid bearer token" });
    return;
  }

  const command = parseCommandBody(req.body);
  if (!command || !isCommandName(command)) {
    res.status(400).json({
      command: command ?? "",
      exit_code: -1,
      stdout: "",
      stderr: "",
      passed: false,
      duration_ms: 0,
      error: "UNKNOWN_COMMAND" satisfies ShellError,
      busy: false,
    });
    return;
  }

  if (activeProcess) {
    res.status(200).json({
      busy: true,
      active_command: activeProcess,
      passed: false,
      error: "PROCESS_ALREADY_RUNNING" satisfies ShellError,
    });
    return;
  }

  activeProcess = command;
  try {
    const response = await runCommand(command, ALLOWLIST[command]);
    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal shell endpoint error";
    res.status(200).json({
      command,
      exit_code: -1,
      stdout: "",
      stderr: tailOutput(message),
      passed: false,
      duration_ms: 0,
      error: "INTERNAL_ERROR" satisfies ShellError,
      busy: false,
    });
  } finally {
    activeProcess = null;
  }
});

export default router;
