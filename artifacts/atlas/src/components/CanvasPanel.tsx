import { useState, useRef, useCallback } from "react";
import type React from "react";

export interface ImageVersion {
  id: string;
  dataUrl: string;
  prompt?: string;
  createdAt: string;
}

interface CanvasPanelProps {
  versions: ImageVersion[];
  activeVersionId: string | null;
  onVersionSelect: (id: string) => void;
  onRefine: (prompt: string) => void;
  onClose: () => void;
  mode?: "modal" | "inline";
}

export function CanvasPanel({
  versions,
  activeVersionId,
  onVersionSelect,
  onRefine,
  onClose,
  mode = "modal",
}: CanvasPanelProps) {
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = versions.find((v) => v.id === activeVersionId) ?? versions[versions.length - 1] ?? null;

  const handleRefine = useCallback(async () => {
    const text = refineInput.trim();
    if (!text || refineLoading) return;
    setRefineLoading(true);
    setRefineInput("");
    try {
      await onRefine(text);
    } finally {
      setRefineLoading(false);
    }
  }, [refineInput, refineLoading, onRefine]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleRefine();
      }
    },
    [handleRefine]
  );

  const containerStyle: React.CSSProperties =
    mode === "modal"
      ? {
          position: "fixed",
          inset: 0,
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          background: "var(--atlas-bg)",
        }
      : {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "var(--atlas-bg)",
          borderLeft: "1px solid var(--atlas-border)",
        };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
            <path d="M1 10l4-4 3 3 3-4 4 5" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "var(--atlas-gold)",
              textTransform: "uppercase",
            }}
          >
            VISUAL CANVAS
          </span>
          {versions.length > 1 && (
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                color: "var(--atlas-muted)",
                letterSpacing: "0.06em",
              }}
            >
              v{versions.findIndex((v) => v.id === active?.id) + 1} / {versions.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          title="Close canvas"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid var(--atlas-border)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--atlas-muted)",
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Main image area */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          position: "relative",
        }}
      >
        {active ? (
          <img
            src={active.dataUrl}
            alt="Generated visual"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 10,
              border: "1px solid rgba(201,162,76,0.2)",
              boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "var(--atlas-muted)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="2" y="2" width="28" height="28" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 22l8-8 6 6 4-5 10 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 12, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>
              No visual yet
            </span>
          </div>
        )}
      </div>

      {/* Version history strip */}
      {versions.length > 1 && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--atlas-border)",
            padding: "8px 12px",
            overflowX: "auto",
            display: "flex",
            gap: 6,
            scrollbarWidth: "none",
          }}
        >
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => onVersionSelect(v.id)}
              title={v.prompt ?? `Version ${i + 1}`}
              style={{
                flexShrink: 0,
                width: 52,
                height: 52,
                borderRadius: 7,
                overflow: "hidden",
                border: v.id === activeVersionId
                  ? "2px solid var(--atlas-gold)"
                  : "1px solid var(--atlas-border)",
                cursor: "pointer",
                background: "var(--atlas-surface)",
                padding: 0,
                opacity: v.id === activeVersionId ? 1 : 0.6,
                transition: "opacity 160ms, border-color 160ms",
                position: "relative",
              }}
            >
              <img
                src={v.dataUrl}
                alt={`v${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 1,
                  right: 3,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 7,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.7)",
                  letterSpacing: "0.04em",
                }}
              >
                v{i + 1}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Refinement input */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--atlas-border)",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={textareaRef}
          value={refineInput}
          onChange={(e) => setRefineInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={refineLoading}
          placeholder={active ? "Refine this visual…" : "Describe what to generate…"}
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 8,
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)",
            fontSize: 12.5,
            padding: "8px 10px",
            outline: "none",
            lineHeight: 1.5,
            opacity: refineLoading ? 0.55 : 1,
          }}
        />
        <button
          onClick={() => void handleRefine()}
          disabled={!refineInput.trim() || refineLoading}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: refineInput.trim() && !refineLoading ? "var(--atlas-ember)" : "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            cursor: refineInput.trim() && !refineLoading ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 160ms",
          }}
        >
          {refineLoading ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              style={{ animation: "atlas-spin 0.8s linear infinite" }}
            >
              <circle cx="6" cy="6" r="5" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeDasharray="16 10" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="var(--atlas-fg)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
