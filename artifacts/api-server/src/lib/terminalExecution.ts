import { spawn, type ChildProcess } from "child_process";
import { logger } from "./logger";

const WORK_DIR = process.env.GIT_WORK_DIR ?? process.env.HOME ?? "/home/runner/workspace";
const MAX_HISTORY = 60;
const MAX_CMD_LENGTH = 2000;

export type TerminalTier = 1 | 2 | 3;
export type TerminalClassificationTier = TerminalTier | "blocked";

export type TerminalClassification = {
  tier: TerminalClassificationTier;
  reason: string;
};

export type TerminalClassificationOptions = {
  sandbox?: boolean;
};

export type TerminalHistoryEntry = {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  timestamp: string;
  durationMs: number;
};

export type TerminalExecutionResult = {
  command: string;
  output: string;
  exitCode: number | null;
  durationMs: number;
};

export type TerminalExecutionCallbacks = {
  onStart?: (command: string) => void;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onProcess?: (proc: ChildProcess) => void;
};

export type TerminalExecutionOptions = {
  cwd?: string;
  githubToken?: string | null;
};

export type TerminalRequestEvaluation = {
  classification: TerminalClassification;
  tier: TerminalClassificationTier;
  reason: string;
  requiresConfirmation: boolean;
};

const history: TerminalHistoryEntry[] = [];

function addHistory(entry: TerminalHistoryEntry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
}

export function getTerminalHistory(): TerminalHistoryEntry[] {
  return [...history].reverse();
}

// Commands that could destroy the server environment
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/i,        // rm -rf /
  /rm\s+-[a-z]*f[a-z]*r?\s+\/(?:\s|$)/i,        // rm -fr /
  /:\s*\(\s*\)\s*\{.*\|.*&.*\}/,                 // fork bomb
  /\|\s*bash\b/i,                                // curl | bash, wget | bash
  /\|\s*sh\b/i,                                  // pipe into sh
  /mkfs\b/i,                                     // format filesystem
  /dd\s+.*of=\/dev\//i,                          // dd to device
  />\s*\/dev\/sd/i,                              // redirect to block device
  /chmod\s+-[a-z]*R[a-z]*\s+777\s+\//i,         // chmod -R 777 /
  /shutdown\b/i,                                  // shutdown
  /reboot\b/i,                                    // reboot
  /halt\b/i,                                      // halt
  /kill\s+-9\s+1\b/,                             // kill init
  /pkill\s+-9\s+node/i,                          // kill all node processes
];

function blockedReason(cmd: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return `Command blocked: matches dangerous pattern (${pattern.source.slice(0, 40)})`;
  }
  if (cmd.length > MAX_CMD_LENGTH) return `Command too long (max ${MAX_CMD_LENGTH} chars)`;
  return null;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function matchesAny(command: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(command));
}

function hasFileWriteOrDeleteOperation(command: string): boolean {
  return matchesAny(command, [
    /(^|[^<])>>?\s*(?!&\d)\S+/,                  // shell file redirection
    /<<-?\s*\S+/,                                // heredoc writes stdin to a command
    /(?:^|\s)tee(?:\s|$)/i,
    /(?:^|\s)truncate(?:\s|$)/i,
    /(?:^|\s)sed\s+.*(?:^|\s)-i(?:\s|$)/i,
    /(?:^|\s)perl\s+.*(?:^|\s)-(?:p?i|i)(?:\s|$)/i,
  ]);
}

export function classifyTerminalCommand(
  command: string,
  options: TerminalClassificationOptions = {}
): TerminalClassification {
  const normalized = normalizeCommand(command);
  if (!normalized) return { tier: "blocked", reason: "Missing command" };

  const blocked = blockedReason(normalized);
  if (blocked) return { tier: "blocked", reason: blocked };

  if (matchesAny(normalized, [
    /^git\s+(?:push|force-push)\b/i,
    /^rm\b/i,
    /^git\s+(?:reset|revert)\b/i,
  ])) {
    return { tier: 3, reason: "Permanent or destructive command requires typing YES to confirm" };
  }

  if (/^npm\s+install\b/i.test(normalized)) {
    return options.sandbox
      ? { tier: 1, reason: "Safe read-only command can execute automatically" }
      : { tier: 2, reason: "Project-affecting command requires confirmation before executing" };
  }

  if (matchesAny(normalized, [
    /^bun\s+install\b/i,
    /^pnpm\s+install\b/i,
    /^git\s+(?:add|commit)\b/i,
    /^(?:mkdir|touch|cp|mv)\b/i,
  ])) {
    return { tier: 2, reason: "Project-affecting command requires confirmation before executing" };
  }

  if (hasFileWriteOrDeleteOperation(normalized)) {
    return { tier: 3, reason: "File write or delete operation requires typing YES to confirm" };
  }

  if (matchesAny(normalized, [
    /^git\s+(?:status|log|diff|show)\b/i,
    /^npm\s+test\b/i,
    /^bun\s+test\b/i,
    /^vitest\b/i,
    /^npm\s+run\s+build\b/i,
    /^bun\s+run\s+build\b/i,
    /^(?:ls|pwd|cat|head|tail|grep|find|wc|stat|file|du|sort|uniq|cut|awk|sed(?!\s.*-i))\b/i,
    /^npm\s+run\s+typecheck\b/i,
    /^pnpm\s+(?:--filter\s+\S+\s+)?run\s+(?:typecheck|build|lint|test)\b/i,
    /^tsc\s+--noEmit\b/i,
    /^echo\b/i,
    /^which\b/i,
    /^env\b/i,
    /^printenv\b/i,
    /^git\s+--version\s+&&\s+node\s+--version$/i,
    /^node\s+--version$/i,
    /^npm\s+--version$/i,
    /^pnpm\s+--version$/i,
  ])) {
    return { tier: 1, reason: "Safe read-only command can execute automatically" };
  }

  return { tier: 2, reason: "Unrecognized command requires confirmation before executing" };
}

export function parseTerminalTier(value: unknown): TerminalTier | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

export function evaluateTerminalRequest(
  command: string,
  requestedTier?: TerminalTier,
  confirmationToken?: string,
  options: TerminalClassificationOptions = {}
): TerminalRequestEvaluation {
  const classification = classifyTerminalCommand(command, options);
  if (classification.tier === "blocked") {
    return {
      classification,
      tier: "blocked",
      reason: classification.reason,
      requiresConfirmation: false,
    };
  }

  const effectiveTier = requestedTier && requestedTier > classification.tier
    ? requestedTier
    : classification.tier;
  const reason = requestedTier && requestedTier > classification.tier
    ? `Client requested tier ${requestedTier} confirmation`
    : classification.reason;
  const requiresConfirmation = effectiveTier === 2
    ? !confirmationToken
    : effectiveTier === 3 && confirmationToken !== "YES";

  return {
    classification,
    tier: effectiveTier,
    reason,
    requiresConfirmation,
  };
}

export function executeTerminalCommand(
  command: string,
  callbacks: TerminalExecutionCallbacks = {},
  options: TerminalExecutionOptions = {}
): Promise<TerminalExecutionResult> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const start = Date.now();
  const outputChunks: string[] = [];

  callbacks.onStart?.(command);

  const gitToken = options.githubToken ?? process.env.GITHUB_TOKEN ?? "";
  const gitUser = process.env.GIT_USER_NAME ?? "jochanae";
  const gitEmail = process.env.GIT_USER_EMAIL ?? "jochanae@gmail.com";

  const proc = spawn("bash", ["-c", command], {
    cwd: options.cwd ?? WORK_DIR,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "dumb",
      GIT_AUTHOR_NAME: gitUser,
      GIT_AUTHOR_EMAIL: gitEmail,
      GIT_COMMITTER_NAME: gitUser,
      GIT_COMMITTER_EMAIL: gitEmail,
      GIT_ASKPASS: "echo",
      GIT_TERMINAL_PROMPT: "0",
      GITHUB_TOKEN: gitToken,
    },
  });

  callbacks.onProcess?.(proc);

  return new Promise((resolve, reject) => {
    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      outputChunks.push(text);
      callbacks.onStdout?.(text);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      outputChunks.push(text);
      callbacks.onStderr?.(text);
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - start;
      const output = outputChunks.join("");
      addHistory({
        id,
        command,
        output: output.slice(0, 8000),
        exitCode: code,
        timestamp: new Date().toISOString(),
        durationMs,
      });
      logger.info({ command, exitCode: code, durationMs }, "Terminal command executed");
      resolve({ command, output, exitCode: code, durationMs });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}
