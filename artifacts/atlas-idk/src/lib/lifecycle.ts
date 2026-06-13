// Project lifecycle — Seed → Shape → Build
// Atlas-assigned: shaping, committed. User-confirmed: built.
// See chat thread 2026-06-02 — "🌱 → ◉ → ✓" decision.

export type Lifecycle = "shaping" | "committed" | "built";

export interface LifecycleSignals {
  /** Persisted lifecycle hint from the backend, if any. */
  status?: string | null;
  /** 0–100 readiness score from latest snapshot. */
  readinessScore?: number | null;
  /** Number of committed ledger decisions for this project. */
  decisionCount?: number | null;
  /** True if a GitHub repo is linked. */
  hasRepo?: boolean | null;
}

/**
 * Derive the lifecycle state from whatever signal is available.
 * - Atlas owns shaping → committed.
 * - Built is only set when the backend persists it (user-confirmed).
 */
export function deriveLifecycle(s: LifecycleSignals): Lifecycle {
  if (s.status === "built") return "built";
  if (s.status === "committed") return "committed";
  if (s.status === "shaping") return "shaping";

  const score = s.readinessScore ?? 0;
  const decisions = s.decisionCount ?? 0;
  if (s.hasRepo || decisions >= 3 || score >= 40) return "committed";
  return "shaping";
}

export const LIFECYCLE_META: Record<
  Lifecycle,
  { label: string; glyph: string; color: string; description: string }
> = {
  shaping: {
    label: "Shaping",
    glyph: "🌱",
    color: "rgba(167,201,140,0.95)",
    description: "Atlas is listening. Themes are emerging.",
  },
  committed: {
    label: "Committed",
    glyph: "◉",
    color: "var(--atlas-gold)",
    description: "Clear objective. Active execution.",
  },
  built: {
    label: "Built",
    glyph: "✓",
    color: "rgba(120,180,160,0.9)",
    description: "Complete. Archived to workspace memory.",
  },
};
