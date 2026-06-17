// Forge extraction helpers
// Prevents raw code/HTML from being dumped into Forge's "brain dump" textarea.
// See chat 2026-06-02 — "Extract to Forge dumps raw HTML" bug.

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Produce a Forge-safe payload from a raw assistant message.
 * Strips fenced code, inline code, and obvious HTML tags. Returns prose only.
 * If nothing meaningful is left, returns a clear placeholder so the user
 * knows to type the intent themselves — never the raw code.
 */
export function extractStrategicIntent(raw: string): string {
  if (!raw) return "";

  const hadFences = FENCE_RE.test(raw);
  // Reset regex state after .test()
  FENCE_RE.lastIndex = 0;

  const prose = raw
    .replace(FENCE_RE, "")
    .replace(INLINE_CODE_RE, "")
    .replace(HTML_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If the message was mostly code, prose will be empty or trivially short.
  if (prose.length < 40) {
    return hadFences
      ? "[Atlas generated code in this reply. Describe the strategic intent behind it — what should this build accomplish, for whom, and why?]"
      : prose;
  }

  return prose;
}
