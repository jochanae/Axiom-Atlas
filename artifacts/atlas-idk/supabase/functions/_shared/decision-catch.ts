// Decision Catch detector — server-side.
//
// The atlas-chat system prompt already instructs Atlas to lead a real catch
// with the exact phrase "Before you do —" and to name the colliding decision
// in quotes (e.g. "Before you do — this pulls against "Ship MVP by Friday".").
//
// Here we parse the prose for that signature and resolve the quoted title
// back to a committed ledger entry. If we find a match, we return a
// structured DecisionCatch payload the UI can render as DecisionCatchCard.
//
// Per POSITIONING.md §3.1: false positives are worse than false negatives.
// So we ONLY emit a structured catch when (a) the lead phrase is present
// AND (b) we can resolve a quoted title to an actual committed entry.

export interface CommittedEntryRef {
  id: string;
  title: string;
}

export interface DecisionCatchPayload {
  /** The committed entry the user is about to push against. */
  against: { id: string; title: string };
  /** The "Before you do —" lead sentence pulled from the prose. */
  leadSentence: string;
  /** Detector version — UI can branch on this. */
  v: 1;
}

const LEAD_PATTERN = /Before you do\s*[—–-]\s*([^\n]+)/i;

/**
 * Try to extract a structured DecisionCatch from assistant prose.
 * Returns null when the prose isn't a catch, or when the quoted title
 * can't be resolved to a committed entry.
 */
export function detectDecisionCatch(
  finalText: string,
  committedEntries: CommittedEntryRef[],
): DecisionCatchPayload | null {
  if (!finalText || committedEntries.length === 0) return null;

  const leadMatch = finalText.match(LEAD_PATTERN);
  if (!leadMatch) return null;

  // Pull the first quoted phrase from the lead sentence.
  // Accept straight quotes, curly quotes, and single quotes.
  const leadSentence = leadMatch[0].trim();
  const quoteMatch = leadSentence.match(/["“”'‘’]([^"“”'‘’]{3,120})["“”'‘’]/);
  if (!quoteMatch) return null;
  const quotedTitle = quoteMatch[1].trim().toLowerCase();

  // Resolve quoted title to a committed entry. Exact match first, then
  // a contains-match as a tolerant fallback.
  const exact = committedEntries.find(
    (e) => e.title.trim().toLowerCase() === quotedTitle,
  );
  const matched =
    exact ??
    committedEntries.find(
      (e) =>
        e.title.toLowerCase().includes(quotedTitle) ||
        quotedTitle.includes(e.title.toLowerCase()),
    );
  if (!matched) return null;

  return {
    v: 1,
    against: { id: matched.id, title: matched.title },
    leadSentence,
  };
}
