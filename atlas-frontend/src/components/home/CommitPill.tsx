import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useShellStore } from "@/store/shellStore";
import { haptics } from "@/lib/haptics";

/**
 * CommitPill — the "door you walk through" at the end of a shaped thread.
 *
 * Modes:
 *   1. INLINE  — props with projectId/projectTitle; legacy anchored card.
 *   2. STORE   — driven by shellStore.shapingStatus; floats over the dock.
 *
 * State choreography:
 *   shaping       → "Shaping into structure…" shimmer, non-interactive
 *   ready         → "Enter Workspace →" glowing gold, tappable
 *   transitioning → border-trace plays AS onArm runs in parallel
 *   error         → "Handoff failed — Retry" (local recovery)
 *
 * Pass 3 (Cinematic): onArm fires at tap (not after trace), trace runs as a
 * visual cover, and the HandoffCinemaOverlay sits behind the pill dimming the
 * page. If onArm rejects, the pill enters error/retry state instead of
 * silently navigating.
 */

type Status = "shaping" | "ready" | "transitioning" | "error";

interface InlineProps {
  projectId: number;
  projectTitle: string;
  onArm?: () => Promise<void> | void;
  initialStatus?: Exclude<Status, "error">;
  className?: string;
}

interface StoreProps {
  onArm?: () => Promise<void> | void;
  className?: string;
}

export function CommitPill(props: InlineProps | StoreProps = {}) {
  const inline = "projectId" in props && typeof (props as InlineProps).projectId === "number";
  return inline ? (
    <InlineCommitPill {...(props as InlineProps)} />
  ) : (
    <StoreCommitPill {...(props as StoreProps)} />
  );
}

/* ---------------- inline mode ---------------- */

function InlineCommitPill({
  projectId,
  projectTitle,
  onArm,
  initialStatus = "ready",
  className = "",
}: InlineProps) {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [traceProgress, setTraceProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "transitioning") return;
    const start = performance.now();
    const DURATION = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const pct = Math.min(1, (t - start) / DURATION);
      setTraceProgress(pct);
      if (pct < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const handleTap = async () => {
    if (status === "transitioning") return;
    haptics.cardConfirmed();
    setErrorMsg(null);
    setStatus("transitioning");
    try {
      if (onArm) await onArm();
      else navigate(`/project/${projectId}`);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Handoff failed");
    }
  };

  return (
    <PillVisual
      status={status}
      title={projectTitle}
      traceProgress={traceProgress}
      errorMsg={errorMsg}
      onTap={handleTap}
      className={className}
    />
  );
}

/* ---------------- store mode ---------------- */

function StoreCommitPill({ className = "", onArm }: { className?: string; onArm?: () => Promise<void> | void }) {
  const [, navigate] = useLocation();
  const status = useShellStore((s) => s.shapingStatus);
  const projectId = useShellStore((s) => s.pendingWorkspaceId);
  const title = useShellStore((s) => s.pendingWorkspaceTitle);
  const setShapingStatus = useShellStore((s) => s.setShapingStatus);
  const resetHandoff = useShellStore((s) => s.resetHandoff);
  const setShellMode = useShellStore((s) => s.setShellMode);

  const [traceProgress, setTraceProgress] = useState(0);
  const [localStatus, setLocalStatus] = useState<"none" | "error">("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const armedRef = useRef(false);

  // Reset local error when store resets back to ready/idle/shaping.
  useEffect(() => {
    if (status === "ready" || status === "idle" || status === "shaping") {
      setLocalStatus("none");
      setErrorMsg(null);
      armedRef.current = false;
    }
  }, [status]);

  // Trace animation runs purely as visual cover while onArm executes.
  useEffect(() => {
    if (status !== "transitioning") {
      setTraceProgress(0);
      return;
    }
    const start = performance.now();
    const DURATION = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const pct = Math.min(1, (t - start) / DURATION);
      setTraceProgress(pct);
      if (pct < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Kick off onArm exactly once when entering transitioning.
  useEffect(() => {
    if (status !== "transitioning" || armedRef.current) return;
    armedRef.current = true;
    const run = async () => {
      try {
        if (onArm) {
          await onArm();
          // onArm owns navigation; reset shortly after so the overlay clears.
          setTimeout(() => resetHandoff(), 80);
        } else if (projectId) {
          setShellMode("operational");
          navigate(`/project/${projectId}?source=commit-handoff`);
          setTimeout(() => resetHandoff(), 80);
        }
      } catch (err) {
        setLocalStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Handoff failed");
        setShapingStatus("ready");
      }
    };
    void run();
  }, [status, onArm, projectId, navigate, setShellMode, setShapingStatus, resetHandoff]);

  if (status === "idle") return null;

  const effectiveStatus: Status = localStatus === "error" ? "error" : (status as Status);

  return (
    <PillVisual
      status={effectiveStatus}
      title={title ?? "workspace"}
      traceProgress={traceProgress}
      errorMsg={errorMsg}
      onTap={() => {
        if (effectiveStatus === "error") {
          setLocalStatus("none");
          setErrorMsg(null);
          armedRef.current = false;
          haptics.tap();
          setShapingStatus("transitioning");
          return;
        }
        if (status !== "ready") return;
        haptics.cardConfirmed();
        setShapingStatus("transitioning");
      }}
      className={className}
    />
  );
}

/* ---------------- shared visual ---------------- */

function PillVisual({
  status,
  title,
  traceProgress,
  errorMsg,
  onTap,
  className,
}: {
  status: Status;
  title: string;
  traceProgress: number;
  errorMsg: string | null;
  onTap: () => void;
  className: string;
}) {
  const label =
    status === "shaping"
      ? "Shaping into structure…"
      : status === "ready"
        ? "Enter Workspace →"
        : status === "transitioning"
          ? `Preparing ${title}…`
          : "Handoff failed — Retry";

  const isReady = status === "ready";
  const isTransitioning = status === "transitioning";
  const isError = status === "error";
  const interactive = isReady || isError;

  const accent = isError ? "rgba(220,90,80,0.85)" : "var(--atlas-gold)";
  const accentSoft = isError ? "rgba(220,90,80,0.16)" : "rgba(201,162,76,0.16)";
  const accentBorder = isError ? "rgba(220,90,80,0.55)" : "rgba(201,162,76,0.55)";

  return (
    <div className={`flex flex-col items-center w-full my-6 ${className}`}>
      <button
        type="button"
        onClick={onTap}
        disabled={!interactive}
        aria-label={label}
        title={isError && errorMsg ? errorMsg : undefined}
        className="relative px-6 py-3 rounded-full select-none transition-all duration-300"
        style={{
          background: interactive
            ? `linear-gradient(135deg, ${accentSoft}, ${accentSoft.replace("0.16", "0.08")})`
            : "rgba(255,255,255,0.03)",
          border: `1px solid ${interactive ? accentBorder : "rgba(255,255,255,0.08)"}`,
          boxShadow: isReady
            ? "0 0 24px rgba(201,162,76,0.25), inset 0 0 12px rgba(201,162,76,0.08)"
            : isError
              ? "0 0 18px rgba(220,90,80,0.25)"
              : "none",
          color: interactive ? accent : "var(--atlas-muted)",
          fontFamily: "var(--app-font-mono)",
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: interactive ? "pointer" : "default",
          overflow: "hidden",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {isReady && (
          <span
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              background: "radial-gradient(circle at center, rgba(201,162,76,0.12), transparent 70%)",
              pointerEvents: "none",
            }}
          />
        )}

        {status === "shaping" && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
              backgroundSize: "200% 100%",
              animation: "commit-pill-shimmer 1.6s linear infinite",
              pointerEvents: "none",
            }}
          />
        )}

        {isTransitioning && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <rect
              x="0.5"
              y="0.5"
              width="99"
              height="99"
              rx="49"
              ry="49"
              fill="none"
              stroke="var(--atlas-gold)"
              strokeWidth="1.5"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - traceProgress}
              style={{ filter: "drop-shadow(0 0 6px rgba(201,162,76,0.7))" }}
            />
          </svg>
        )}

        <span className="relative z-10">{label}</span>
      </button>

      {isError && errorMsg && (
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            color: "rgba(220,90,80,0.75)",
            letterSpacing: "0.05em",
            maxWidth: 280,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          {errorMsg}
        </div>
      )}

      <style>{`
        @keyframes commit-pill-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
