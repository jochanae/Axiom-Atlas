import { useState } from "react";
import {
  SKETCH_STYLE_LABEL,
  SKETCH_STYLE_PRESETS,
  type SketchStylePreset,
} from "@/lib/sketchStylePresets";

interface ImageGeneratorProps {
  compact?: boolean;
}

export function ImageGenerator({ compact = false }: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<SketchStylePreset>("concept");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setImageUrl(null);
    try {
      const { generateImage } = await import("@/lib/generateImage");
      const img = await generateImage(prompt.trim(), { style });
      setImageUrl(img.dataUrl);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = "axiom-image.png";
    a.click();
  };

  return (
    <div
      style={{
        background: "#1C1917",
        border: "1px solid #C9A24C",
        borderRadius: 12,
        padding: compact ? 16 : 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>ðŸŽ¨</span>
        <span style={{ color: "#C9A24C", fontWeight: 600, fontSize: compact ? 13 : 14 }}>
          Image Generator
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
        }}
        placeholder="Describe what you want to generateâ€¦"
        rows={compact ? 2 : 3}
        style={{
          background: "#0C0A09",
          border: "1px solid #252220",
          borderRadius: 8,
          color: "#E7E5E4",
          fontSize: 14,
          padding: "10px 12px",
          resize: "none",
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        {SKETCH_STYLE_PRESETS.map((option) => {
          const active = style === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setStyle(option)}
              style={{
                background: active ? "#C9A24C" : "transparent",
                color: active ? "#0C0A09" : "#C9A24C",
                border: "1px solid #C9A24C",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {SKETCH_STYLE_LABEL[option]}
            </button>
          );
        })}
      </div>

      <button
        onClick={generate}
        disabled={!prompt.trim() || loading}
        style={{
          background: loading || !prompt.trim() ? "#252220" : "#92400E",
          color: loading || !prompt.trim() ? "#78716C" : "#E7E5E4",
          border: "none",
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 14,
          fontWeight: 600,
          cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {loading ? "Generatingâ€¦" : "Generate"}
      </button>

      {error && (
        <p style={{ color: "#EF4444", fontSize: 13, margin: 0 }}>{error}</p>
      )}

      {imageUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <img
            src={imageUrl}
            alt="Generated"
            style={{ width: "100%", borderRadius: 8, display: "block" }}
          />
          <button
            onClick={download}
            style={{
              background: "transparent",
              border: "1px solid #C9A24C",
              color: "#C9A24C",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Download
          </button>
        </div>
      )}
    </div>
  );
}
