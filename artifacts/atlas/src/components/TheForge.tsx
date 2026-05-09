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

interface ForgeResult {
  nodes: ArchNode[];
  summary: string;
}

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
  const [isForging, setIsForging] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<ForgeResult | null>(null);
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
    setResult(null);
    setError(null);
    startStageAnimation();

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          transcript: transcript.trim(),
          projectName: activeProjectName,
          projectId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Forge failed");
      }

      const data = await res.json() as ForgeResult;
      setResult(data);
      haptics.cardConfirmed();
      sounds.cardConfirmed();
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

  const handlePlaceNodes = () => {
    if (!result) return;
    onNodesReady?.(result.nodes);
    haptics.nodeResolved();
    sounds.nodeResolved();
    onClose();
  };

  const metaBadge = (meta?: string) => {
    if (!meta) return null;
    const colors: Record<string, { bg: string; border: string; color: string }> = {
      must:   { bg: "rgba(212,175,55,0.18)", border: "rgba(212,175,55,0.45)", color: "#D4AF37" },
      should: { bg: "rgba(212,175,55,0.09)", border: "rgba(212,175,55,0.22)", color: "rgba(212,175,55,0.75)" },
      could:  { bg: "rgba(120,113,108,0.10)", border: "rgba(120,113,108,0.28)", color: "rgba(120,113,108,0.75)" },
      wont:   { bg: "rgba(120,113,108,0.07)", border: "rgba(120,113,108,0.18)", color: "rgba(120,113,108,0.5)" },
    };
    const c = colors[meta] || colors.could;
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        padding: "1px 6px", borderRadius: 4,
        background: c.bg, border: `1px solid ${c.border}`, color: c.color,
      }}>
        {meta.toUpperCase()}
      </span>
    );
  };

  const content = (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
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
          rows={isMobile ? 6 : 9}
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
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Summary */}
          <div style={{
            borderRadius: 10, border: "1px solid rgba(212,175,55,0.22)",
            background: "rgba(212,175,55,0.05)", padding: "12px 14px",
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(212,175,55,0.65)", textTransform: "uppercase", marginBottom: 6, fontFamily: "var(--app-font-mono)" }}>
              Forge Summary
            </p>
            <p style={{ fontSize: 12, color: "rgba(231,229,228,0.8)", lineHeight: 1.6, margin: 0 }}>
              {result.summary}
            </p>
          </div>

          {/* Node list */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(120,113,108,0.65)", textTransform: "uppercase", marginBottom: 8, fontFamily: "var(--app-font-mono)" }}>
              {result.nodes.length} Node{result.nodes.length !== 1 ? "s" : ""} Extracted
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.nodes.map(node => (
                <div key={node.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 8,
                  background: "rgba(20,18,14,0.85)",
                  border: "1px solid rgba(212,175,55,0.13)",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, color: node.type === "blocker" ? "rgba(239,100,100,0.8)" : "rgba(212,175,55,0.75)" }}>
                    {({ goal: "◎", requirement: "◈", blocker: "⊗", priority: "◆", decision: "◉", sprint: "△" })[node.type] || "●"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(231,229,228,0.87)", marginBottom: 2 }}>
                      {node.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: "rgba(120,113,108,0.55)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase" }}>
                        {node.type}
                      </span>
                      {metaBadge(node.meta)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Place button */}
          <button
            onClick={handlePlaceNodes}
            style={{
              width: "100%", borderRadius: 12, padding: "13px",
              background: "#D4AF37", fontSize: 13, fontWeight: 700,
              color: "#0D0B09", border: "none", cursor: "pointer",
              boxShadow: "0 0 20px oklch(0.76 0.12 85 / 18%)",
              transition: "box-shadow 150ms",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 30px oklch(0.76 0.12 85 / 30%)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px oklch(0.76 0.12 85 / 18%)"; }}
          >
            Place on Axiom Flow →
          </button>

          <button
            onClick={() => { setResult(null); setTranscript(""); }}
            style={{
              width: "100%", borderRadius: 12, padding: "10px",
              background: "transparent", fontSize: 12, fontWeight: 600,
              color: "rgba(120,113,108,0.65)",
              border: "1px solid rgba(120,113,108,0.2)",
              cursor: "pointer",
            }}
          >
            Start over
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
          {activeProjectName ? `${activeProjectName} · ` : ""}{readinessScore}% ready
          {platform ? ` · ${platform}` : ""}
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
