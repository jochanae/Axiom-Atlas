import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";

export default function ThinkFreely() {
  const [, setLocation] = useLocation();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const handleClear = () => {
    if (text && !confirm("Clear your freewrite?")) return;
    setText("");
    textareaRef.current?.focus();
  };

  const handleCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  return (
    <div style={{ height: "100dvh", background: "var(--atlas-bg)", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <header style={{
        flexShrink: 0, padding: "10px 16px",
        borderBottom: "1px solid var(--atlas-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onClick={() => setLocation("/")}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}
          >
            ← Home
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>Think Freely</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {text && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy to clipboard"
                style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", padding: "4px 10px", borderRadius: 5, cursor: "pointer", opacity: 0.7 }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={handleClear}
                title="Clear"
                style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", padding: "4px 10px", borderRadius: 5, cursor: "pointer", opacity: 0.7 }}
              >
                Clear
              </button>
            </>
          )}
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.06em" }}>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        </div>
      </header>

      {/* Freewrite canvas */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {!text && (
          <div
            aria-hidden
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              fontFamily: "var(--app-font-mono)", fontSize: 12,
              color: "var(--atlas-muted)", opacity: 0.25,
              textAlign: "center", lineHeight: 1.8, pointerEvents: "none",
              letterSpacing: "0.04em",
            }}
          >
            No rules. No structure.<br />Just write until something becomes clear.
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder=""
          style={{
            width: "100%", height: "100%",
            background: "transparent", border: "none", outline: "none",
            color: "var(--atlas-fg)", fontSize: 15, lineHeight: 1.85,
            resize: "none", padding: "28px 24px",
            fontFamily: "var(--app-font-sans)",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Footer note */}
      <div style={{ flexShrink: 0, padding: "8px 16px", borderTop: "1px solid var(--atlas-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.3, letterSpacing: "0.08em" }}>
          This is a scratchpad — nothing is saved to the server
        </span>
      </div>
    </div>
  );
}
