import type * as PtyModule from "node-pty";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
let pty: typeof PtyModule;
try {
  pty = _require("node-pty");
} catch {
  pty = null as any;
}
import { readlinkSync } from "fs";
import { logger } from "./logger";
import { evaluateTerminalRequest, type TerminalClassificationTier } from "./terminalExecution";

export type SafetyLevel = "full" | "nuclear";

export type PtySession = {
  id: string;
  userId: number;
  pty: PtyModule.IPty;
  cwd: string;
  outputBuffer: string[];
  safety: SafetyLevel;
  lastActivity: number;
  commandQueue: string[];
  isRunning: boolean;
  onOutput?: (text: string) => void;
  onExit?: () => void;
};

const WORK_DIR = process.env.GIT_WORK_DIR ?? process.env.HOME ?? "/home/runner/workspace";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_OUTPUT_BUFFER = 500;

const sessions = new Map<string, PtySession>();
const userToSession = new Map<number, string>();

// ── Nuclear-only blocked patterns (used when safety === "nuclear") ────────────
const NUCLEAR_BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/i,      // rm -rf /
  /rm\s+-[a-z]*f[a-z]*r?\s+\/(?:\s|$)/i,      // rm -fr /
  /:\s*\(\s*\)\s*\{.*\|.*&.*\}/,               // fork bomb
  /mkfs\b/i,                                      // format filesystem
  /dd\s+.*of=\/dev\//i,                          // dd to device
  />\s*\/dev\/sd/i,                               // redirect to block device
  /chmod\s+-[a-z]*R[a-z]*\s+777\s+\//i,          // chmod -R 777 /
  /shutdown\b/i,                                  // shutdown
  /reboot\b/i,                                    // reboot
  /halt\b/i,                                      // halt
  /kill\s+-9\s+1\b/,                             // kill init
  /pkill\s+-9\s+node/i,                          // kill all node processes
];

function isNuclearBlocked(cmd: string): string | null {
  for (const pattern of NUCLEAR_BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return `Blocked (nuclear): matches dangerous pattern`;
  }
  return null;
}

function generateSessionId(): string {
  return `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Safety-aware command filter ───────────────────────────────────────────────
export function classifyForPty(command: string, safety: SafetyLevel): { allowed: boolean; reason?: string; tier: TerminalClassificationTier } {
  if (safety === "nuclear") {
    const nuclearBlock = isNuclearBlocked(command);
    if (nuclearBlock) {
      return { allowed: false, reason: nuclearBlock, tier: "blocked" };
    }
    return { allowed: true, tier: 1 };
  }
  // full safety: use the existing tier system
  const evalResult = evaluateTerminalRequest(command);
  if (evalResult.tier === "blocked") {
    return { allowed: false, reason: evalResult.reason, tier: "blocked" };
  }
  if (evalResult.requiresConfirmation) {
    return { allowed: false, reason: `Requires confirmation: ${evalResult.reason}`, tier: evalResult.tier };
  }
  return { allowed: true, tier: evalResult.tier };
}

// ── Create or resume a PTY session for a user ─────────────────────────────────
export function getOrCreatePtySession(
  userId: number,
  safety: SafetyLevel = "full",
): PtySession {
  const existingId = userToSession.get(userId);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing && existing.pty.pid !== undefined) {
      try {
        // Verify process is still alive
        process.kill(existing.pty.pid, 0);
        existing.safety = safety;
        existing.lastActivity = Date.now();
        return existing;
      } catch {
        // Process is dead, clean up
        sessions.delete(existingId);
        userToSession.delete(userId);
      }
    } else {
      sessions.delete(existingId);
      userToSession.delete(userId);
    }
  }

  if (!pty) {
    throw new Error("Terminal not available: native PTY module failed to load. The server needs to be rebuilt with build tools (build-essential, python3, make).");
  }

  const id = generateSessionId();
  const shell = process.env.SHELL ?? "/bin/bash";

  logger.info({ userId, shell, cwd: WORK_DIR }, "Spawning PTY session");

  const ptyProc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: WORK_DIR,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      HOME: process.env.HOME ?? "/home/runner",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      PS1: "\\u@atlas:\\w\\$ ",
      HISTFILE: `/tmp/atlas_pty_hist_${userId}`,
      HISTSIZE: "1000",
    },
  });

  const session: PtySession = {
    id,
    userId,
    pty: ptyProc,
    cwd: WORK_DIR,
    outputBuffer: [],
    safety,
    lastActivity: Date.now(),
    commandQueue: [],
    isRunning: false,
  };

  ptyProc.onData((data: string) => {
    session.lastActivity = Date.now();
    session.outputBuffer.push(data);
    if (session.outputBuffer.length > MAX_OUTPUT_BUFFER) {
      session.outputBuffer.shift();
    }
    session.onOutput?.(data);
  });

  ptyProc.onExit(({ exitCode, signal }) => {
    logger.warn({ userId, exitCode, signal }, "PTY process exited unexpectedly");
    sessions.delete(id);
    userToSession.delete(userId);
    session.onExit?.();
  });

  // Track cwd changes via prompt parsing (best-effort)
  ptyProc.onData((data: string) => {
    // Look for cd commands in the data stream
    const cdMatch = data.match(/^cd\s+(.+)$/m);
    if (cdMatch) {
      // Don't try to resolve path here — just let bash handle it
      // We'll get cwd from the prompt or from explicit queries
    }
  });

  sessions.set(id, session);
  userToSession.set(userId, id);

  return session;
}

// ── Send keystrokes to a PTY session ──────────────────────────────────────────
export function ptyWrite(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.lastActivity = Date.now();
  session.pty.write(data);
  return true;
}

// ── Resize PTY ────────────────────────────────────────────────────────────────
export function ptyResize(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.resize(cols, rows);
    return true;
  } catch (err) {
    logger.error({ err, sessionId }, "PTY resize failed");
    return false;
  }
}

// ── Execute a command in the PTY and capture output ───────────────────────────
export function ptyExecCommand(
  sessionId: string,
  command: string,
  timeoutMs = 30000,
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const session = sessions.get(sessionId);
    if (!session) {
      resolve({ output: "[Error: PTY session not found]", exitCode: null });
      return;
    }

    // Safety check
    const classification = classifyForPty(command, session.safety);
    if (!classification.allowed) {
      resolve({ output: `[BLOCKED] ${classification.reason}\r\n`, exitCode: 1 });
      return;
    }

    let output = "";
    const startTime = Date.now();
    let done = false;

    const onData = (data: string) => {
      output += data;
      if (Date.now() - startTime > timeoutMs && !done) {
        done = true;
        session.pty.write("\x03"); // Ctrl+C to interrupt
        session.onOutput = session.onOutput === onData ? undefined : session.onOutput;
        resolve({ output: output + "\r\n[timeout]", exitCode: null });
      }
    };

    const prevOnOutput = session.onOutput;
    session.onOutput = (text: string) => {
      onData(text);
      prevOnOutput?.(text);
    };

    session.pty.write(`${command}\r`);

    // Give a reasonable timeout then resolve
    setTimeout(() => {
      if (!done) {
        done = true;
        session.onOutput = prevOnOutput;
        // Trim trailing prompt from output
        const trimmed = output.replace(/\r?\n\r?\n.*@atlas:.*\$\s*$/, "").trimEnd();
        resolve({ output: trimmed, exitCode: 0 });
      }
    }, timeoutMs);
  });
}

// ── Get current working directory ─────────────────────────────────────────────
export function ptyGetCwd(sessionId: string): string | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  // Best effort: try to read CWD from /proc
  try {
    const cwdLink = `/proc/${session.pty.pid}/cwd`;
    return readlinkSync(cwdLink);
  } catch {
    return session.cwd;
  }
}

// ── Update safety level ─────────────────────────────────────────────────────
export function setPtySafety(sessionId: string, safety: SafetyLevel): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.safety = safety;
  return true;
}

// ── Kill a PTY session ────────────────────────────────────────────────────────
export function killPtySession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.kill();
  } catch {}
  sessions.delete(sessionId);
  for (const [uid, sid] of userToSession) {
    if (sid === sessionId) userToSession.delete(uid);
  }
  return true;
}

// ── Cleanup dead sessions periodically ────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      logger.info({ sessionId: id, userId: session.userId }, "Cleaning up idle PTY session");
      try { session.pty.kill(); } catch {}
      sessions.delete(id);
      userToSession.delete(session.userId);
    }
  }
}, 60000);

// ── Get session by user ID ────────────────────────────────────────────────────
export function getPtySessionForUser(userId: number): PtySession | undefined {
  const id = userToSession.get(userId);
  return id ? sessions.get(id) : undefined;
}

export function getAllSessionIds(): string[] {
  return Array.from(sessions.keys());
}
