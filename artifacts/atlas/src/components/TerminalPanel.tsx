import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { useThemeMode } from "@/lib/theme";

type TerminalLine = { text: string; kind: "input" | "output" | "stderr" | "system" | "error" | "warning" | "commentary" };

const TERMINAL_SUCCESS_EXPLANATIONS: { pattern: RegExp; explanation: string }[] = [
  { pattern: /^git\s+status(?:\s|$)/, explanation: "[ATLAS] Shows current branch, staged changes, and untracked files." },
  { pattern: /^git\s+push(?:\s|$)/, explanation: "[ATLAS] Changes pushed to GitHub. Replit will pick up the latest commit." },
  { pattern: /^git\s+commit(?:\s|$)/, explanation: "[ATLAS] Snapshot saved to local git history." },
  { pattern: /^git\s+pull(?:\s|$)/, explanation: "[ATLAS] Latest changes pulled from GitHub into your local branch." },
  { pattern: /^ls(?:\s|$)/, explanation: "[ATLAS] Lists files and folders in the current directory." },
  { pattern: /^pwd(?:\s|$)/, explanation: "[ATLAS] Shows your current location in the file system." },
];

function getTerminalSuccessExplanation(command: string) {
  return TERMINAL_SUCCESS_EXPLANATIONS.find(({ pattern }) => pattern.test(command))?.explanation;
}

export default function TerminalPanel({
  pendingCommand,
  onCommandConsumed,
  onCommandComplete,
  scenarioLens,
}: {
  pendingCommand?: string | null;
  onCommandConsumed?: () => void;
  onCommandComplete?: (command: string, output: string, exitCode: number | null) => void;
  scenarioLens?: boolean;
}) {
  const termTheme = useThemeMode();
  const isParchment = termTheme === "parchment";

  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fromAtlasRef = useRef(false);
  const scenarioBufferRef = useRef("");
  const scenarioPromptRef = useRef("\x1b[93m[scenario]\x1b[0m$ ");

  const [safetyLevel, setSafetyLevel] = useState<"full" | "nuclear">("full");
  const [connected, setConnected] = useState(false);

  // ── GitHub sync state (carried from old TerminalPanel) ────────────────────────────
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncFiles, setSyncFiles] = useState<string[]>([]);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<{ url: string; shortSha: string; filesCommitted: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch("/api/self/modified", { credentials: "include" })
        .then(r => r.ok ? r.json() : { files: [] })
        .then((d: any) => setSyncFiles(d.files ?? []))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  const handlePush = async () => {
    if (syncStatus === "pushing") return;
    setSyncStatus("pushing");
    setSyncError(null);
    setSyncResult(null);
    try {
      const r = await fetch("/api/self/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: syncMsg.trim() || "feat: atlas self-update", files: syncFiles.length > 0 ? syncFiles : undefined }),
      });
      const d = await r.json() as any;
      if (!r.ok) { setSyncStatus("error"); setSyncError(d.error ?? "Push failed"); return; }
      setSyncStatus("done");
      setSyncResult({ url: d.url, shortSha: d.shortSha, filesCommitted: d.filesCommitted });
      setSyncFiles([]);
      setSyncMsg("");
    } catch (err) {
      setSyncStatus("error");
      setSyncError(err instanceof Error ? err.message : "Network error");
    }
  };

  // ── xterm.js theme ─────────────────────────────────────────────────────────────────────────
  const xtermTheme = useMemo(() => isParchment ? {
    foreground: "#2A1A0E",
    background: "#F4EFE6",
    cursor: "#8B3E0E",
    selectionBackground: "rgba(139,62,14,0.15)",
    black: "#2A1A0E", brightBlack: "#5A4A3E",
    red: "#8B1A1A", brightRed: "#B52A2A",
    green: "#2D6E3A", brightGreen: "#3D8E4A",
    yellow: "#8B6E2E", brightYellow: "#A68E3E",
    blue: "#2E5A8B", brightBlue: "#4E7AB0",
    magenta: "#8B2E6E", brightMagenta: "#A64E8E",
    cyan: "#2E6E7A", brightCyan: "#4E8E9A",
    white: "#F4EFE6", brightWhite: "#FAF5EC",
  } : {
    foreground: "#E7E5E4",
    background: "#0A0908",
    cursor: "#C9A24C",
    selectionBackground: "rgba(201,162,76,0.15)",
    black: "#0A0908", brightBlack: "#4A4542",
    red: "#DC2626", brightRed: "#EF4444",
    green: "#22C55E", brightGreen: "#4ADE80",
    yellow: "#C9A24C", brightYellow: "#FACC15",
    blue: "#3B82F6", brightBlue: "#60A5FA",
    magenta: "#D946EF", brightMagenta: "#E879F9",
    cyan: "#06B6D4", brightCyan: "#22D3EE",
    white: "#E7E5E4", brightWhite: "#FAFAF9",
  }, [isParchment]);

  // ── Initialize xterm.js ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!terminalRef.current) return;
    // Dispose old instance if re-creating for theme change
    if (termInstanceRef.current) {
      termInstanceRef.current.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
    }

    const term = new Terminal({
      fontFamily: "var(--app-font-mono, monospace)",
      fontSize: 12,
      theme: xtermTheme,
      cursorBlink: true,
      cursorStyle: "block",
      rows: 30,
      cols: 120,
      allowTransparency: false,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    if (scenarioLens) {
      term.write("\r\n\x1b[96mAtlas Scenario Terminal\x1b[0m \u2014 Commands are explained, not executed.\r\n\r\n");
      term.write(scenarioPromptRef.current);
    }

    const resizeHandler = () => {
      try { fitAddon.fit(); } catch {}
      if (!scenarioLens && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", resizeHandler);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParchment]);

  // ── WebSocket connection (build mode only) ───────────────────────────────────────────────
  useEffect(() => {
    if (scenarioLens) return;
    const term = termInstanceRef.current;
    if (!term) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" || msg.type === "ready") {
          term.write(msg.text ?? "");
        } else if (msg.type === "exec-done") {
          if (fromAtlasRef.current && onCommandComplete) {
            onCommandComplete(msg.command, msg.output?.slice(0, 4000) ?? "", msg.exitCode ?? 0);
          }
          fromAtlasRef.current = false;
        } else if (msg.type === "error") {
          term.write(`\r\n\x1b[91m[Error] ${msg.text}\x1b[0m\r\n`);
        } else if (msg.type === "exit") {
          setConnected(false);
        } else if (msg.type === "status") {
          term.write(`\r\n\x1b[93m[${msg.text}]\x1b[0m\r\n`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[91m[Connection error]\x1b[0m\r\n");
    };

    // Wire xterm input to WebSocket with smart copy/paste
    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Custom key handler: Ctrl+C copy when selection exists, otherwise send Ctrl+C (SIGINT)
    const handleCustomKey = term.onKey((e) => {
      const isCopy = (e.domEvent.ctrlKey || e.domEvent.metaKey) && e.domEvent.key === "c";
      const isPaste = (e.domEvent.ctrlKey || e.domEvent.metaKey) && e.domEvent.key === "v";
      if (isCopy && term.hasSelection()) {
        e.domEvent.preventDefault();
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        return;
      }
      if (isPaste) {
        e.domEvent.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data: text }));
          }
        }).catch(() => {});
        return;
      }
    });

    return () => {
      disposable.dispose();
      handleCustomKey.dispose();
      ws.close();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioLens, isParchment]);

  // ── Scenario mode keyboard handler ────────────────────────────────────────────────
  useEffect(() => {
    if (!scenarioLens) return;
    const term = termInstanceRef.current;
    if (!term) return;

    const disposable = term.onData((data) => {
      // Backspace / DEL
      if (data === "\x7f" || data === "\b") {
        if (scenarioBufferRef.current.length > 0) {
          scenarioBufferRef.current = scenarioBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }
      // Enter
      if (data === "\r") {
        const cmd = scenarioBufferRef.current.trim();
        scenarioBufferRef.current = "";
        term.write("\r\n");
        if (cmd) {
          runExplain(cmd);
        } else {
          term.write(scenarioPromptRef.current);
        }
        return;
      }
      // Ctrl+C
      if (data === "\x03") {
        scenarioBufferRef.current = "";
        term.write("^C\r\n" + scenarioPromptRef.current);
        return;
      }
      // Regular char
      scenarioBufferRef.current += data;
      term.write(data);
    });

    return () => { disposable.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioLens, isParchment]);

  async function runExplain(cmd: string) {
    const term = termInstanceRef.current;
    if (!term) return;
    term.write("\x1b[90mAsking Atlas what this would do\u2026\x1b[0m\r\n");
    try {
      const r = await fetch("/api/terminal/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ command: cmd }),
      });
      const d = await r.json() as { explanation?: string; error?: string };
      if (d.explanation) {
        term.write(`\x1b[96m[ATLAS EXPLAINS] ${d.explanation}\x1b[0m\r\n\r\n`);
      } else {
        term.write(`\x1b[91m[Error] ${d.error ?? "Could not generate explanation"}\x1b[0m\r\n\r\n`);
      }
    } catch (err) {
      term.write(`\x1b[91m[Error] ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n\r\n`);
    }
    term.write(scenarioPromptRef.current);
  }

  // ── Fetch safety level ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/terminal/safety", { credentials: "include" })
      .then(r => r.ok ? r.json() : { safety: "full" })
      .then((d: any) => setSafetyLevel(d.safety ?? "full"))
      .catch(() => {});
  }, []);

  // ── Toggle safety ──────────────────────────────────────────────────────────────────────────────────
  const toggleSafety = useCallback(() => {
    const newLevel = safetyLevel === "full" ? "nuclear" : "full";
    setSafetyLevel(newLevel);
    fetch("/api/terminal/safety", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ safety: newLevel }),
    }).catch(() => {});
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "safety", safety: newLevel }));
    }
  }, [safetyLevel]);

  // ── Handle pending command from Atlas ──────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingCommand || !termInstanceRef.current) return;
    fromAtlasRef.current = true;
    const term = termInstanceRef.current;

    if (scenarioLens) {
      term.write(`\r\n${scenarioPromptRef.current}${pendingCommand}\r\n`);
      runExplain(pendingCommand);
      onCommandConsumed?.();
    } else {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "exec",
          command: pendingCommand,
          timeout: 30000,
        }));
      } else {
        term.write(`\r\n\x1b[91m[Not connected to terminal]\x1b[0m\r\n`);
      }
      onCommandConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand, scenarioLens]);

  // ── Theme colors for non-xterm UI ──────────────────────────────────────────────────────────
  const termBg = isParchment ? "#F4EFE6" : "#0A0908";
  const termBorder = isParchment ? "rgba(160,130,90,0.28)" : "var(--atlas-surface)";
  const termFgText = isParchment ? "#2A1A0E" : "var(--atlas-fg)";
  const safetyColor = safetyLevel === "full" ? "#4ade80" : "var(--atlas-gold)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: termBg, overflow: "hidden" }}>
      {/* ── GitHub sync bar ──────────────────────────────────────────────────────── */}
      {!scenarioLens && (
        <div style={{ borderBottom: `1px solid ${termBorder}`, flexShrink: 0 }}>
          <button
            onClick={() => { setSyncOpen(o => !o); setSyncStatus("idle"); setSyncError(null); setSyncResult(null); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 7,
              padding: "7px 13px", background: "transparent", border: "none",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
              <path d="M5.5 1v9M1 5.5l4.5-4.5 4.5 4.5" stroke={isParchment ? "#8B5E3C" : "rgba(201,162,76,0.7)"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.1em", color: isParchment ? "#8B5E3C" : "rgba(201,162,76,0.7)", textTransform: "uppercase" }}>
              Sync to GitHub
            </span>
            {syncFiles.length > 0 && (
              <span style={{
                marginLeft: "auto", padding: "1px 6px", borderRadius: 3,
                background: "rgba(201,162,76,0.12)", border: "0.5px solid rgba(201,162,76,0.3)",
                fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "var(--atlas-gold)",
              }}>
                {syncFiles.length} modified
              </span>
            )}
            {syncStatus === "done" && syncResult && (
              <span style={{
                marginLeft: "auto", padding: "1px 6px", borderRadius: 3,
                background: "rgba(52,211,153,0.08)", border: "0.5px solid rgba(52,211,153,0.25)",
                fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "#34d399",
              }}>
                ✓ {syncResult.shortSha}
              </span>
            )}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: syncFiles.length > 0 || (syncStatus === "done" && syncResult) ? 6 : "auto", flexShrink: 0, transform: syncOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>
              <path d="M1 2.5l3 3 3-3" stroke={isParchment ? "#8B5E3C" : "rgba(201,162,76,0.5)"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {syncOpen && (
            <div style={{ padding: "0 13px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {syncFiles.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {syncFiles.map(f => (
                    <div key={f} style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: isParchment ? "rgba(100,70,40,0.7)" : "rgba(var(--atlas-muted-rgb),0.7)", letterSpacing: "0.04em", padding: "2px 0" }}>
                      · {f}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: isParchment ? "rgba(100,70,40,0.5)" : "rgba(var(--atlas-muted-rgb),0.45)", letterSpacing: "0.05em" }}>
                  No tracked edits yet — Atlas writes files here when it self-updates.
                </div>
              )}
              <input
                value={syncMsg}
                onChange={e => setSyncMsg(e.target.value)}
                placeholder="Commit message (optional)"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  background: isParchment ? "rgba(240,228,210,0.6)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${termBorder}`, borderRadius: 5, padding: "6px 9px",
                  fontFamily: "var(--app-font-mono)", fontSize: 10.5,
                  color: termFgText, outline: "none",
                }}
              />
              {syncStatus === "error" && syncError && (
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "rgba(252,100,100,0.88)", lineHeight: 1.5 }}>
                  ✗ {syncError}
                </div>
              )}
              {syncStatus === "done" && syncResult && (
                <a href={syncResult.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "#34d399", letterSpacing: "0.04em", textDecoration: "none" }}
                >
                  ✓ {syncResult.filesCommitted} file{syncResult.filesCommitted !== 1 ? "s" : ""} pushed · {syncResult.shortSha} →
                </a>
              )}
              <button
                onClick={handlePush}
                disabled={syncStatus === "pushing" || syncFiles.length === 0}
                style={{
                  padding: "7px", borderRadius: 5,
                  background: syncFiles.length === 0 ? "transparent" : "rgba(146,64,14,0.22)",
                  border: `1px solid ${syncFiles.length === 0 ? termBorder : "rgba(146,64,14,0.4)"}`,
                  color: syncFiles.length === 0 ? "rgba(var(--atlas-muted-rgb),0.4)" : "rgba(230,150,90,0.9)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em",
                  textTransform: "uppercase", cursor: syncFiles.length === 0 ? "not-allowed" : "pointer",
                  transition: "all 160ms ease",
                }}
              >
                {syncStatus === "pushing" ? "Pushing…" : "Push to GitHub"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 13px", flexShrink: 0,
        borderBottom: `1px solid ${termBorder}`,
        background: isParchment ? "rgba(240,228,210,0.5)" : "var(--atlas-bg)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: scenarioLens ? "#a78bfa" : connected ? "#4ade80" : "#ef4444",
            display: "inline-block",
            boxShadow: scenarioLens ? "0 0 5px rgba(167,139,250,0.6)" : connected ? "0 0 5px rgba(74,222,128,0.6)" : "none",
          }} />
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: isParchment ? "#8B5E3C" : "rgba(201,162,76,0.7)", letterSpacing: "0.08em" }}>
            {scenarioLens ? "SCENARIO MODE" : connected ? "LIVE SHELL" : "DISCONNECTED"}
          </span>
        </div>

        {!scenarioLens && (
          <button
            onClick={toggleSafety}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 4,
              background: "transparent",
              border: `1px solid ${safetyColor}`,
              color: safetyColor,
              fontFamily: "var(--app-font-mono)", fontSize: 9.5,
              letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span style={{
              width: 14, height: 7, borderRadius: 3.5,
              background: safetyColor, opacity: 0.3,
              position: "relative", display: "inline-block",
            }}>
              <span style={{
                position: "absolute", top: 0.5,
                width: 6, height: 6, borderRadius: "50%",
                background: safetyColor,
                left: safetyLevel === "full" ? 1 : 7,
                transition: "left 160ms ease",
              }} />
            </span>
            {safetyLevel === "full" ? "Safety ON" : "Safety OFF"}
          </button>
        )}
      </div>

      {/* ── xterm.js container ────────────────────────────────────────────────────────────────────────────────────── */}
      <div ref={terminalRef} style={{ flex: 1, overflow: "hidden", padding: "2px 0" }} />
    </div>
  );
}
