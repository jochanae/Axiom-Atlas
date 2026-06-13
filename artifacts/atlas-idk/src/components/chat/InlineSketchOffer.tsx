/**
 * InlineSketchOffer — small "✨ Sketch this" pill that appears under an
 * assistant message when the reply has visual/spatial cues.
 *
 * Tapping the pill reveals 4 style preset chips (Concept, Wireframe, Mood
 * board, Photoreal). Picking one composes a styled prompt and dispatches
 * it through the standard chat path (onSend) so atlas-chat generates the
 * image and renders it inline as a new assistant message.
 *
 * Discipline (per North Star + memory):
 *   - Sketch = thinking artifact. Framing is "Sketch as…", not "Render".
 *   - Manual chip path only. No auto-emit from the model.
 *   - Photoreal stays an exploration; Accept Direction → Forge is downstream.
 *
 * Ported from Compani; adapted to use Atlas's onSend pipeline instead of
 * the Compani useWorkImage hook (which doesn't exist here).
 */

import { useMemo, useState } from "react";
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
}

export default function InlineSketchOffer({ text, onSend }: InlineSketchOfferProps) {
  const [dismissed, setDismissed] = useState(false);
  const [used, setUsed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const intent = useMemo(() => detectVisualIntent(text || ""), [text]);

  if (!onSend || !intent.shouldOffer || used || dismissed) return null;

  const handlePick = (preset: SketchStylePreset) => {
    const prompt = buildSketchPrompt(preset, text);
    setUsed(true);
    onSend(prompt);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="mt-1.5 ml-3 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-[rgba(201,162,76,0.95)] bg-[rgba(201,162,76,0.08)] border border-[rgba(201,162,76,0.25)] hover:bg-[rgba(201,162,76,0.14)] hover:border-[rgba(201,162,76,0.4)] transition-colors"
        >
          <Sparkles className="h-3 w-3" />
          {expanded ? "Sketch as…" : "Sketch this"}
        </button>
        {!expanded && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[10px] uppercase tracking-[0.1em] font-light text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Not now
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-wrap gap-1.5 overflow-hidden"
          >
            {SKETCH_STYLE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePick(p)}
                className="rounded-full px-3 py-1 text-[11px] font-light text-foreground/80 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-colors"
              >
                {SKETCH_STYLE_LABEL[p]}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
