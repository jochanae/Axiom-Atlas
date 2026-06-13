export type CommitCardPayload = {
  v: 1;
  title: string;
  summary: string;
  severity: "blocker" | "decision";
  verb: "commit";
};

const DECISION_TRIGGERS = [
  "recommend",
  "decided",
  "going with",
  "the approach is",
  "this means",
  "locked in",
  "the fix is",
  "the pattern is",
  "the decision is",
  "we should",
  "i'd go with",
];

const BLOCKER_TRIGGERS = ["block", "must", "critical"];

function sentenceSplit(message: string): string[] {
  return message
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function detectDecisionMoment(message: string): CommitCardPayload | null {
  const clean = message.trim();
  if (clean.length <= 150) return null;

  const lower = clean.toLowerCase();
  if (!DECISION_TRIGGERS.some((trigger) => lower.includes(trigger))) return null;

  const sentences = sentenceSplit(clean);
  const title = truncate(sentences[0] ?? clean, 80);
  const summarySource = sentences[1] ?? clean;
  const summary = truncate(summarySource, 200);
  const severity = BLOCKER_TRIGGERS.some((trigger) => lower.includes(trigger))
    ? "blocker"
    : "decision";

  return {
    v: 1,
    title,
    summary,
    severity,
    verb: "commit",
  };
}
