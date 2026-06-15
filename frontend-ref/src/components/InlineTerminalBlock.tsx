import { useState, type CSSProperties } from "react";

type TerminalTier = 1 | 2 | 3;
type ParsedTerminalCmd = { command: string; reason?: string | null; tier: TerminalTier };
type ParsedTerminalResult = { command: string; output: string; exitCode: number | null; durationMs: number };

function normalizeTerminalTier(value: unknown): TerminalTier {
  if (value === 1 || value === "1" || value === "auto" || value === "tier1") return 1;
  if (value === 3 || value === "3" || value === "hard" || value === "tier3" || value === "permanent") return 3;
  return 2;
}

function normalizeTerminalCmd(value: unknown): ParsedTerminalCmd | null {
  if (!value) return null;
  if (typeof value === "string") return { command: value, tier: 2 };
  if (typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const command = raw.command ?? raw.cmd;
  if (typeof command !== "string" || !command.trim()) return null;
  const reason = raw.reason ?? raw.description;
  return {
    command: command.trim(),
    reason: typeof reason === "string" ? reason : null,
    tier: normalizeTerminalTier(raw.tier ?? raw.confirmationTier ?? raw.confirmation_tier),
  };
}

function normalizeTerminalResult(value: unknown, fallbackCommand?: string): ParsedTerminalResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const command = raw.command ?? fallbackCommand;
  const output = raw.output ?? raw.stdout ?? raw.text ?? "";
  const stderr = raw.stderr;
  const exitCode = raw.exitCode ?? raw.exit_code ?? raw.code;
  const duration = raw.durationMs ?? raw.duration_ms ?? raw.duration;
  const parsedExitCode = typeof exitCode === "number" ? exitCode : typeof exitCode === "string" ? Number(exitCode) : null;
  const parsedDuration = typeof duration === "number" ? duration : typeof duration === "string" ? Number(duration) : 0;
  return {
    command: typeof command === "string" && command.trim() ? command : fallbackCommand ?? "command",
    output: [typeof output === "string" ? output : "", typeof stderr === "string" ? stderr : ""].filter(Boolean).join("\n"),
    exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : null,
    durationMs: Number.isFinite(parsedDuration) ? parsedDuration : 0,
  };
}

async function execTerminalCommand(command: string, projectId?: number, tier?: TerminalTier): Promise<ParsedTerminalResult> {
  const started = Date.now();
  const res = await fetch("/api/terminal/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ command, tier, projectId }),
  });
  const outputChunks: string[] = [];
  let exitCode: number | null = res.ok ? null : res.status;
  let durationMs = Date.now() - started;

  if (!res.body) {
    const text = await res.text().catch(() => "");
    return { command, output: text || `HTTP error: ${res.status}`, exitCode, durationMs };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let evtName = "output";
      let evtData = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) evtName = line.slice(7).trim();
        else if (line.startsWith("data: ")) evtData = line.slice(6);
      }
      if (!evtData) continue;
      let payload: unknown = evtData;
      try { payload = JSON.parse(evtData); } catch {}
      if (evtName === "done") {
        let meta: unknown = payload;
        if (typeof payload === "string") {
          try { meta = JSON.parse(payload); } catch {}
        }
        if (meta && typeof meta === "object") {
          const doneMeta = meta as { exitCode?: number | null; durationMs?: number };
          exitCode = typeof doneMeta.exitCode === "number" ? doneMeta.exitCode : doneMeta.exitCode ?? null;
          durationMs = typeof doneMeta.durationMs === "number" ? doneMeta.durationMs : durationMs;
        }
      } else if (typeof payload === "string") {
        outputChunks.push(payload);
      }
    }
  }

  return { command, output: outputChunks.join(""), exitCode, durationMs };
}

export function InlineTerminalBlock({ terminalCmd, terminalResult, projectId }: { terminalCmd?: unknown; terminalResult?: unknown; projectId?: number }) {
  const cmd = normalizeTerminalCmd(terminalCmd);
  const existingResult = normalizeTerminalResult(terminalResult, cmd?.command);
  const [result, setResult] = useState<ParsedTerminalResult | null>(existingResult);
  const [skipped, setSkipped] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [diffResult, setDiffResult] = useState<ParsedTerminalResult | null>(null);
  const [diffRunning, setDiffRunning] = useState(false);
  const [copied, setCopied] = useState<"output" | "all" | null>(null);

  const copyToClipboard = async (text: string, kind: "output" | "all") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // clipboard unavailable
    }
  };

  const command = result?.command || cmd?.command;
  if (!command) return null;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await execTerminalCommand(command, projectId, cmd?.tier ?? 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed.");
    } finally {
      setRunning(false);
    }
  };

  const showDiff = async () => {
    setDiffRunning(true);
    setError(null);
    try {
      setDiffResult(await execTerminalCommand("git diff"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load diff.");
    } finally {
      setDiffRunning(false);
    }
  };

  const baseStyle: CSSProperties = {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--atlas-surface)",
    border: "1px solid var(--atlas-border)",
    color: "var(--atlas-muted)",
    fontFamily: "var(--app-font-mono)",
    fontSize: 11,
    lineHeight: 1.55,
  };
  const buttonStyle: CSSProperties = {
    borderRadius: 6,
    border: "1px solid var(--atlas-border)",
    background: "var(--atlas-surface)",
    color: "var(--atlas-fg)",
    cursor: "pointer",
    fontFamily: "var(--app-font-mono)",
    fontSize: 10,
    padding: "5px 9px",
  };

  if (skipped) return <div style={{ ...baseStyle, display: "inline-flex", width: "fit-content" }}>Skipped</div>;

  if (result) {
    const ok = result.exitCode === 0;
    const outputText = result.output.trim() || "(no output)";
    const fullText = `$ ${result.command}\n${outputText}\nExit code ${result.exitCode ?? "unknown"} · ${result.durationMs}ms`;
    return (
      <div style={baseStyle}>
        <div style={{ color: "var(--atlas-fg)", marginBottom: 8 }}>○ Atlas ran <code>{result.command}</code></div>
        <pre style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
          {outputText}
        </pre>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ color: ok ? "var(--atlas-phosphor)" : "var(--atlas-ember)" }}>
            {ok ? "✔" : "✕"} Exit code {result.exitCode ?? "unknown"} · {result.durationMs}ms
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => copyToClipboard(outputText, "output")} style={buttonStyle}>
              {copied === "output" ? "Copied" : "Copy output"}
            </button>
            <button type="button" onClick={() => copyToClipboard(fullText, "all")} style={buttonStyle}>
              {copied === "all" ? "Copied" : "Copy all"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cmd) return null;

  if (cmd.tier === 3) {
    return (
      <div style={{ ...baseStyle, border: "1px solid color-mix(in oklab, var(--warning) 45%, var(--atlas-border))" }}>
        <div style={{ color: "var(--warning)", marginBottom: 8 }}>⚠ Atlas wants to make a permanent change</div>
        <pre style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>{cmd.command}</pre>
        {cmd.reason && <div style={{ marginBottom: 8 }}>{cmd.reason}</div>}
        {diffResult && (
          <pre style={{ margin: "0 0 8px", maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
            {diffResult.output.trim() || "(no diff)"}
          </pre>
        )}
        <label style={{ display: "block", marginBottom: 6 }}>Type YES to confirm:</label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, borderRadius: 6, border: "1px solid var(--atlas-border)", background: "var(--atlas-bg)", color: "var(--atlas-fg)", padding: "6px 8px", fontFamily: "var(--app-font-mono)" }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={confirmText !== "YES" || running} onClick={run} style={{ ...buttonStyle, opacity: confirmText === "YES" && !running ? 1 : 0.45 }}>{running ? "Running..." : "Confirm"}</button>
          <button type="button" disabled={diffRunning} onClick={showDiff} style={buttonStyle}>{diffRunning ? "Loading diff..." : "Show diff first"}</button>
          <button type="button" onClick={() => setSkipped(true)} style={buttonStyle}>Cancel</button>
        </div>
        {error && <div style={{ color: "var(--atlas-ember)", marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...baseStyle, border: "1px solid color-mix(in oklab, var(--atlas-gold) 30%, var(--atlas-border))" }}>
      <div style={{ color: "var(--atlas-gold)", marginBottom: 8 }}>⚡ Atlas wants to run a command</div>
      <pre style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>{cmd.command}</pre>
      {cmd.reason && <div style={{ marginBottom: 8 }}>{cmd.reason}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={running} onClick={run} style={buttonStyle}>{running ? "Running..." : "Yes, run it"}</button>
        <button type="button" onClick={() => setSkipped(true)} style={buttonStyle}>No, skip</button>
      </div>
      {error && <div style={{ color: "var(--atlas-ember)", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
