/**
 * Sketch style presets — user-facing styles selectable when offering to
 * sketch a thinking artifact from an assistant reply. Each preset carries
 * a label and a style hint appended to the generation prompt.
 *
 * Ported from Compani (sketchStylePresets.ts) and adapted for Atlas.
 * In Atlas, image generation flows through the standard chat path, so we
 * compose a prompt rather than calling a dedicated work-image hook.
 *
 * Discipline (per North Star):
 *   - Sketch = thinking artifact, not a build deliverable.
 *   - Manual chip path only; no auto-emit from the model.
 *   - Any preset (including Photoreal) is an exploration, not a commit.
 */

export type SketchStylePreset = "concept" | "wireframe" | "moodboard" | "blueprint" | "photoreal";

export const SKETCH_STYLE_PRESETS: SketchStylePreset[] = [
  "concept",
  "wireframe",
  "moodboard",
  "blueprint",
  "photoreal",
];

export const SKETCH_STYLE_LABEL: Record<SketchStylePreset, string> = {
  concept: "Concept",
  wireframe: "Wireframe",
  moodboard: "Mood board",
  blueprint: "Blueprint",
  photoreal: "Photoreal",
};

export const SKETCH_STYLE_HINT: Record<SketchStylePreset, string> = {
  concept:
    "Loose hand-drawn whiteboard sketch, dark marker on light background, casual but legible.",
  wireframe:
    "Clean low-fidelity UI wireframe, light background, generous whitespace, grayscale blocks.",
  moodboard:
    "Editorial mood board collage, balanced composition, cohesive palette, magazine-quality.",
  blueprint:
    "Multi-panel industrial design board, premium editorial presentation, English labels only, product concept hero shot, orthographic blueprint views, workflow strip, crisp typography, no foreign-language text.",
  photoreal:
    "Photorealistic product render, studio lighting, crisp materials, clean dark background.",
};

export function isSketchStylePreset(v: unknown): v is SketchStylePreset {
  return typeof v === "string" && (SKETCH_STYLE_PRESETS as string[]).includes(v);
}

/**
 * Compose a prompt to send through the standard chat path.
 *
 * The leading `[SKETCH:<preset>]` marker is the explicit signal the
 * Cloud Run `/api/chat` handler branches on to route this turn to
 * image generation instead of replying as text. See BACKEND CONTRACT
 * below.
 */
export const SKETCH_PROMPT_MARKER_RE = /^\[SKETCH:(concept|wireframe|moodboard|blueprint|photoreal)\]\s*/i;

export function buildSketchPrompt(preset: SketchStylePreset, excerpt: string): string {
  const label = SKETCH_STYLE_LABEL[preset];
  const hint = SKETCH_STYLE_HINT[preset];
  const trimmed = excerpt.trim().slice(0, 700);
  return `[SKETCH:${preset}] Sketch this as a ${label} (thinking artifact, not a final deliverable).\n\nStyle: ${hint}\n\nSubject:\n${trimmed}`;
}

export function extractSketchSubject(prompt: string): string {
  const stripped = prompt.replace(SKETCH_PROMPT_MARKER_RE, "").trim();
  const subjectMatch = stripped.match(/\nSubject:\n([\s\S]*)$/i);
  if (subjectMatch?.[1]?.trim()) return subjectMatch[1].trim();
  return stripped
    .replace(/^Sketch this as a .*?\n\nStyle:\s*[\s\S]*$/i, "")
    .trim() || stripped;
}

const CAPABILITY_QUESTION_RE = /^(?:\s*)(?:can|could|do|does|is|are|will|would)\b[\s\S]*\?\s*$/i;
const DIRECT_IMAGE_REQUEST_RE = [
  /\b(sketch|draw|render|illustrate|visuali[sz]e|mock\s*up)\b\s+(?:this|that|it|me|a|an|the)\b/i,
  /\b(generate|create|make)\b[\s\S]{0,80}\b(image|picture|illustration|render|sketch|mockup|wireframe|mood\s*board)\b/i,
  /\bshow\s+me\b[\s\S]{0,80}\b(image|picture|render|sketch|mockup|wireframe|mood\s*board)\b/i,
];

export function inferSketchStylePreset(text: string): SketchStylePreset {
  const lower = text.toLowerCase();
  if (/(wireframe|layout|ui|screen|page|dashboard|interface|app)/i.test(lower)) return "wireframe";
  if (/(mood\s*board|moodboard|palette|brand|branding|style|editorial|vibe)/i.test(lower)) return "moodboard";
  if (/(blueprint|orthographic|schematic|industrial design|concept board|product board)/i.test(lower)) return "blueprint";
  if (/(photoreal|photo\s*real|realistic|product\s*render|studio\s*lighting|cinematic)/i.test(lower)) return "photoreal";
  return "concept";
}

export function shouldAutoRouteToSketchPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || SKETCH_PROMPT_MARKER_RE.test(trimmed)) return false;
  if (CAPABILITY_QUESTION_RE.test(trimmed) && !/\b(of|for|this|that|it|me)\b/i.test(trimmed)) return false;
  return DIRECT_IMAGE_REQUEST_RE.some((re) => re.test(trimmed));
}

export function routeDirectImageRequestToSketchPrompt(text: string): string {
  if (!shouldAutoRouteToSketchPrompt(text)) return text;
  return buildSketchPrompt(inferSketchStylePreset(text), text);
}

/**
 * ─── BACKEND CONTRACT (Cloud Run /api/chat) ────────────────────────────
 * When an incoming `message` matches SKETCH_PROMPT_MARKER_RE, the handler
 * MUST:
 *   1. Capture the preset (capture group 1) and strip the marker from the
 *      prompt.
 *   2. Call the configured image model (e.g. Lovable AI Gateway
 *      `openai/gpt-image-2` via `https://ai.gateway.lovable.dev/v1/images/generations`).
 *      Use the preset as a style hint; the rest of the message is the
 *      subject.
 *   3. Return JSON containing EITHER:
 *        { imageB64: "<base64>", imageMimeType: "image/png", content: "" }
 *      OR:
 *        { imageGen: { images: [{ imageUrl: "data:image/png;base64,..." }] },
 *          content: "" }
 *      The frontend (`useChatStream`) already consumes both shapes and
 *      renders the image inline as an assistant message.
 *   4. Do NOT also stream an "I can't generate images" text reply — the
 *      branch is terminal.
 * ───────────────────────────────────────────────────────────────────────
 */

