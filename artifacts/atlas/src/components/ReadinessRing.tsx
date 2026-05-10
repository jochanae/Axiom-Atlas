import { useState } from "react";
import type React from "react";
import type { ProjectNodeState } from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReadinessTrend {
  delta: number;
  label: string;
  history: Array<{ score: number; recordedAt: string }>;
}

export type ReadinessMode = "blended" | "arch" | "decisions";

export const READINESS_MODE_KEY = "atlas-readiness-mode";

export const MODE_META: Record<ReadinessMode, { label: string; abbr: string; description: string }> = {
  blended:   { label: "Blended",   abbr: "MIX", description: "60% architecture · 40% decisions" },
  arch:      { label: "Arch",      abbr: "STR", description: "Architecture nodes only" },
  decisions: { label: "Decisions", abbr: "DCN", description: "Committed ledger entries only" },
};

export function computeBlendedScore(archScore: number, decisionsScore: number): number {
  return Math.round(archScore * 0.6 + decisionsScore * 0.4);
}

// ── nodeState score helper ────────────────────────────────────────────────────
// nodeState mixes two persisted shapes:
//   boolean  — SystemMap arch nodes (auth/db/api/state/ui/logic)
//   { resolved: boolean; strategicAnswer?: string } — AxiomFlow nodes
function isNodeResolved(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (val !== null && typeof val === "object" && "resolved" in val) {
    return (val as { resolved: unknown }).resolved === true;
  }
  return false;
}

export function computeScoreFromNodeState(nodeState: ProjectNodeState | undefined | null): number {
  if (!nodeState) return 0;
  const vals = Object.values(nodeState);
  if (vals.length === 0) return 0;
  return Math.round(vals.filter(isNodeResolved).length / vals.length * 100);
}

// ── Shared SVG ring primitive ─────────────────────────────────────────────────

interface RingSvgProps {
  score: number;
  size: number;
  radius: number;
  strokeWidth: number;
  pulse?: boolean;
}

function RingSvg({ score, size, radius, strokeWidth, pulse }: RingSvgProps) {
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100);
  const full = score >= 100;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" style={{ display: "block" }} aria-hidden>
      <circle cx={cx} cy={cy} r={radius} stroke="rgba(201,162,76,0.15)" strokeWidth={strokeWidth} />
      <circle
        cx={cx} cy={cy} r={radius}
        stroke="var(--atlas-gold)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${circ}`}
        strokeDashoffset={`${offset}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{
          transition: "stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1)",
          filter: full ? `drop-shadow(0 0 ${strokeWidth + 1}px rgba(201,162,76,0.8))` : undefined,
        }}
        className={(full && pulse) ? "atlas-ring-pulse" : undefined}
      />
    </svg>
  );
}

// ── CompactReadinessRing — for home-page project cards ────────────────────────

export function CompactReadinessRing({ score }: { score: number }) {
  const SIZE = 24;
  const isZero = score === 0;
  return (
    <div
      title={isZero ? "Readiness unscored" : `Readiness ${score}%`}
      aria-label={isZero ? "Readiness unscored" : `Readiness ${score}%`}
      style={{
        width: SIZE, height: SIZE, position: "relative", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: isZero ? 0.38 : 1,
        transition: "opacity 300ms ease",
      }}
    >
      <RingSvg score={score} size={SIZE} radius={8} strokeWidth={2} pulse={false} />
      {!isZero && (
        <span
          style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            fontFamily: "var(--app-font-mono)", fontSize: 6, fontWeight: 700, letterSpacing: "0.02em",
            color: "var(--atlas-gold)",
            lineHeight: 1, userSelect: "none", pointerEvents: "none",
          }}
        >
          {score}
        </span>
      )}
    </div>
  );
}

// ── ReadinessRing — full workspace header ring ────────────────────────────────

export function ReadinessRing({
  archScore,
  decisionsScore,
  mode,
  onModeChange,
  onClick,
  trend,
}: {
  archScore: number;
  decisionsScore: number;
  mode: ReadinessMode;
  onModeChange: (m: ReadinessMode) => void;
  onClick?: () => void;
  trend?: ReadinessTrend;
}) {
  const score =
    mode === "arch"      ? archScore :
    mode === "decisions" ? decisionsScore :
    computeBlendedScore(archScore, decisionsScore);

  const hasTrend = trend && trend.delta !== 0;
  const trendColor = hasTrend ? (trend.delta > 0 ? "#4ade80" : "rgba(252,165,165,0.85)") : "var(--atlas-muted)";
  const trendArrow = hasTrend ? (trend.delta > 0 ? "↑" : "↓") : null;
  const [showTooltip, setShowTooltip] = useState(false);
  const MODES: ReadinessMode[] = ["blended", "arch", "decisions"];
  const cycleMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    onModeChange(next);
  };
  const blended = computeBlendedScore(archScore, decisionsScore);
  const tooltipText = trend
    ? `${trend.delta > 0 ? "+" : ""}${trend.delta}pts ${trend.label} · ${trend.history.length} snapshots`
    : `${MODE_META[mode].description}: ${score}%`;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, position: "relative" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onClick}
        title={tooltipText}
        aria-label={`Readiness ${score}% (${MODE_META[mode].label}). Click to open System Map.`}
        style={{
          background: "transparent", border: "none",
          cursor: onClick ? "pointer" : "default",
          padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, position: "relative", width: 28, height: 28,
          borderRadius: "50%", transition: "opacity 160ms ease",
        }}
        onMouseEnter={(e) => { if (onClick) e.currentTarget.style.opacity = "0.75"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
      >
        <RingSvg score={score} size={28} radius={10} strokeWidth={2.5} pulse />
        <span
          style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            fontFamily: "var(--app-font-mono)", fontSize: 7, fontWeight: 700, letterSpacing: "0.02em",
            color: score > 0 ? "var(--atlas-gold)" : "var(--atlas-muted)",
            lineHeight: 1, pointerEvents: "none", userSelect: "none",
          }}
        >
          {score}
        </span>
      </button>

      <button
        onClick={cycleMode}
        title={`Viewing: ${MODE_META[mode].description}. Click to switch mode.`}
        aria-label={`Readiness mode: ${MODE_META[mode].label}. Click to cycle modes.`}
        style={{
          background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.18)",
          borderRadius: 3, cursor: "pointer", padding: "1px 3px",
          fontFamily: "var(--app-font-mono)", fontSize: 6.5, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--atlas-muted)", lineHeight: 1, userSelect: "none", flexShrink: 0,
          transition: "color 150ms ease, border-color 150ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--atlas-gold)";
          e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--atlas-muted)";
          e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)";
        }}
      >
        {MODE_META[mode].abbr}
      </button>

      {trendArrow && (
        <span
          style={{
            fontSize: 9, fontFamily: "var(--app-font-mono)", fontWeight: 700,
            color: trendColor, lineHeight: 1, letterSpacing: "0.02em",
            userSelect: "none", flexShrink: 0,
          }}
          title={tooltipText}
        >
          {trendArrow}{Math.abs(trend!.delta)}
        </span>
      )}

      {showTooltip && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.2)",
            borderRadius: 8, padding: "8px 10px", minWidth: 150, zIndex: 10000,
            pointerEvents: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.55)", whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>
            Readiness — {MODE_META[mode].label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 9.5, fontFamily: "var(--app-font-mono)" }}>
              <span style={{ color: "var(--atlas-muted)" }}>Architecture</span>
              <span style={{ color: mode === "arch" ? "var(--atlas-gold)" : "var(--atlas-fg)", fontWeight: mode === "arch" ? 700 : 400 }}>{archScore}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 9.5, fontFamily: "var(--app-font-mono)" }}>
              <span style={{ color: "var(--atlas-muted)" }}>Decisions</span>
              <span style={{ color: mode === "decisions" ? "var(--atlas-gold)" : "var(--atlas-fg)", fontWeight: mode === "decisions" ? 700 : 400 }}>{decisionsScore}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 9.5, fontFamily: "var(--app-font-mono)", borderTop: "1px solid rgba(201,162,76,0.1)", paddingTop: 3 }}>
              <span style={{ color: "var(--atlas-muted)" }}>Blended</span>
              <span style={{ color: mode === "blended" ? "var(--atlas-gold)" : "var(--atlas-fg)", fontWeight: mode === "blended" ? 700 : 400 }}>{blended}%</span>
            </div>
          </div>

          {trend && trend.history.length > 1 && (() => {
            const pts = [...trend.history].reverse().slice(0, 8);
            const W = 130, H = 28, PAD = 4;
            const allScores = pts.map(p => p.score);
            const minS = Math.min(...allScores);
            const maxS = Math.max(...allScores);
            const range = Math.max(maxS - minS, 1);
            const toX = (i: number) => PAD + (i / Math.max(pts.length - 1, 1)) * (W - PAD * 2);
            const toY = (s: number) => H - PAD - ((s - minS) / range) * (H - PAD * 2);
            const polyPts = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(p.score).toFixed(1)}`).join(" ");
            const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.score).toFixed(1)}`).join(" ");
            return (
              <>
                <div style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.6)", letterSpacing: "0.06em", marginBottom: 3, textTransform: "uppercase" }}>
                  Trend{mode !== "blended" ? " (blended)" : ""}
                </div>
                <svg width={W} height={H} style={{ display: "block", marginBottom: 4 }}>
                  <polyline points={polyPts} fill="none" stroke="rgba(201,162,76,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={`${pathD} L${toX(pts.length - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`} fill="rgba(201,162,76,0.08)" />
                  {pts.map((p, i) => (
                    <circle key={i} cx={toX(i)} cy={toY(p.score)} r="2" fill={i === pts.length - 1 ? "var(--atlas-gold)" : "rgba(201,162,76,0.35)"} />
                  ))}
                </svg>
                <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: hasTrend ? trendColor : "var(--atlas-muted)" }}>
                  {hasTrend
                    ? `${trend.delta > 0 ? "+" : ""}${trend.delta}pts ${trend.label}`
                    : `No change ${trend.label}`}
                </div>
              </>
            );
          })()}

          <div style={{ marginTop: 5, fontSize: 8.5, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.5)", letterSpacing: "0.05em" }}>
            Click mode pill to switch signal
          </div>
        </div>
      )}
    </div>
  );
}
