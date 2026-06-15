/**
 * SketchComposerSheet — manual entry point for image generation.
 *
 * Opens from the composer "+" sheet (BigNode "Sketch"). User types a
 * prompt, picks one of the 4 sketch style presets (Concept · Wireframe
 * · Mood board · Photoreal), and sends. The composed prompt routes
 * through the standard chat path (same as InlineSketchOffer), so the
 * resulting image renders inline as an assistant message via the
 * `[SKETCH:<preset>]` backend contract in sketchStylePresets.ts.
 *
 * Lives on BOTH surfaces (home global insights + workspace chat) via
 * ComposerActions, so users can always reach image gen manually without
 * waiting for Atlas to surface the InlineSketchOffer pill.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Wand2, X } from "lucide-react";
import {
  SKETCH_STYLE_PRESETS,
  SKETCH_STYLE_LABEL,
  buildSketchPrompt,
  type SketchStylePreset,
} from "@/lib/sketchStylePresets";

interface Props {
  open: boolean;
  onClose: () => void;
  onSend: (prompt: string) => void;
}

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9998,
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "16px 14px calc(env(safe-area-inset-bottom, 0px) + 96px)",
};

const PANEL: React.CSSProperties = {
  position: "relative",
  zIndex: 9999,
  width: "100%",
  maxWidth: 440,
  background: "color-mix(in oklab, var(--atlas-surface) 94%, transparent)",
  backdropFilter: "blur(28px) saturate(150%)",
  border: "1px solid color-mix(in oklab, var(--atlas-gold) 22%, transparent)",
  borderRadius: 22,
  boxShadow:
    "0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4), inset 0 1px 0 color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
  padding: "14px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

export default function SketchComposerSheet({ open, onClose, onSend }: Props) {
  const [preset, setPreset] = useState<SketchStylePreset>("concept");
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const portalHost = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setText("");
    setPreset("concept");
    const t = setTimeout(() => taRef.current?.focus(), 80);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  if (!open || !portalHost) return null;

  const canSend = text.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    onSend(buildSketchPrompt(preset, text.trim()));
    onClose();
  };

  return createPortal(
    <div style={OVERLAY} onClick={onClose}>
      <div
        role="dialog"
        aria-label="Generate image"
        style={PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(201,162,76,0.10)",
              border: "1px solid rgba(201,162,76,0.22)",
              color: "var(--atlas-gold)",
            }}
          >
            <Wand2 size={15} strokeWidth={1.6} />
          </span>
          <div style={{ flex: 1, fontFamily: "var(--app-font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-fg)" }}>
            Sketch
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "var(--atlas-muted)", cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={14} strokeWidth={1.7} />
          </button>
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe the image you want to sketch…"
          rows={4}
          style={{
            width: "100%",
            resize: "none",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "10px 12px",
            color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 14,
            lineHeight: 1.5,
            outline: "none",
          }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SKETCH_STYLE_PRESETS.map((p) => {
            const active = p === preset;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                style={{
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  background: active ? "rgba(201,162,76,0.14)" : "rgba(255,255,255,0.04)",
                  border: active
                    ? "1px solid rgba(201,162,76,0.4)"
                    : "1px solid rgba(255,255,255,0.1)",
                  color: active ? "var(--atlas-gold)" : "var(--atlas-fg)",
                  transition: "all 160ms ease",
                }}
              >
                {SKETCH_STYLE_LABEL[p]}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.06em" }}>
            ⌘↵ to send
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: canSend ? "pointer" : "not-allowed",
              background: canSend ? "rgba(201,162,76,0.16)" : "rgba(255,255,255,0.04)",
              border: canSend
                ? "1px solid rgba(201,162,76,0.4)"
                : "1px solid rgba(255,255,255,0.08)",
              color: canSend ? "var(--atlas-gold)" : "var(--atlas-muted)",
              opacity: canSend ? 1 : 0.6,
              transition: "all 160ms ease",
            }}
          >
            Sketch
          </button>
        </div>
      </div>
    </div>,
    portalHost
  );
}
