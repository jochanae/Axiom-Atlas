import { useRef, useState } from "react";
import { deriveLifecycle, LIFECYCLE_META, type LifecycleSignals } from "@/lib/lifecycle";
import { ProjectPulsePanel } from "./ProjectPulsePanel";
import { openForgeIntakeSheet } from "./ForgeIntakeSheet";

interface Props extends LifecycleSignals {
  projectId: number;
  projectName: string;
  size?: number;
  lastActivityAt?: string | null;
  themes?: string[];
  recentDecisions?: Array<{ title: string; at?: string | null }>;
}

const LONG_PRESS_MS = 480;

export function LifecycleGlyph(props: Props) {
  const { projectId, projectName, size = 14, lastActivityAt, themes, recentDecisions, ...signals } = props;
  const state = deriveLifecycle(signals);
  const meta = LIFECYCLE_META[state];
  const [open, setOpen] = useState(false);

  // Long-press → open ForgeIntakeSheet. Short tap → Pulse dialog.
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    firedRef.current = false;
    cancelTimer();
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      try {
        if (typeof navigator !== "undefined" && (navigator as any).vibrate) (navigator as any).vibrate(12);
      } catch { /* noop */ }
      openForgeIntakeSheet();
    }, LONG_PRESS_MS);
  };

  const endPress = () => { cancelTimer(); };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (firedRef.current) { firedRef.current = false; return; }
    setOpen(true);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Suppress the OS context menu so long-press doesn't surface the browser link preview.
    e.preventDefault();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        title={`${meta.label} — ${meta.description} · long-press for Forge intake`}
        aria-label={`${projectName} is ${meta.label}. Tap for Atlas Pulse, long-press for Forge intake.`}
        style={{
          flexShrink: 0,
          width: size + 8,
          height: size + 8,
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: meta.color,
          fontSize: size,
          lineHeight: 1,
          opacity: state === "built" ? 0.7 : 1,
          transition: "opacity 160ms ease, transform 160ms ease",
          touchAction: "manipulation",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        {state === "committed" ? (
          <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke={meta.color} strokeWidth="1.3" />
            <circle cx="8" cy="8" r="2.4" fill={meta.color} />
          </svg>
        ) : state === "built" ? (
          <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3.5 8.5l3 3 6-6.5" stroke={meta.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 14V7" stroke={meta.color} strokeWidth="1.2" strokeLinecap="round" />
            <path d="M8 8c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4z" fill={meta.color} opacity="0.85" />
            <path d="M8 7c2.2 0 3.5-1.3 3.5-3.5C9.3 3.5 8 4.8 8 7z" fill={meta.color} opacity="0.85" />
          </svg>
        )}
      </button>

      {open && (
        <ProjectPulsePanel
          projectId={projectId}
          projectName={projectName}
          state={state}
          readinessScore={signals.readinessScore ?? null}
          decisionCount={signals.decisionCount ?? null}
          hasRepo={signals.hasRepo ?? false}
          lastActivityAt={lastActivityAt ?? null}
          themes={themes ?? []}
          recentDecisions={recentDecisions ?? []}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
