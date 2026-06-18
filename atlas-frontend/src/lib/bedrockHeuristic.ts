/**
 * Heuristic detector for "bedrock candidate" messages — assistant messages
 * that distill an actionable breakthrough worth pushing into a committed
 * project's memory. Frontend-only stopgap until backend returns an explicit
 * `bedrock_candidate: true` flag per message.
 *
 * Triggers on the union of:
 *   - decision/commitment verbs ("decided", "committing to", "locked in")
 *   - structural cues (bullet/numbered lists with 2+ items)
 *   - synthesis markers ("the verdict", "bottom line", "key insight")
 *
 * Tune thresholds here; swap the call site to use a server flag later.
 */
const DECISION_VERBS =
  /\b(decided|deciding|committing to|commit to|locked? in|going with|chose|choosing|settled on|the verdict|bottom line|key insight|the takeaway|north star)\b/i;

const STRUCTURAL_CUES = /(?:^|\n)\s*(?:[-*•]|\d+\.)\s+/g;

const SYNTHESIS_MARKERS =
  /\b(in summary|to summarize|the architecture|the blueprint|here'?s the plan|core principle|the framework)\b/i;

export function isBedrockCandidate(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 80) return false; // too short to be a real distillation

  if (DECISION_VERBS.test(t)) return true;
  if (SYNTHESIS_MARKERS.test(t)) return true;

  const listMatches = t.match(STRUCTURAL_CUES);
  if (listMatches && listMatches.length >= 2) return true;

  return false;
}
