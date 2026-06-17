/**
 * Wraps a blueprint's raw `visualPrompt` in a rich, multi-panel industrial-
 * design board template so generated images match the original Blueprint
 * style — magazine-quality hero + orthographic views + interaction states.
 *
 * Keeps prompt quality controlled here in the frontend, independent of
 * whatever the Cloud Run `/api/projects/:id/blueprint` endpoint currently
 * emits in `visualPrompt`.
 */
export function buildBlueprintImagePrompt(visualPrompt: string, title?: string): string {
  const subject = (visualPrompt ?? "").trim();
  const heading = title?.trim() ? `Concept: ${title.trim()}` : "Concept";
  return [
    "Multi-panel industrial design board, magazine-quality presentation, dark editorial background, premium materials, cohesive palette.",
    "",
    "Show a premium product concept board with visual panels only.",
    "- Main hero render of the concept, studio-lit, crisp materials, believable form.",
    "- Supporting orthographic or exploded views using lines, arrows, callouts, and diagram shapes only.",
    "- Optional workflow or usage panels shown visually, not as written captions.",
    "- Avoid paragraphs, labels, UI text blocks, letters, words, typography, or faux writing inside the image.",
    "- Use symbols, linework, shapes, measurements, and visual hierarchy instead of written text.",
    "- No foreign-language text, no gibberish, no pseudo-type, no placeholder lettering.",
    "",
    heading,
    "",
    "Subject:",
    subject,
  ].join("\n");
}
