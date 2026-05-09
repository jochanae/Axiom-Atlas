import { useState, useRef } from "react";
import { haptics } from "@/lib/haptics";
import { sounds } from "@/lib/sounds";
import type { ArchNode } from "./AxiomFlow";

const FORGE_STAGES = [
  "Reading intent...",
  "Identifying blockers...",
  "Mapping priorities...",
  "Placing nodes...",
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
  const [transcript, setTranscript] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [isForging, setIsForging] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setError(null);
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

      // Auto-close and immediately place nodes on map
      onNodesReady?.(data.nodes);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("The Forge couldn't process this. Try a more specific description.");
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

  const content = (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Explainer */}
      <div style={{ borderRadius: 10, background: "rgba(212,175,55,0.05)", border: "1px solid rgba(212,175,55,0.12)", padding: "12px 14px" }}>
        <p style={{ fontSize: 12, color: "rgba(212,175,55,0.75)", lineHeight: 1.6, margin: 0 }}>
          Paste a raw transcript, voice note, brain dump, or strategy doc. The Forge reads intent, extracts goals, requirements, and blockers — then places them on your Axiom Flow.
        </p>
      </div>

      {/* Transcript input */}
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

      {/* Optional project context */}
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
              {activeProjectName && (
                <span style={{ color: "rgba(212,175,55,0.55)" }}> Project: <strong>{activeProjectName}</strong></span>
              )}
              {platform && (
                <span style={{ color: "rgba(212,175,55,0.45)" }}> · Stack: <strong>{platform}</strong></span>
              )}
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

      {/* Forge button */}
      <button
        onClick={isForging ? handleAbort : handleForge}
        style={{
          width: "100%", borderRadius: 12,
          background: isForging
            ? "rgba(212,175,55,0.08)"
            : canForge
              ? "#D4AF37"
              : "rgba(212,175,55,0.10)",
          padding: "14px", fontSize: 14, fontWeight: 700,
          color: isForging
            ? "rgba(212,175,55,0.65)"
            : canForge
              ? "#0D0B09"
              : "rgba(212,175,55,0.35)",
          border: isForging ? "1px solid rgba(212,175,55,0.25)" : "none",
          cursor: isForging || canForge ? "pointer" : "not-allowed",
          transition: "all 180ms",
          boxShadow: canForge && !isForging ? "0 0 20px oklch(0.76 0.12 85 / 15%)" : "none",
        }}
      >
        {isForging ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%",
              background: "#D4AF37",
              animation: "forge-pulse 1.4s ease-in-out infinite",
            }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, letterSpacing: "0.04em" }}>
              {FORGE_STAGES[stageIdx]}
            </span>
          </span>
        ) : "Run The Forge →"}
      </button>

      {error && (
        <div style={{
          borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)",
          background: "rgba(239,68,68,0.06)", padding: "12px 14px",
          fontSize: 12, color: "rgba(239,100,100,0.9)", lineHeight: 1.5,
        }}>
          {error}
          <button
            onClick={handleForge}
            style={{ display: "block", marginTop: 8, background: "none", border: "none", color: "rgba(212,175,55,0.75)", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}
          >
            Try again →
          </button>
        </div>
      )}
    </div>
  );

  const headerBlock = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 16px",
      borderBottom: "1px solid rgba(212,175,55,0.10)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.06em", fontFamily: "var(--app-font-mono)" }}>
          THE FORGE
        </span>
        <span style={{ fontSize: 10, color: "rgba(120,113,108,0.6)" }}>
          Decompose your thinking into a strategic map
          {activeProjectName ? ` · ${activeProjectName}` : ""}
          {readinessScore > 0 ? ` · ${readinessScore}% ready` : ""}
        </span>
      </div>
      <button
        onClick={onClose}
        style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.55)", fontSize: 22, lineHeight: 1, padding: "2px 0 2px 4px" }}
      >×</button>
    </div>
  );

  if (!isMobile) {
    return (
      <>
        <style>{`@keyframes forge-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.7); } }`}</style>
        <div style={{
          display: "flex", flexDirection: "column",
          background: "rgba(13,11,9,0.99)",
          border: "1px solid rgba(212,175,55,0.22)",
          borderRadius: 12,
          height: "100%",
          overflow: "hidden",
        }}>
          {headerBlock}
          {content}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes forge-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.7); } }`}</style>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div style={{
        position: "fixed", left: 0, right: 0, top: 0, bottom: 0, zIndex: 360,
        background: "rgba(13,11,9,0.99)",
        border: "1px solid rgba(212,175,55,0.22)",
        borderRadius: "16px 16px 0 0",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(212,175,55,0.18)" }} />
        </div>
        {headerBlock}
        {content}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderTop: "1px solid rgba(212,175,55,0.07)",
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "8px 16px", borderRadius: 20,
              background: "rgba(120,113,108,0.09)", border: "1px solid rgba(120,113,108,0.2)",
              color: "rgba(120,113,108,0.75)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--app-font-mono)",
            }}
          >
            ‹ Back
          </button>
          <span style={{ fontSize: 10, color: "rgba(120,113,108,0.35)", fontFamily: "var(--app-font-mono)" }}>
            AXIOM // THE FORGE
          </span>
        </div>
      </div>
    </>
  );
}
