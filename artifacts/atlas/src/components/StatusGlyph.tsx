import type React from "react";

export type Severity = "blocker" | "parked" | "committed" | "neutral";
export type Verb = "new" | "bug" | "perf" | "note" | "wip" | "audit" | "merge" | "plan" | "axiom_import";

const severityColor: Record<Severity, string> = {
  blocker:   "var(--atlas-ember)",
  parked:    "var(--atlas-gold)",
  committed: "var(--atlas-phosphor)",
  neutral:   "var(--atlas-muted)",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker:   "Blocker",
  parked:    "Parked",
  committed: "Committed",
  neutral:   "Note",
};

const VERB_LABEL: Record<Verb, string> = {
  new:          "New",
  bug:          "Bug",
  perf:         "Perf",
  note:         "Note",
  wip:          "WIP",
  audit:        "Audit",
  merge:        "Merge",
  plan:         "Plan",
  axiom_import: "Compani",
};

interface VerbGlyphProps { size?: number; }

const VerbGlyphs: Record<Verb, (p: VerbGlyphProps) => React.ReactElement> = {
  new: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5 L9 7 L13.5 8 L9 9 L8 13.5 L7 9 L2.5 8 L7 7 Z" />
    </svg>
  ),
  bug: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="9.5" rx="3.25" ry="3.75" />
      <path d="M5.75 6 L4.25 4 M10.25 6 L11.75 4" />
      <path d="M8 5.75 V13.25" opacity="0.5" />
    </svg>
  ),
  perf: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
      <path d="M9 2 L4 9 L7.5 9 L6.5 14 L12 7 L8.5 7 Z" />
    </svg>
  ),
  note: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5 H10 L13 5.5 V13.5 H4 Z" />
      <path d="M10 2.5 V5.5 H13" />
      <path d="M5.75 8.5 H11.25 M5.75 10.75 H9.5" opacity="0.6" />
    </svg>
  ),
  wip: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13 L8 3 L13 13 Z" />
      <path d="M5.5 8.25 H10.5" opacity="0.5" />
    </svg>
  ),
  audit: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5 8.25 L7.25 10.5 L11 6.5" />
    </svg>
  ),
  merge: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.5" cy="4.5" r="1.75" />
      <circle cx="11.5" cy="11.5" r="1.75" />
      <path d="M4.5 6.25 V11.5 H9.75" />
      <path d="M11.5 9.75 V4.5 H6.25" opacity="0.5" />
    </svg>
  ),
  plan: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.25 H10" />
      <path d="M3 8 H13" opacity="0.85" />
      <path d="M3 11.75 H7.5" opacity="0.6" />
      <circle cx="12" cy="4.25" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  axiom_import: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {/* Destination box */}
      <rect x="2" y="7" width="8" height="7" rx="1.25" />
      {/* Arrow shaft coming in from top-right */}
      <path d="M10 3.5 H14" />
      <path d="M11.5 5.5 L14 3.5 L11.5 1.5" />
      {/* Connector into box */}
      <path d="M6 7 V5 H10" opacity="0.55" />
    </svg>
  ),
};

export function SeverityDot({ severity, size = 8 }: { severity: Severity; size?: number }) {
  const color = severityColor[severity];
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 ${Math.round(size * 0.75)}px color-mix(in srgb, ${color} 50%, transparent)`,
        flexShrink: 0,
      }}
    />
  );
}

export function StatusGlyph({
  severity,
  verb,
  size = 14,
  withLabel = false,
}: {
  severity: Severity;
  verb?: string | null;
  size?: number;
  withLabel?: boolean;
}) {
  const color = severityColor[severity];
  const knownVerb = verb && verb in VerbGlyphs ? (verb as Verb) : null;

  if (!knownVerb) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <SeverityDot severity={severity} size={Math.round(size * 0.57)} />
        {withLabel && (
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color }}>
            {SEVERITY_LABEL[severity]}
          </span>
        )}
      </span>
    );
  }

  const Glyph = VerbGlyphs[knownVerb];
  return (
    <span
      role="img"
      aria-label={`${SEVERITY_LABEL[severity]} · ${VERB_LABEL[knownVerb]}`}
      style={{ display: "inline-flex", alignItems: "center", gap: withLabel ? 6 : 0, color, flexShrink: 0 }}
    >
      <Glyph size={size} />
      {withLabel && (
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {VERB_LABEL[knownVerb]}
        </span>
      )}
    </span>
  );
}
