import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * DeepDiveSheet — hand off the current thread context to an external chat
 * (ChatGPT / Perplexity / Gemini) for deep exploration, then accept a pasted
 * answer back. Mirrors the onboarding DeepDiveHelper pattern.
 */
export function DeepDiveSheet({
  open,
  onClose,
  initialContext,
  onPasteBack,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-filled context block (current draft + recent thread excerpt). */
  initialContext: string;
  /** Optional callback when user pastes a response back. */
  onPasteBack?: (text: string) => void;
}) {
  const [context, setContext] = useState(initialContext);
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);
  const portalHost = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    if (open) {
      setContext(initialContext);
      setPaste("");
      setCopied(false);
    }
  }, [open, initialContext]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !portalHost) return null;

  const launch = (target: "chatgpt" | "perplexity" | "gemini") => {
    const encoded = encodeURIComponent(context);
    if (target === "chatgpt") {
      window.open(`https://chatgpt.com/?q=${encoded}`, "_blank");
    } else if (target === "perplexity") {
      window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank");
    } else {
      navigator.clipboard.writeText(context).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
      setTimeout(() => window.open("https://gemini.google.com", "_blank"), 900);
    }
  };

  const applyPaste = () => {
    if (!paste.trim()) return;
    onPasteBack?.(paste.trim());
    onClose();
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "16px 14px calc(env(safe-area-inset-bottom, 0px) + 96px)",
      }}
    >
      <div
        role="dialog"
        aria-label="Deep Dive"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "color-mix(in oklab, var(--atlas-surface) 94%, transparent)",
          backdropFilter: "blur(28px) saturate(150%)",
          border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
          borderRadius: 22,
          boxShadow: "0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4)",
          padding: "12px 16px 16px",
          display: "flex", flexDirection: "column", gap: 12,
          maxHeight: "calc(100vh - 140px)", overflow: "hidden",
        }}
      >
        <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(201,162,76,0.35)", margin: "2px auto 4px" }} />
        <div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
            Deep Dive ↗
          </div>
          <div style={{ fontSize: 13, color: "var(--atlas-muted)", marginTop: 4, lineHeight: 1.5 }}>
            Hand this thread off to an external model. Edit context if needed, pick a destination, then paste the answer back.
          </div>
        </div>

        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={6}
          style={{
            width: "100%", resize: "vertical", minHeight: 100, maxHeight: 220,
            fontFamily: "var(--app-font-mono)", fontSize: 12, lineHeight: 1.5,
            padding: "10px 12px", borderRadius: 10,
            background: "color-mix(in oklab, var(--atlas-bg) 80%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
            color: "var(--atlas-fg)", outline: "none",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {([
            { id: "chatgpt", label: "ChatGPT" },
            { id: "perplexity", label: "Perplexity" },
            { id: "gemini", label: "Gemini" },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => launch(t.id)}
              style={{
                padding: "10px 8px", borderRadius: 10,
                background: "rgba(201,162,76,0.08)",
                border: "1px solid rgba(201,162,76,0.28)",
                color: "var(--atlas-gold)", cursor: "pointer",
                fontFamily: "var(--app-font-mono)", fontSize: 11, letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {copied && (
          <div style={{ fontSize: 11, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em" }}>
            COPIED — PASTE INTO GEMINI
          </div>
        )}

        <div style={{ height: 1, background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)" }} />

        <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Paste response back
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          placeholder="Paste the answer here to bring it into your next message…"
          style={{
            width: "100%", resize: "vertical", minHeight: 80, maxHeight: 180,
            fontSize: 13, lineHeight: 1.5, padding: "10px 12px", borderRadius: 10,
            background: "color-mix(in oklab, var(--atlas-bg) 80%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
            color: "var(--atlas-fg)", outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 14px", borderRadius: 10, background: "transparent",
              border: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
              color: "var(--atlas-muted)", cursor: "pointer", fontSize: 12,
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={applyPaste}
            disabled={!paste.trim()}
            style={{
              padding: "9px 14px", borderRadius: 10,
              background: paste.trim() ? "var(--atlas-gold)" : "rgba(201,162,76,0.2)",
              border: "1px solid var(--atlas-gold)",
              color: paste.trim() ? "var(--atlas-bg)" : "var(--atlas-muted)",
              cursor: paste.trim() ? "pointer" : "not-allowed",
              fontSize: 12, fontWeight: 600,
            }}
          >
            Bring into composer
          </button>
        </div>
      </div>
    </div>,
    portalHost
  );
}
