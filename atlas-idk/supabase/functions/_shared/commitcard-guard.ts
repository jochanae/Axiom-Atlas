// CommitCard Guard — validates card payloads before they reach the Ledger.
// Prevents partial, malformed, or low-quality decisions from being persisted.

export interface CommitCardInput {
  decision_found?: boolean;
  title?: string;
  description?: string;
  summary?: string;
  constraint?: string;
  confidence?: string;
  severity?: string;
  verb?: string;
  details?: string;
  touched?: string[];
  v?: number;
}

export interface CardValidation {
  valid: boolean;
  /** Cleaned/normalized card ready for persistence */
  card: CommitCardInput;
  /** List of issues found (empty if valid) */
  issues: string[];
  /** Whether any fields were auto-filled */
  autoFilled: string[];
}

const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 300;
const VALID_SEVERITIES = ["committed", "parked", "blocker", "neutral"];
const VALID_VERBS = ["new", "bug", "perf", "note", "wip", "audit", "merge", "plan"];
const VALID_CONFIDENCES = ["high", "medium", "low"];

// Patterns that indicate a garbage/placeholder title
const BAD_TITLE_PATTERNS = [
  /^untitled$/i,
  /^test$/i,
  /^decision$/i,
  /^todo$/i,
  /^\s*$/,
  /^[.\-_]+$/,
];

/**
 * Validate and normalize a CommitCard before it's saved to the ledger.
 * Auto-fills missing optional fields with safe defaults.
 * Returns { valid: false } only for truly unrecoverable cards.
 */
export function validateCommitCard(
  raw: CommitCardInput,
  context?: { conversationSnippet?: string; mode?: string },
): CardValidation {
  const issues: string[] = [];
  const autoFilled: string[] = [];
  const card = { ...raw };

  // ── decision_found check (atlas-commit format) ──
  if (card.decision_found === false) {
    return {
      valid: false,
      card,
      issues: ["No decision found in conversation"],
      autoFilled: [],
    };
  }

  // ── Title: required, non-empty, non-garbage ──
  if (!card.title || card.title.trim().length === 0) {
    issues.push("Missing title");
    // Attempt auto-fill from description/summary
    if (card.description) {
      card.title = card.description.slice(0, 60);
      autoFilled.push("title (from description)");
    } else if (card.summary) {
      card.title = card.summary.slice(0, 60);
      autoFilled.push("title (from summary)");
    } else {
      return { valid: false, card, issues: ["Missing title — cannot auto-fill"], autoFilled };
    }
  }

  // Normalize title
  card.title = card.title.trim();
  if (card.title.length > MAX_TITLE_LENGTH) {
    card.title = card.title.slice(0, MAX_TITLE_LENGTH - 1) + "…";
    autoFilled.push("title (truncated)");
  }

  // Check for garbage titles
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(card.title)) {
      issues.push(`Garbage title: "${card.title}"`);
      break;
    }
  }

  // ── Summary / Description: at least one required ──
  const hasSummary = card.summary && card.summary.trim().length > 0;
  const hasDescription = card.description && card.description.trim().length > 0;

  if (!hasSummary && !hasDescription) {
    issues.push("Missing both summary and description");
    // Can't auto-fill — but still recoverable if title is good
  }

  // Normalize summary length
  if (card.summary && card.summary.length > MAX_SUMMARY_LENGTH) {
    card.summary = card.summary.slice(0, MAX_SUMMARY_LENGTH - 1) + "…";
    autoFilled.push("summary (truncated)");
  }

  // ── Severity: default to parked if missing/invalid ──
  if (!card.severity || !VALID_SEVERITIES.includes(card.severity)) {
    const original = card.severity;
    card.severity = "parked";
    autoFilled.push(`severity (${original || "missing"} → parked)`);
  }

  // ── Verb: default to note if missing/invalid ──
  if (card.verb && !VALID_VERBS.includes(card.verb)) {
    const original = card.verb;
    card.verb = "note";
    autoFilled.push(`verb (${original} → note)`);
  }
  if (!card.verb) {
    card.verb = "note";
    autoFilled.push("verb (missing → note)");
  }

  // ── Confidence: normalize ──
  if (card.confidence && !VALID_CONFIDENCES.includes(card.confidence)) {
    const original = card.confidence;
    card.confidence = "medium";
    autoFilled.push(`confidence (${original} → medium)`);
  }

  // ── Schema version: default to 1 ──
  if (card.v === undefined || card.v === null) {
    card.v = 1;
    autoFilled.push("v (→ 1)");
  }

  // ── Touched: normalize to array ──
  if (card.touched && !Array.isArray(card.touched)) {
    card.touched = [];
    autoFilled.push("touched (invalid → [])");
  }

  // ── Final verdict ──
  // Card is invalid only if title is garbage AND no description
  const hasGarbageTitle = issues.some((i) => i.startsWith("Garbage title"));
  const isUnrecoverable = hasGarbageTitle && !hasSummary && !hasDescription;

  return {
    valid: !isUnrecoverable,
    card,
    issues,
    autoFilled,
  };
}
