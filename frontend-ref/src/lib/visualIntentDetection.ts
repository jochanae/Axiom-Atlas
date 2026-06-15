/**
 * visualIntentDetection — lightweight heuristic that decides whether to
 * surface the inline "Sketch this" offer under an assistant message.
 *
 * Ported (minimal) from Compani. Conservative on purpose: false positives
 * are worse than false negatives because the pill is interruptive.
 */

const VISUAL_CUES = [
  // structural / UI
  "layout", "wireframe", "screen", "page", "ui", "interface", "component",
  "dashboard", "panel", "sidebar", "modal", "card", "grid", "hero", "nav",
  // spatial
  "diagram", "flow", "map", "architecture", "structure", "shape", "graph",
  // aesthetic / brand
  "mood", "palette", "brand", "logo", "style", "aesthetic", "visual",
  "look and feel", "vibe", "tone",
  // explicit visual asks
  "sketch", "draw", "render", "mockup", "concept art", "illustration",
  "picture", "image", "visualize", "visualise",
];

export interface VisualIntent {
  shouldOffer: boolean;
  score: number;
  matched: string[];
}

export function detectVisualIntent(text: string): VisualIntent {
  if (!text || text.length < 24) return { shouldOffer: false, score: 0, matched: [] };
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const cue of VISUAL_CUES) {
    if (lower.includes(cue)) matched.push(cue);
  }
  const score = matched.length;
  return { shouldOffer: score >= 1, score, matched };
}
