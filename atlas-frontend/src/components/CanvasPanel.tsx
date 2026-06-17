import { useState, useEffect, useRef, type FormEvent } from "react";
import { createPortal } from "react-dom";

export interface ImageVersion {
  id: string;
  imageUrl: string;
  prompt: string;
  model: string;
  mode: "render" | "schematic";
  timestamp: string;
  isRefinement?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  versions: ImageVersion[];
  activeVersionId: string;
  onSelectVersion: (id: string) => void;
  onRefine: (prompt: string) => void;
  isGenerating: boolean;
  theme: "dark" | "light";
  mode?: "modal" | "inline";
}

export function CanvasPanel({
  open,
  onClose,
  versions,
  activeVersionId,
  onSelectVersion,
  onRefine,
  isGenerating,
  theme,
  mode = "modal",
}: Props) {
  const [input, setInput] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const activeVersion = versions.find((v) => v.id === activeVersionId) ?? versions[0];
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && !isGenerating) {
      inputRef.current?.focus();
    }
  }, [open, isGenerating, activeVersionId]);

  if (!open || !activeVersion) return null;

  const isDark = theme === "dark";
  const bg = isDark ? "#0C0A09" : "#F7F3EE";
  const fg = isDark ? "#E7E5E4" : "#1C1917";
  const surface = isDark ? "#1C1917" : "#EDE8E2";
  const muted = isDark ? "#78716C" : "#8A827A";
  const border = isDark ? "#252220" : "#D8D2CA";
  const gold = isDark ? "#C9A24C" : "#A6803C";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;
    onRefine(input.trim());
    setInput("");
  };

  const content = (
    <div
      style={{
        position: mode === "modal" ? "fixed" : "relative",
        inset: mode === "modal" ? 0 : undefined,
        zIndex: mode === "modal" ? 100 : undefined,
        background: mode === "modal" ? "rgba(0,0,0,0.72)" : bg,
        backdropFilter: mode === "modal" ? "blur(8px)" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: mode === "modal" ? "center" : "flex-start",
        padding: mode === "modal" ? "24px" : "16px",
        height: mode === "modal" ? undefined : "100%",
        overflow: mode === "modal" ? undefined : "auto",
      }}
      onClick={mode === "modal" ? (e) => {
        if (e.target === e.currentTarget) onClose();
      } : undefined}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 101,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Main image area */}
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          maxWidth: 900,
          overflow: "hidden",
        }}
      >
        <img
          src={activeVersion.imageUrl}
          alt={activeVersion.prompt}
          style={{
            maxWidth: "100%",
            maxHeight: "calc(100dvh - 200px)",
            borderRadius: 12,
            border: `1px solid ${border}`,
            boxShadow: "0 20px 60px -20px rgba(0,0,0,0.5)",
            display: "block",
          }}
        />

        {/* Info overlay */}
        <button
          onClick={() => setShowInfo(!showInfo)}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.8)",
            fontSize: 10,
            fontFamily: "var(--app-font-mono)",
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          {showInfo ? "Hide" : "Info"}
        </button>

        {showInfo && (
          <div
            style={{
              position: "absolute",
              top: 44,
              left: 12,
              maxWidth: 320,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 11,
              lineHeight: 1.5,
              zIndex: 2,
            }}
          >
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4, fontFamily: "var(--app-font-mono)" }}>
              {activeVersion.model} · {activeVersion.mode}
            </div>
            <div>{activeVersion.prompt}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 6, fontFamily: "var(--app-font-mono)" }}>
              {new Date(activeVersion.timestamp).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel: versions + input */}
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Version history strip */}
        {versions.length > 1 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => onSelectVersion(v.id)}
                style={{
                  flexShrink: 0,
                  width: 56,
                  height: 56,
                  borderRadius: 8,
                  padding: 0,
                  border: v.id === activeVersionId
                    ? `2px solid ${gold}`
                    : `1px solid ${border}`,
                  background: v.id === activeVersionId ? `color-mix(in oklab, ${gold} 12%, transparent)` : surface,
                  cursor: "pointer",
                  overflow: "hidden",
                  position: "relative",
                  transition: "all 160ms ease",
                }}
              >
                <img
                  src={v.imageUrl}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: v.id === activeVersionId ? 1 : 0.6,
                  }}
                />
                {v.isRefinement && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 2,
                      fontSize: 7,
                      fontFamily: "var(--app-font-mono)",
                      color: gold,
                      background: "rgba(0,0,0,0.5)",
                      padding: "1px 3px",
                      borderRadius: 3,
                    }}
                  >
                    R
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Refinement input */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isGenerating ? "Generating..." : "Make it glow more cinematic..."}
            disabled={isGenerating}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 8,
              background: surface,
              border: `1px solid ${border}`,
              color: fg,
              fontSize: 13,
              fontFamily: "var(--app-font-sans)",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isGenerating || !input.trim()}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: gold,
              border: "none",
              color: bg,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: isGenerating ? "not-allowed" : "pointer",
              opacity: isGenerating ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {isGenerating ? "..." : "Refine"}
          </button>
        </form>
      </div>
    </div>
  );

  return mode === "modal" ? createPortal(content, document.body) : content;
}
