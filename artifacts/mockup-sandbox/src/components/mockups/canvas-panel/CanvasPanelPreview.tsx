import { useState, useRef, useEffect } from "react";

export interface ImageVersion {
  id: string;
  imageUrl: string;
  prompt: string;
  model: string;
  mode: "render" | "schematic";
  timestamp: string;
  isRefinement?: boolean;
}

const MOCK_VERSIONS: ImageVersion[] = [
  {
    id: "v1",
    imageUrl: "https://picsum.photos/seed/axiom1/800/600",
    prompt: "Dark mode dashboard UI with amber accents",
    model: "gemini",
    mode: "render",
    timestamp: "2025-06-11T10:00:00Z",
  },
  {
    id: "v2",
    imageUrl: "https://picsum.photos/seed/axiom2/800/600",
    prompt: "Make it glow more cinematic with warm lighting",
    model: "gemini",
    mode: "render",
    timestamp: "2025-06-11T10:05:00Z",
    isRefinement: true,
  },
  {
    id: "v3",
    imageUrl: "https://picsum.photos/seed/axiom3/800/600",
    prompt: "Add more depth and glassmorphism",
    model: "claude",
    mode: "render",
    timestamp: "2025-06-11T10:10:00Z",
    isRefinement: true,
  },
];

export function CanvasPanelPreview() {
  const [activeVersionId, setActiveVersionId] = useState("v3");
  const [input, setInput] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const activeVersion = MOCK_VERSIONS.find((v) => v.id === activeVersionId) ?? MOCK_VERSIONS[0];
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isDark = true;
  const bg = isDark ? "#0C0A09" : "#F7F3EE";
  const fg = isDark ? "#E7E5E4" : "#1C1917";
  const surface = isDark ? "#1C1917" : "#EDE8E2";
  const border = isDark ? "#252220" : "#D8D2CA";
  const gold = isDark ? "#C9A24C" : "#A6803C";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <button
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
            fontFamily: "monospace",
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
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4, fontFamily: "monospace" }}>
              {activeVersion.model} · {activeVersion.mode}
            </div>
            <div>{activeVersion.prompt}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 6, fontFamily: "monospace" }}>
              {new Date(activeVersion.timestamp).toLocaleString()}
            </div>
          </div>
        )}
      </div>

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
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {MOCK_VERSIONS.map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveVersionId(v.id)}
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: 8,
                padding: 0,
                border: v.id === activeVersionId ? `2px solid ${gold}` : `1px solid ${border}`,
                background: v.id === activeVersionId ? "rgba(201,162,76,0.12)" : surface,
                cursor: "pointer",
                overflow: "hidden",
                position: "relative",
                transition: "all 160ms ease",
              }}
            >
              <img
                src={v.imageUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: v.id === activeVersionId ? 1 : 0.6 }}
              />
              {v.isRefinement && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 2,
                    right: 2,
                    fontSize: 7,
                    fontFamily: "monospace",
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

        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setInput(""); } }}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Make it glow more cinematic..."
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 8,
              background: surface,
              border: `1px solid ${border}`,
              color: fg,
              fontSize: 13,
              fontFamily: "sans-serif",
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: gold,
              border: "none",
              color: bg,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Refine
          </button>
        </form>
      </div>
    </div>
  );
}
