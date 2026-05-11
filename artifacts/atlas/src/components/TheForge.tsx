import { useState, useRef, useEffect } from "react";
import { haptics } from "@/lib/haptics";
import { sounds } from "@/lib/sounds";
import type { ArchNode } from "./AxiomFlow";

const FORGE_STAGES = [
  "Reading intent...",
  "Identifying blockers...",
  "Mapping priorities...",
  "Placing nodes...",
];

const PLATFORMS = [
  { id: "Replit", label: "Replit" },
  { id: "Cursor", label: "Cursor" },
  { id: "Lovable", label: "Lovable" },
  { id: "Bolt", label: "Bolt" },
  { id: "v0", label: "v0" },
  { id: "Claude", label: "Claude" },
];

interface Props {
  platform?: string;
  readinessScore?: number;
  activeProjectName?: string;
  projectId?: number;
  onClose: () => void;
  onNodesReady?: (nodes: ArchNode[]) => void;
}

export function TheForge({ platform, readinessScore = 0, activeProjectName, projectId, onClose, onNodesReady }: Props) {
  const [isMobile] = useState(() => window.innerWidth < 768);
  const [tab, setTab] = useState<"forge" | "prompt">("forge");

  // Forge state
  const [transcript, setTranscript] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [isForging, setIsForging] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Quick Prompt state
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORMS[0].id);
  const [promptDesc, setPromptDesc] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [showFilePane, setShowFilePane] = useState(false);
  const [projectMap, setProjectMap] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load project map from localStorage when projectId is available
  useEffect(() => {
    if (!projectId) return;
    try {
      const raw = localStorage.getItem(`atlas-scan-${projectId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lines = typeof parsed === "string"
          ? parsed
          : (parsed?.summary ?? parsed?.routes ?? JSON.stringify(parsed, null, 2));
        if (typeof lines === "string" && lines.trim()) setProjectMap(lines);
      }
    } catch { /* silent */ }
  }, [projectId]);

  // ── Forge logic ────────────────────────────────────────────────────────────
  const canForge = transcript.trim().length > 10 && !isForging;

  const startStageAnimation = () => {
    setStageIdx(0);
    let idx = 0;
    stageTimerRef.current = setInterval(() => {
      idx = (idx + 1) % FORGE_STAGES.length;
      setStageIdx(idx);
    }, 900);
  };

  const stopStageAnimation = () => {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };

  const handleForge = async () => {
    if (!canForge) return;
    setIsForging(true);
    setForgeError(null);
    startStageAnimation();
    abortRef.current = new AbortController();
    try {
      const body: Record<string, unknown> = { transcript: transcript.trim(), projectId };
      if (projectContext.trim()) body.projectContext = projectContext.trim();
      const res = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Forge failed");
      }
      const data = await res.json() as { nodes: ArchNode[]; summary: string };
      haptics.cardConfirmed();
      sounds.cardConfirmed();
      onNodesReady?.(data.nodes);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setForgeError("The Forge couldn't process this. Try a more specific description.");
    } finally {
      stopStageAnimation();
      setIsForging(false);
    }
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    stopStageAnimation();
    setIsForging(false);
  };

  // ── Quick Prompt logic ─────────────────────────────────────────────────────
  const canGenerate = promptDesc.trim().length > 5 && !isGenerating;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setPromptError(null);
    setGeneratedPrompt("");
    setCopied(false);
    try {
      const body: Record<string, unknown> = {
        description: promptDesc.trim(),
        builder: selectedPlatform,
      };
      if (filePath.trim()) body.filePath = filePath.trim();
      if (fileContent.trim()) body.fileContent = fileContent.trim();
      if (projectMap) body.projectMap = projectMap;
      const res = await fetch("/api/quick-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Generation failed");
      const text = await res.text();
      setGeneratedPrompt(text);
    } catch {
      setPromptError("Generation failed — try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const tabBtn = (active: boolean) => ({
    flex: 1,
    padding: "7px 0",
    borderRadius: 7,
    border: "none",
    background: active ? "rgba(212,175,55,0.14)" : "transparent",
    color: active ? "#D4AF37" : "rgba(120,113,108,0.6)",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    fontFamily: "var(--app-font-mono)",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    transition: "all 180ms",
  });

  // ── Tab: Forge ─────────────────────────────────────────────────────────────
  const forgeContent = (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ borderRadius: 10, background: "rgba(212,175,55,0.05)", border: "1px solid rgba(212,175,55,0.12)", padding: "12px 14px" }}>
        <p style={{ fontSize: 12, color: "rgba(212,175,55,0.75)", lineHeight: 1.6, margin: 0 }}>
          Paste a raw transcript, voice note, brain dump, or strategy doc. The Forge reads intent, extracts goals, requirements, and blockers — then places them on your Axiom Flow.
        </p>
      </div>

      <div>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", marginBottom: 8, fontFamily: "var(--app-font-mono)" }}>
          Transcript / Brain Dump
        </p>
        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          placeholder={`Paste anything — a voice note transcript, a product spec, a messy doc, a Notion page dump...\n\nThe Forge will extract what matters and map it to your strategic flow.`}
          rows={isMobile ? 6 : 8}
          style={{
            width: "100%", borderRadius: 12,
            border: `1px solid ${transcript.length > 10 ? "rgba(212,175,55,0.35)" : "rgba(212,175,55,0.18)"}`,
            background: "oklch(0.14 0.01 60)",
            padding: "12px 14px",
            color: "rgba(231,229,228,0.87)", fontSize: 13, lineHeight: 1.65,
            outline: "none", resize: "none", transition: "border-color 180ms",
            boxSizing: "border-box" as const, fontFamily: "inherit",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.55)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = transcript.length > 10 ? "rgba(212,175,55,0.35)" : "rgba(212,175,55,0.18)"; }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "rgba(120,113,108,0.4)", fontFamily: "var(--app-font-mono)" }}>
            {transcript.length} chars
          </span>
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowContext(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            color: showContext ? "rgba(212,175,55,0.75)" : "rgba(120,113,108,0.55)",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
            fontFamily: "var(--app-font-mono)", textTransform: "uppercase",
            padding: 0, transition: "color 180ms",
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>{showContext ? "▾" : "▸"}</span>
          {showContext ? "Hide project context" : "Add project context (optional)"}
        </button>

        {showContext && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 11, color: "rgba(120,113,108,0.55)", marginBottom: 8, lineHeight: 1.5 }}>
              Give The Forge more signal — paste your current decisions, tech stack, or project goals so nodes are more precisely typed and prioritized.
              {activeProjectName && <span style={{ color: "rgba(212,175,55,0.55)" }}> Project: <strong>{activeProjectName}</strong></span>}
              {platform && <span style={{ color: "rgba(212,175,55,0.45)" }}> · Stack: <strong>{platform}</strong></span>}
            </p>
            <textarea
              value={projectContext}
              onChange={e => setProjectContext(e.target.value)}
              placeholder="e.g. We're building a founder OS in React/Express/Postgres. Current committed decisions: auth via Clerk, no mobile for v1, must ship by end of month..."
              rows={4}
              style={{
                width: "100%", borderRadius: 10,
                border: "1px solid rgba(212,175,55,0.18)",
                background: "oklch(0.13 0.01 60)",
                padding: "10px 12px",
                color: "rgba(231,229,228,0.75)", fontSize: 12, lineHeight: 1.6,
                outline: "none", resize: "none", transition: "border-color 180ms",
                boxSizing: "border-box" as const, fontFamily: "inherit",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.35)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.18)"; }}
            />
          </div>
        )}
      </div>

      <button
        onClick={isForging ? handleAbort : handleForge}
        style={{
          width: "100%", borderRadius: 12,
          background: isForging ? "rgba(212,175,55,0.08)" : canForge ? "#D4AF37" : "rgba(212,175,55,0.10)",
          padding: "14px", fontSize: 14, fontWeight: 700,
          color: isForging ? "rgba(212,175,55,0.65)" : canForge ? "#0D0B09" : "rgba(212,175,55,0.35)",
          border: isForging ? "1px solid rgba(212,175,55,0.25)" : "none",
          cursor: isForging || canForge ? "pointer" : "not-allowed",
          transition: "all 180ms",
          boxShadow: canForge && !isForging ? "0 0 20px oklch(0.76 0.12 85 / 15%)" : "none",
        }}
      >
        {isForging ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#D4AF37", animation: "forge-pulse 1.4s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, letterSpacing: "0.04em" }}>{FORGE_STAGES[stageIdx]}</span>
          </span>
        ) : "Run The Forge →"}
      </button>

      {forgeError && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", padding: "12px 14px", fontSize: 12, color: "rgba(239,100,100,0.9)", lineHeight: 1.5 }}>
          {forgeError}
          <button onClick={handleForge} style={{ display: "block", marginTop: 8, background: "none", border: "none", color: "rgba(212,175,55,0.75)", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}>Try again →</button>
        </div>
      )}
    </div>
  );

  // ── Tab: Quick Prompt ──────────────────────────────────────────────────────
  const isCursor = selectedPlatform === "Cursor";

  const quickPromptContent = (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Context badge — shows when project map loaded */}
      {projectMap && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.14)" }}>
          <span style={{ fontSize: 9, color: "rgba(212,175,55,0.6)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" }}>⬡ Codebase context loaded</span>
        </div>
      )}

      {/* Platform picker */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", marginBottom: 10, fontFamily: "var(--app-font-mono)" }}>
          Platform
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPlatform(p.id)}
              style={{
                padding: "6px 14px", borderRadius: 20,
                border: `1px solid ${selectedPlatform === p.id ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.18)"}`,
                background: selectedPlatform === p.id ? "rgba(212,175,55,0.14)" : "transparent",
                color: selectedPlatform === p.id ? "#D4AF37" : "rgba(120,113,108,0.65)",
                fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", transition: "all 150ms",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Intent */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", marginBottom: 8, fontFamily: "var(--app-font-mono)" }}>
          What do you want to build?
        </p>
        <textarea
          value={promptDesc}
          onChange={e => setPromptDesc(e.target.value)}
          placeholder={isCursor
            ? "e.g. Add a dismiss button to the catch card that clears it without logging a decision. It should appear in the top-right corner."
            : "e.g. Add a settings panel to the workspace that lets users update their name and avatar. It should slide in from the right and auto-save on blur."}
          rows={isMobile ? 4 : 5}
          style={{
            width: "100%", borderRadius: 12,
            border: `1px solid ${promptDesc.length > 5 ? "rgba(212,175,55,0.35)" : "rgba(212,175,55,0.18)"}`,
            background: "oklch(0.14 0.01 60)",
            padding: "12px 14px",
            color: "rgba(231,229,228,0.87)", fontSize: 13, lineHeight: 1.65,
            outline: "none", resize: "none", transition: "border-color 180ms",
            boxSizing: "border-box" as const, fontFamily: "inherit",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.55)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = promptDesc.length > 5 ? "rgba(212,175,55,0.35)" : "rgba(212,175,55,0.18)"; }}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
        />
      </div>

      {/* File context — collapsible, especially useful for Cursor */}
      <div>
        <button
          onClick={() => setShowFilePane(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            color: showFilePane ? "rgba(212,175,55,0.8)" : "rgba(120,113,108,0.55)",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
            fontFamily: "var(--app-font-mono)", textTransform: "uppercase",
            padding: 0, transition: "color 180ms",
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>{showFilePane ? "▾" : "▸"}</span>
          {isCursor ? "Add file — makes prompt surgical (recommended)" : "Add file context (optional)"}
        </button>

        {showFilePane && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* File path */}
            <div>
              <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(120,113,108,0.6)", textTransform: "uppercase", marginBottom: 6, fontFamily: "var(--app-font-mono)" }}>
                File path
              </p>
              <input
                type="text"
                value={filePath}
                onChange={e => setFilePath(e.target.value)}
                placeholder="e.g. artifacts/atlas/src/components/CatchCard.tsx"
                style={{
                  width: "100%", borderRadius: 8,
                  border: "1px solid rgba(212,175,55,0.18)",
                  background: "oklch(0.13 0.01 60)",
                  padding: "8px 12px",
                  color: "rgba(231,229,228,0.8)", fontSize: 12, lineHeight: 1.5,
                  outline: "none", fontFamily: "var(--app-font-mono)",
                  boxSizing: "border-box" as const,
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.4)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.18)"; }}
              />
            </div>

            {/* File content paste */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(120,113,108,0.6)", textTransform: "uppercase", margin: 0, fontFamily: "var(--app-font-mono)" }}>
                  Paste file content
                </p>
                {fileContent && (
                  <span style={{ fontSize: 9, color: "rgba(212,175,55,0.5)", fontFamily: "var(--app-font-mono)" }}>
                    {fileContent.length.toLocaleString()} chars
                  </span>
                )}
              </div>
              <textarea
                value={fileContent}
                onChange={e => setFileContent(e.target.value)}
                placeholder={"Paste the full file here. Atlas will quote exact lines so Cursor knows precisely where to edit."}
                rows={isMobile ? 6 : 8}
                style={{
                  width: "100%", borderRadius: 10,
                  border: `1px solid ${fileContent ? "rgba(212,175,55,0.28)" : "rgba(212,175,55,0.15)"}`,
                  background: "oklch(0.12 0.01 60)",
                  padding: "10px 12px",
                  color: "rgba(231,229,228,0.75)", fontSize: 11, lineHeight: 1.6,
                  outline: "none", resize: "none", transition: "border-color 180ms",
                  boxSizing: "border-box" as const, fontFamily: "var(--app-font-mono)",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(212,175,55,0.45)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = fileContent ? "rgba(212,175,55,0.28)" : "rgba(212,175,55,0.15)"; }}
              />
              {isCursor && (
                <p style={{ fontSize: 9.5, color: "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)", marginTop: 5, lineHeight: 1.5 }}>
                  With this, Atlas quotes exact lines — Cursor needs zero clarification.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        style={{
          width: "100%", borderRadius: 12,
          background: isGenerating ? "rgba(212,175,55,0.08)" : canGenerate ? "#D4AF37" : "rgba(212,175,55,0.10)",
          padding: "14px", fontSize: 14, fontWeight: 700,
          color: isGenerating ? "rgba(212,175,55,0.65)" : canGenerate ? "#0D0B09" : "rgba(212,175,55,0.35)",
          border: isGenerating ? "1px solid rgba(212,175,55,0.25)" : "none",
          cursor: canGenerate ? "pointer" : "not-allowed",
          transition: "all 180ms",
          boxShadow: canGenerate && !isGenerating ? "0 0 20px oklch(0.76 0.12 85 / 15%)" : "none",
        }}
      >
        {isGenerating ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#D4AF37", animation: "forge-pulse 1.4s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, letterSpacing: "0.04em" }}>
              {isCursor && fileContent ? "Reading file & writing prompt…" : `Generating for ${selectedPlatform}…`}
            </span>
          </span>
        ) : `Generate ${selectedPlatform} Prompt →`}
      </button>

      {promptError && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", padding: "12px 14px", fontSize: 12, color: "rgba(239,100,100,0.9)" }}>
          {promptError}
        </div>
      )}

      {/* Generated output */}
      {generatedPrompt && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "rgba(120,113,108,0.75)", textTransform: "uppercase", fontFamily: "var(--app-font-mono)" }}>
              {selectedPlatform} Prompt
            </span>
            <button
              onClick={handleCopy}
              style={{
                padding: "4px 12px", borderRadius: 6,
                border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : "rgba(212,175,55,0.3)"}`,
                background: copied ? "rgba(34,197,94,0.1)" : "rgba(212,175,55,0.08)",
                color: copied ? "rgba(134,239,172,0.9)" : "rgba(212,175,55,0.8)",
                fontSize: 10, fontWeight: 700, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", transition: "all 180ms", letterSpacing: "0.08em",
              }}
            >
              {copied ? "COPIED ✓" : "COPY"}
            </button>
          </div>
          <pre
            style={{
              margin: 0, padding: "14px", borderRadius: 10,
              background: "oklch(0.12 0.01 60)",
              border: "1px solid rgba(212,175,55,0.22)",
              color: "rgba(231,229,228,0.87)", fontSize: 12, lineHeight: 1.75,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "var(--app-font-mono)",
              maxHeight: 320, overflowY: "auto",
            }}
          >
            {generatedPrompt}
          </pre>
        </div>
      )}
    </div>
  );

  // ── Header ─────────────────────────────────────────────────────────────────
  const headerBlock = (
    <div style={{ flexShrink: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px 10px",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.06em", fontFamily: "var(--app-font-mono)" }}>
            {tab === "forge" ? "THE FORGE" : "QUICK PROMPT"}
          </span>
          <span style={{ fontSize: 10, color: "rgba(120,113,108,0.6)" }}>
            {tab === "forge"
              ? `Decompose your thinking into a strategic map${activeProjectName ? ` · ${activeProjectName}` : ""}${readinessScore > 0 ? ` · ${readinessScore}% ready` : ""}`
              : "Generate a ready-to-paste prompt for any AI builder"}
          </span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.55)", fontSize: 22, lineHeight: 1, padding: "2px 0 2px 4px" }}>×</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "0 16px 12px", borderBottom: "1px solid rgba(212,175,55,0.10)" }}>
        <button style={tabBtn(tab === "forge")} onClick={() => setTab("forge")}>The Forge</button>
        <button style={tabBtn(tab === "prompt")} onClick={() => setTab("prompt")}>Quick Prompt</button>
      </div>
    </div>
  );

  if (!isMobile) {
    return (
      <>
        <style>{`@keyframes forge-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.7); } }`}</style>
        <div style={{ display: "flex", flexDirection: "column", background: "rgba(13,11,9,0.99)", border: "1px solid rgba(212,175,55,0.22)", borderRadius: 12, height: "100%", overflow: "hidden" }}>
          {headerBlock}
          {tab === "forge" ? forgeContent : quickPromptContent}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes forge-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.7); } }`}</style>
      <div style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "fixed", left: 0, right: 0, top: 0, bottom: 0, zIndex: 360, background: "rgba(13,11,9,0.99)", border: "1px solid rgba(212,175,55,0.22)", borderRadius: "16px 16px 0 0", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(212,175,55,0.18)" }} />
        </div>
        {headerBlock}
        {tab === "forge" ? forgeContent : quickPromptContent}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid rgba(212,175,55,0.07)", flexShrink: 0 }}>
          <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 16px", borderRadius: 20, background: "rgba(120,113,108,0.09)", border: "1px solid rgba(120,113,108,0.2)", color: "rgba(120,113,108,0.75)", fontSize: 12, cursor: "pointer", fontFamily: "var(--app-font-mono)" }}>‹ Back</button>
          <span style={{ fontSize: 10, color: "rgba(120,113,108,0.35)", fontFamily: "var(--app-font-mono)" }}>AXIOM // {tab === "forge" ? "THE FORGE" : "QUICK PROMPT"}</span>
        </div>
      </div>
    </>
  );
}
