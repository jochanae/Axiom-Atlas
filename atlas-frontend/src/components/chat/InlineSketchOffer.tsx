/**
 * InlineSketchOffer — compact Sparkles icon that lives in the assistant
 * action bar (next to copy / regenerate). Tapping it opens a small popover
 * with the 4 style preset chips (Concept, Wireframe, Mood board, Photoreal).
 * Picking one composes a styled prompt and dispatches it through onSend.
 *
 * The icon glows gold when `detectVisualIntent` flags the message as
 * visually-loaded, otherwise sits quiet like the other action icons.
 *
 * Discipline (per North Star + memory):
 *   - Sketch = thinking artifact. Framing is "Sketch as…", not "Render".
 *   - Manual chip path only. No auto-emit from the model.
 *   - Photoreal stays an exploration; Accept Direction → Forge is downstream.
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { detectVisualIntent } from "@/lib/visualIntentDetection";
import {
  SKETCH_STYLE_PRESETS,
  SKETCH_STYLE_LABEL,
  buildSketchPrompt,
  type SketchStylePreset,
} from "@/lib/sketchStylePresets";

interface InlineSketchOfferProps {
  text: string;
  onSend?: (message: string) => void;
  /** When true, render as an inline icon-only button (for action bars). */
  iconOnly?: boolean;
}

export default function InlineSketchOffer({ text, onSend, iconOnly = true }: InlineSketchOfferProps) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const intent = useMemo(() => detectVisualIntent(text || ""), [text]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
    };
  }, [open]);

  if (!onSend || used) return null;

  const highlight = intent.shouldOffer;

  const handlePick = (preset: SketchStylePreset) => {
    const prompt = buildSketchPrompt(preset, text);
    setUsed(true);
    setOpen(false);
    onSend(prompt);
  };

  // Compact icon variant (default) — fits inside the assistant action bar.
  if (iconOnly) {
    return (
      <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title="Sketch this"
          aria-label="Sketch this"
          className="atlas-icon-action"
          style={{
            background: "transparent",
            border: "none",
            padding: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: highlight ? "var(--atlas-gold, #c9a24c)" : "var(--atlas-muted, rgba(255,255,255,0.55))",
            opacity: highlight ? 0.95 : 0.55,
            filter: highlight ? "drop-shadow(0 0 4px rgba(201,162,76,0.45))" : "none",
            transition: "opacity 180ms ease, color 180ms ease",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <Sparkles size={13} strokeWidth={1.7} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                left: 0,
                zIndex: 50,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: 8,
                borderRadius: 10,
                background: "rgba(20,18,14,0.96)",
                border: "1px solid rgba(201,162,76,0.25)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                minWidth: 220,
              }}
            >
              <div style={{
                width: "100%",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(201,162,76,0.7)",
                marginBottom: 2,
              }}>
                Sketch as…
              </div>
              {SKETCH_STYLE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePick(p)}
                  className="rounded-full px-3 py-1 text-[11px] font-light text-foreground/85 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-colors"
                >
                  {SKETCH_STYLE_LABEL[p]}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Legacy pill variant — kept for any caller that opts out of iconOnly.
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="mt-1.5 ml-3 flex items-center gap-2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-[rgba(201,162,76,0.95)] bg-[rgba(201,162,76,0.08)] border border-[rgba(201,162,76,0.25)] hover:bg-[rgba(201,162,76,0.14)] hover:border-[rgba(201,162,76,0.4)] transition-colors"
      >
        <Sparkles className="h-3 w-3" />
        Sketch this
      </button>
    </motion.div>
  );
}
