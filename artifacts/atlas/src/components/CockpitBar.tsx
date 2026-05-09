import { useState, type ReactNode } from "react";
import type { ArchNode } from "./AxiomFlow";

interface CockpitBarProps {
  readinessScore: number;
  nodes: ArchNode[];
  onHomeNav?: () => void;
  onAxiomOpen?: () => void;
  navLeft?: ReactNode;
  navRight?: ReactNode;
  showReadinessStrip?: boolean;
}

function AxiomLogoSVG() {
  return (
    <svg viewBox="0 0 512 512" width="44" height="44">
      <defs>
        <radialGradient id="cpg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5B21B6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0D0B09" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cgs" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#F5D97A" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#A07820" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="90" fill="#0D0B09" />
      <rect width="512" height="512" rx="90" fill="url(#cpg)" />
      <polygon points="256,110 170,402 212,402 274,172" fill="url(#cgs)" />
      <polygon points="256,110 342,402 300,402 238,172" fill="url(#cgs)" />
      <rect x="180" y="282" width="152" height="34" rx="5" fill="url(#cgs)" />
    </svg>
  );
}

export function CockpitBar({
  readinessScore,
  nodes,
  onHomeNav,
  onAxiomOpen,
  navLeft,
  navRight,
  showReadinessStrip = true,
}: CockpitBarProps) {
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const hasSession = readinessScore > 0;
  const cockpitH = 72;

  const handleExportCopy = async () => {
    const lines = [
      "# Axiom Flow — Strategic Map",
      `Generated: ${new Date().toLocaleString()}`,
      `Readiness: ${readinessScore}%`,
      "",
      ...nodes.map(n => `- ${n.label} [${n.type}${n.meta ? `/${n.meta}` : ""}]: ${n.resolved ? "Resolved" : "Unresolved"}`),
    ].join("\n");
    try { await navigator.clipboard.writeText(lines); } catch {
      const ta = document.createElement("textarea");
      ta.value = lines;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => { setCopied(false); setShowExport(false); }, 1800);
  };

  const handleDownload = () => {
    const lines = [
      "# Axiom Blueprint",
      `Generated: ${new Date().toLocaleString()}`,
      `Readiness: ${readinessScore}%`,
      "",
      ...nodes.map(n => `- ${n.label} [${n.type}${n.meta ? `/${n.meta}` : ""}]: ${n.resolved ? "Resolved" : "Unresolved"}`),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `axiom-blueprint-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => { setDownloaded(false); setShowExport(false); }, 1800);
  };

  return (
    <>
      <style>{`
        @keyframes axiom-pulse-bar {
          0%, 100% { box-shadow: 0 0 20px rgba(212,175,55,0.3), 0 4px 12px rgba(0,0,0,0.5); }
          50%       { box-shadow: 0 0 35px rgba(212,175,55,0.6), 0 4px 12px rgba(0,0,0,0.5); }
        }
        @keyframes slideUpCb {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes slideUpHelp {
          from { transform: translateX(-50%) translateY(16px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);   opacity: 1; }
        }
      `}</style>

      {/* Readiness strip */}
      {showReadinessStrip && (
        <div style={{ width: "100%", background: "rgba(13,11,9,0.97)", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "flex-start", padding: "3px 14px 2px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.06em" }}>
              {readinessScore}%
            </span>
          </div>
          <div style={{ height: 3, width: "100%", background: "rgba(212,175,55,0.12)" }}>
            <div style={{
              height: "100%", width: `${readinessScore}%`,
              background: "#D4AF37", transition: "width 700ms ease",
            }} />
          </div>
        </div>
      )}

      {/* Help card */}
      {showHelp && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setShowHelp(false)} />
          <div style={{
            position: "fixed", left: "50%", zIndex: 40,
            bottom: cockpitH,
            transform: "translateX(-50%)",
            width: "min(90vw, 360px)",
            background: "rgba(20,18,14,0.98)",
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: "12px 12px 0 0",
            padding: "20px 20px 16px",
            animation: "slideUpHelp 200ms ease",
          }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#D4AF37", marginBottom: 8 }}>
              What is Axiom Flow?
            </p>
            <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6, marginBottom: 16 }}>
              Axiom Flow is your strategic execution map. Each node represents a key element of your mission. Tap any node to answer its pivot question and mark it resolved as you make progress.
            </p>
            <p style={{ fontSize: 10, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
              Node Types
            </p>
            <ul style={{ fontSize: 12, color: "#9ca3af", listStyle: "none", padding: 0, margin: "0 0 16px", display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                "◎ Goal — What does winning look like?",
                "◈ Requirement — What must exist?",
                "⚠ Blocker — What prevents progress?",
                "■ Priority — MoSCoW-ranked items",
                "◆ Decision — Committed choices",
                "△ Sprint — Bounded work increments",
              ].map((item, i) => (
                <li key={i} style={{ display: "flex", gap: 8 }}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setShowHelp(false)} style={{ background: "#D4AF37", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 700, color: "#0D0B09", cursor: "pointer" }}>
                Got it
              </button>
            </div>
          </div>
        </>
      )}

      {/* Export sheet */}
      {showExport && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowExport(false)} />
          <div style={{ position: "fixed", left: 0, right: 0, zIndex: 50, bottom: cockpitH, background: "rgba(13,11,9,0.99)", border: "1px solid rgba(212,175,55,0.35)", borderRadius: "16px 16px 0 0", padding: "20px 20px 24px", animation: "slideUpCb 220ms ease" }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#D4AF37", marginBottom: 4 }}>Export Blueprint</p>
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 20 }}>Copy or download your Axiom Flow map.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={handleExportCopy} style={{ width: "100%", borderRadius: 12, padding: "14px 0", fontSize: 13, fontWeight: 700, background: copied ? "rgba(212,175,55,0.15)" : "#D4AF37", color: copied ? "#D4AF37" : "#0D0B09", border: copied ? "1px solid rgba(212,175,55,0.4)" : "none", cursor: "pointer" }}>
                {copied ? "✓ Copied" : "Copy to Clipboard"}
              </button>
              <button onClick={handleDownload} style={{ width: "100%", borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600, background: "transparent", border: "1px solid rgba(212,175,55,0.4)", color: downloaded ? "#D4AF37" : "rgba(255,255,255,0.8)", cursor: "pointer" }}>
                {downloaded ? "✓ Downloaded" : "Download as TXT"}
              </button>
              <button onClick={() => setShowExport(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 12, cursor: "pointer", padding: "8px 0" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cockpit bar */}
      <div style={{ position: "relative", flexShrink: 0, height: cockpitH, overflow: "visible", zIndex: 20, paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}>

        {/* SVG arch cutout */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} preserveAspectRatio="none" viewBox="0 0 390 60">
          <path d="M0,0 L148,0 C163,0 172,22 195,22 C218,22 227,0 242,0 L390,0 L390,60 L0,60 Z" fill="rgba(13,11,9,0.97)" />
          <path d="M0,0.5 L148,0.5 C163,0.5 172,22 195,22 C218,22 227,0.5 242,0.5 L390,0.5" fill="none" stroke="rgba(212,175,55,0.22)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Raised A button — center → opens The Forge */}
        <button
          title="The Forge"
          style={{
            position: "absolute", top: -28, left: "50%",
            transform: "translateX(-50%)",
            width: 64, height: 64, borderRadius: "50%",
            background: "#0D0B09", border: "2px solid #D4AF37",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10, cursor: "pointer",
            animation: hasSession ? "axiom-pulse-bar 2s ease-in-out infinite" : "none",
            boxShadow: "0 0 20px rgba(212,175,55,0.3), 0 4px 12px rgba(0,0,0,0.5)",
          }}
          onClick={() => onAxiomOpen?.()}
        >
          <AxiomLogoSVG />
        </button>

        {/* FORGE label */}
        <span style={{ position: "absolute", top: 38, left: "50%", transform: "translateX(-50%)", fontSize: 9, letterSpacing: "0.12em", color: "#D4AF37", fontWeight: 700, whiteSpace: "nowrap", zIndex: 10, pointerEvents: "none" }}>
          FORGE
        </span>

        {/* Left side */}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "42%", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {navLeft !== undefined ? navLeft : (
            <button
              onClick={() => setShowHelp(v => !v)}
              title="Help"
              style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid rgba(212,175,55,0.4)", background: "transparent", color: "#D4AF37", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              ?
            </button>
          )}
        </div>

        {/* Right side */}
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "42%", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {navRight !== undefined ? navRight : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={onHomeNav}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)", color: "#D4AF37", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer" }}
              >
                → Atlas
              </button>
              <button
                onClick={() => setShowExport(true)}
                title="Export Blueprint"
                style={{ display: "flex", alignItems: "center", background: "transparent", border: "1px solid rgba(212,175,55,0.4)", borderRadius: 8, padding: "7px 9px", color: "#D4AF37", cursor: "pointer" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
