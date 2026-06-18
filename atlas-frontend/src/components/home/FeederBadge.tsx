import { useLocation } from "wouter";

/**
 * FeederBadge — visible marker that an ambient/Nexus thread is attached to a
 * committed project as a "feeder channel." Three variants for three surfaces:
 *
 *   sidebar  → minimal muted-amber chip next to thread title in history list
 *   header   → persistent glass chip in the Nexus chat header (always visible)
 *   milestone → glassmorphic card rendered inline at the commit point
 *
 * Single source of truth for the visual language so all four surfaces in the
 * "feeder channel" matrix stay coherent. `archived` collapses to cold charcoal
 * (mirrors parent project lifecycle without bloating schema).
 */
export type FeederVariant = "sidebar" | "header" | "milestone";

interface FeederBadgeProps {
  variant: FeederVariant;
  projectId: number;
  projectTitle: string;
  archived?: boolean;
  /** Brief gold pulse when a bedrock push just landed. Caller sets/clears. */
  pulse?: boolean;
  /** Detach action — omit to hide the detach control (e.g. header chip). */
  onDetach?: () => void;
  className?: string;
}

export function FeederBadge({
  variant,
  projectId,
  projectTitle,
  archived = false,
  pulse = false,
  onDetach,
  className = "",
}: FeederBadgeProps) {
  const [, navigate] = useLocation();
  const jump = () => navigate(`/project/${projectId}`);

  const goldFG = archived ? "rgba(180,180,180,0.55)" : "var(--atlas-gold)";
  const goldBG = archived ? "rgba(255,255,255,0.03)" : "rgba(201,162,76,0.08)";
  const goldBR = archived ? "rgba(255,255,255,0.08)" : "rgba(201,162,76,0.32)";

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          jump();
        }}
        title={archived ? `${projectTitle} (archived)` : `Jump to ${projectTitle}`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${className}`}
        style={{
          background: goldBG,
          border: `0.5px solid ${goldBR}`,
          color: goldFG,
          fontFamily: "var(--app-font-mono)",
          fontSize: 9,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          lineHeight: 1,
          flexShrink: 0,
          boxShadow: pulse ? "0 0 8px rgba(201,162,76,0.4)" : "none",
          transition: "box-shadow 600ms ease",
        }}
      >
        ↗ {projectTitle}
      </button>
    );
  }

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={jump}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-sm ${className}`}
        style={{
          background: goldBG,
          border: `1px solid ${goldBR}`,
          color: goldFG,
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.06em",
          lineHeight: 1,
          boxShadow: pulse
            ? "0 0 14px rgba(201,162,76,0.5), inset 0 0 4px rgba(201,162,76,0.2)"
            : "none",
          transition: "box-shadow 600ms ease",
        }}
      >
        Jump to {projectTitle} →
      </button>
    );
  }

  // milestone — glassmorphic anchor card
  return (
    <div
      className={`flex items-center justify-between gap-3 w-full my-4 px-4 py-3 rounded-xl backdrop-blur-md ${className}`}
      style={{
        background: "rgba(201,162,76,0.04)",
        border: `1px solid ${goldBR}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.2)",
      }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: goldFG,
            opacity: 0.7,
          }}
        >
          Committed
        </span>
        <span
          style={{
            color: "var(--atlas-fg)",
            fontSize: 13,
            opacity: 0.9,
          }}
        >
          This shaping cycle was committed to{" "}
          <span style={{ color: goldFG, fontWeight: 500 }}>{projectTitle}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onDetach && !archived && (
          <button
            type="button"
            onClick={onDetach}
            title="Detach feeder channel"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--atlas-muted)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "4px 8px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Detach
          </button>
        )}
        <button
          type="button"
          onClick={jump}
          style={{
            background: goldBG,
            border: `1px solid ${goldBR}`,
            color: goldFG,
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            padding: "5px 10px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Jump →
        </button>
      </div>
    </div>
  );
}
