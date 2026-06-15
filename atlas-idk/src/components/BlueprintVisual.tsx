import { useState } from "react";
import { generateImage } from "@/lib/generateImage";
import { buildBlueprintImagePrompt } from "@/lib/blueprintImagePrompt";

interface Props {
  visualPrompt: string;
  title?: string;
  /** Optional style overrides for the prompt text block. */
  promptStyle?: React.CSSProperties;
}

/**
 * Visual section for a blueprint: shows the raw visualPrompt + a button
 * that generates a multi-panel industrial-design board image through
 * `atlas-image` (Lovable AI Gateway). The prompt is wrapped in a rich
 * template so the result matches the original Blueprint style.
 */
export function BlueprintVisual({ visualPrompt, title, promptStyle }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const prompt = buildBlueprintImagePrompt(visualPrompt, title);
      const img = await generateImage(prompt, { style: "blueprint" });
      setImageUrl(img.dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `${(title ?? "blueprint").replace(/\s+/g, "-").toLowerCase()}.png`;
    a.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p
        style={
          promptStyle ?? {
            fontSize: 13,
            lineHeight: 1.65,
            color: "var(--atlas-fg)",
            opacity: 0.9,
            margin: 0,
          }
        }
      >
        {visualPrompt}
      </p>

      {!imageUrl && (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          style={{
            alignSelf: "flex-start",
            padding: "7px 14px",
            borderRadius: 7,
            background: loading
              ? "var(--atlas-border)"
              : "rgba(201,162,76,0.12)",
            border: "1px solid rgba(201,162,76,0.4)",
            color: "var(--atlas-gold)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: loading ? "default" : "pointer",
            transition: "background 140ms",
          }}
        >
          {loading ? "Generating…" : "✦ Generate Image"}
        </button>
      )}

      {error && (
        <div
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10.5,
            color: "var(--atlas-ember)",
            opacity: 0.9,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {imageUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <img
            src={imageUrl}
            alt={title ?? "Blueprint visual"}
            style={{
              width: "100%",
              borderRadius: 8,
              display: "block",
              border: "1px solid var(--atlas-border)",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={download}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                opacity: 0.85,
              }}
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={loading}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid rgba(201,162,76,0.3)",
                color: "var(--atlas-gold)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.5 : 0.9,
              }}
            >
              {loading ? "…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
